// 05-minimal-example.cs — One upload endpoint with every decision made: its own
// size limit, a signature check, a generated name, a verified path, and cleanup
// on every path out.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code, byte count and filename here is
// deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddProblemDetails();

// The server-wide limit stays. This endpoint opts out of it for itself, and
// every other endpoint in the app keeps it.
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 8L * 1024 * 1024);

var app = builder.Build();
app.UseStatusCodePages();

// Where receipts live. In production this is a mounted volume or an object
// store; the shape of the code does not change.
string root = Directory.CreateTempSubdirectory("receipts").FullName;

// Stands in for the database. The ORIGINAL FILENAME LIVES HERE, as data, and
// never touches a path.
var stored = new List<Receipt>();

const long MaxBytes = 4L * 1024 * 1024;

app.MapPost("/v1/receipts", async (HttpContext context) =>
{
    // DECISION 1: this endpoint enforces its own limit, and it must say so
    // BEFORE the first read - the framework's limit cannot be changed once
    // reading has begun, so there is no recovering from it later.
    context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = null;

    if (!context.Request.HasFormContentType
        || !MediaTypeHeaderValue.TryParse(context.Request.ContentType, out MediaTypeHeaderValue? media)
        || string.IsNullOrEmpty(HeaderUtilities.RemoveQuotes(media.Boundary).Value))
    {
        return Problem(StatusCodes.Status415UnsupportedMediaType,
            "Unsupported content type",
            "Send the receipt as multipart/form-data with a single file part.");
    }

    string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value!;
    var reader = new MultipartReader(boundary, context.Request.Body);

    // DECISION 2: the name on disk is generated. Nothing a client typed is
    // ever part of a path.
    string id = Guid.NewGuid().ToString("n");
    string partial = Path.Combine(root, $"{id}.partial");

    try
    {
        while (await reader.ReadNextSectionAsync() is { } section)
        {
            if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition,
                    out ContentDispositionHeaderValue? disposition)
                || !disposition.IsFileDisposition())
            {
                continue;
            }

            // The client's filename, kept as DATA. It is shown back to the
            // user and never used to build anything.
            string claimed = HeaderUtilities.RemoveQuotes(disposition.FileName).Value ?? "receipt";

            // DECISION 3: the first bytes decide the format, before the rest
            // of the file has arrived and before anything is written.
            byte[] head = new byte[8];
            int headRead = await ReadAtLeast(section.Body, head);
            string format = Sniff(head.AsSpan(0, headRead));

            if (format is not ("jpeg" or "png" or "pdf"))
            {
                return Problem(StatusCodes.Status415UnsupportedMediaType,
                    "Unsupported file type",
                    "Receipts must be a JPEG, PNG or PDF. The file's contents are none of those.");
            }

            // DECISION 4: the path is verified even though it was generated,
            // so that the rule above it stays true after somebody edits this.
            if (!Path.GetFullPath(partial).StartsWith(root + Path.DirectorySeparatorChar,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Storage path escaped the receipts root.");
            }

            long written;

            await using (FileStream target = File.Create(partial))
            {
                await target.WriteAsync(head.AsMemory(0, headRead));
                written = headRead;

                byte[] buffer = new byte[8192];
                int read;
                bool tooBig = false;

                while ((read = await section.Body.ReadAsync(buffer)) > 0)
                {
                    written += read;

                    // DECISION 5: past the cap, keep READING and stop
                    // WRITING. Reading is what lets the client finish and
                    // hear the answer; writing is what would cost disk.
                    if (written > MaxBytes)
                    {
                        tooBig = true;

                        continue;
                    }

                    await target.WriteAsync(buffer.AsMemory(0, read));
                }

                if (tooBig)
                {
                    return Problem(StatusCodes.Status413PayloadTooLarge,
                        "Receipt too large",
                        $"Receipts must be {MaxBytes / 1024 / 1024} MB or smaller.");
                }
            }

            // DECISION 6: the file becomes visible under its real name only
            // once it is complete. Until the move, nothing can find it.
            string final = Path.Combine(root, $"{id}.{ExtensionFor(format)}");
            File.Move(partial, final);

            stored.Add(new Receipt(id, claimed, format, written));

            return Results.Created($"/v1/receipts/{id}", new
            {
                id,
                originalFilename = claimed,
                format,
                bytes = written
            });
        }

        return Problem(StatusCodes.Status400BadRequest,
            "No file",
            "The request contained no file part.");
    }
    finally
    {
        // DECISION 7: the incomplete file is removed on every path out of
        // this method, including the ones that throw.
        if (File.Exists(partial))
        {
            File.Delete(partial);
        }
    }
}).DisableAntiforgery();

// Serving one back. The id is the path; the client's filename is a header.
app.MapGet("/v1/receipts/{id}", (string id) =>
{
    if (stored.FirstOrDefault(r => r.Id == id) is not { } receipt)
    {
        return Problem(StatusCodes.Status404NotFound, "Not found", $"No receipt with id '{id}'.");
    }

    string path = Path.Combine(root, $"{receipt.Id}.{ExtensionFor(receipt.Format)}");

    // The original filename reaches the browser HERE, as a header value, which
    // is the one place it belongs.
    return Results.File(path, ContentTypeFor(receipt.Format), receipt.OriginalFilename);
});

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("One upload endpoint, exercised");
Console.WriteLine();

byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, .. new byte[64 * 1024]];
byte[] executable = [0x4D, 0x5A, 0x90, 0x00, .. new byte[64 * 1024]];
byte[] oversized = [0xFF, 0xD8, 0xFF, 0xE0, .. new byte[6 * 1024 * 1024]];
byte[] text = Encoding.UTF8.GetBytes("this is a text file, not a receipt");

Console.WriteLine("   what was sent                        response");
Console.WriteLine("   -------------                        --------");

string ok = await Upload(http, "receipt.jpg", jpeg);
Console.WriteLine($"   a real JPEG                          {ok}");
Console.WriteLine($"   the same JPEG named '../../hack.sh'  {await Upload(http, "../../hack.sh", jpeg)}");
Console.WriteLine($"   an executable named 'photo.jpg'      {await Upload(http, "photo.jpg", executable)}");
Console.WriteLine($"   a 6 MB JPEG, over the 4 MB cap       {await Upload(http, "big.jpg", oversized)}");
Console.WriteLine($"   a text file                          {await Upload(http, "notes.txt", text)}");
Console.WriteLine($"   a form with no file part             {await UploadNoFile(http)}");

Console.WriteLine();
Console.WriteLine("   ON DISK");
Console.WriteLine();

foreach (string file in Directory.GetFiles(root).Order())
{
    Console.WriteLine($"     {Path.GetFileName(file),-40} {new FileInfo(file).Length,9:n0} bytes");
}

Console.WriteLine();
Console.WriteLine("   IN THE DATABASE");
Console.WriteLine();
Console.WriteLine($"     {"id",-34} {"original filename",-18} format");
Console.WriteLine($"     {new string('-', 34)} {new string('-', 18)} ------");

foreach (Receipt receipt in stored)
{
    Console.WriteLine($"     {receipt.Id,-34} {receipt.OriginalFilename,-18} {receipt.Format}");
}

Console.WriteLine();
Console.WriteLine("   AND FETCHING ONE BACK");
Console.WriteLine();

if (stored.FirstOrDefault() is { } first)
{
    using HttpResponseMessage response = await http.GetAsync($"/v1/receipts/{first.Id}");

    Console.WriteLine($"     status                {(int)response.StatusCode}");
    Console.WriteLine($"     content-type          {response.Content.Headers.ContentType}");
    Console.WriteLine($"     content-disposition   {response.Content.Headers.ContentDisposition}");
    Console.WriteLine($"     bytes                 {(await response.Content.ReadAsByteArrayAsync()).Length:n0}");
}

await app.StopAsync();
Directory.Delete(root, recursive: true);

Console.WriteLine();
Console.WriteLine("   READ THE 'ON DISK' AND 'IN THE DATABASE' BLOCKS TOGETHER, because the");
Console.WriteLine("   separation between them is the whole design:");
Console.WriteLine();
Console.WriteLine("     THERE ARE TWO FILES AND BOTH ARE NAMED WITH A GUID. The upload");
Console.WriteLine("     called '../../hack.sh' WAS ACCEPTED, because its bytes are a real");
Console.WriteLine("     JPEG and its name was never going to be used for anything. A hostile");
Console.WriteLine("     filename is not a reason to refuse a file; it is a reason not to use");
Console.WriteLine("     the filename. And there are no '.partial' files left from the three");
Console.WriteLine("     refusals.");
Console.WriteLine();
Console.WriteLine("     THE CLIENT'S FILENAME SURVIVED AS DATA. It is in the row, it comes");
Console.WriteLine("     back in the Content-Disposition header on download, and the user");
Console.WriteLine("     never notices that it was not what the file was called.");
Console.WriteLine();
Console.WriteLine("   EVERY REFUSAL IS A STATUS CODE, not a closed connection, because this");
Console.WriteLine("   endpoint took over its own size limit and reads past its cap rather than");
Console.WriteLine("   letting the server cut the client off mid-sentence.");
Console.WriteLine();
Console.WriteLine("   WHAT IS DELIBERATELY NOT HERE:");
Console.WriteLine();
Console.WriteLine("     NO VIRUS SCAN. That needs the whole file and takes seconds; it belongs");
Console.WriteLine("     in a background job with the receipt marked unavailable until it");
Console.WriteLine("     clears, not in the request.");
Console.WriteLine();
Console.WriteLine("     NO IMAGE DECODING. Decoding an image is running a parser on hostile");
Console.WriteLine("     input. If you need dimensions or a thumbnail, do it out of the request");
Console.WriteLine("     path, in a process that can be killed without taking the API with it.");
Console.WriteLine();
Console.WriteLine("     NO SWEEPER, because it cannot live in an endpoint. A job that deletes");
Console.WriteLine("     '.partial' files older than an hour is the only thing that covers a");
Console.WriteLine("     process killed between the write and the move.");
Console.WriteLine();
Console.WriteLine("   AND THE ORDER OF THE SEVEN DECISIONS IS NOT ARBITRARY. Each one is");
Console.WriteLine("   possible only because the ones before it have already happened: you can");
Console.WriteLine("   only check the signature early because you are streaming, and you can");
Console.WriteLine("   only stream because you did not bind to IFormFile.");

// ---------------------------------------------------------------------------
// Fills the buffer as far as the stream allows. A single Read may return fewer
// bytes than asked for even when more are coming, which is the bug that makes
// signature checks pass and fail at random under load.
static async Task<int> ReadAtLeast(Stream stream, byte[] buffer)
{
    int total = 0;
    int read;

    while (total < buffer.Length
        && (read = await stream.ReadAsync(buffer.AsMemory(total))) > 0)
    {
        total += read;
    }

    return total;
}

// ---------------------------------------------------------------------------
static string Sniff(ReadOnlySpan<byte> head)
{
    if (head.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }))
    {
        return "jpeg";
    }

    if (head.StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
    {
        return "png";
    }

    if (head.StartsWith("%PDF"u8))
    {
        return "pdf";
    }

    return "unknown";
}

// ---------------------------------------------------------------------------
static string ExtensionFor(string format) => format switch
{
    "jpeg" => "jpg",
    "png" => "png",
    _ => "pdf"
};

// ---------------------------------------------------------------------------
static string ContentTypeFor(string format) => format switch
{
    "jpeg" => "image/jpeg",
    "png" => "image/png",
    _ => "application/pdf"
};

// ---------------------------------------------------------------------------
static IResult Problem(int status, string title, string detail) =>
    Results.Problem(title: title, detail: detail, statusCode: status);

// ---------------------------------------------------------------------------
static async Task<string> Upload(HttpClient http, string filename, byte[] bytes)
{
    using var content = new MultipartFormDataContent();
    content.Add(new ByteArrayContent(bytes), "file", filename);

    return await Send(http, content);
}

// ---------------------------------------------------------------------------
static async Task<string> UploadNoFile(HttpClient http)
{
    using var content = new MultipartFormDataContent();
    content.Add(new StringContent("2026-09-06"), "date");

    return await Send(http, content);
}

// ---------------------------------------------------------------------------
static async Task<string> Send(HttpClient http, MultipartFormDataContent content)
{
    try
    {
        using HttpResponseMessage response = await http.PostAsync("/v1/receipts", content);
        string body = await response.Content.ReadAsStringAsync();

        string summary = response.IsSuccessStatusCode
            ? "created"
            : System.Text.Json.JsonDocument.Parse(body).RootElement
                .TryGetProperty("title", out System.Text.Json.JsonElement title)
                    ? title.GetString() ?? ""
                    : "";

        return $"{(int)response.StatusCode}  {summary}";
    }
    catch (Exception exception)
    {
        return exception.GetType().Name;
    }
}

// ---------------------------------------------------------------------------
record Receipt(string Id, string OriginalFilename, string Format, long Bytes);
