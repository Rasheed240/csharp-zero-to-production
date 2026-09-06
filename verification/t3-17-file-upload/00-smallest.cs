// 00-smallest.cs — Accepting a file the shortest way, and the four things that
// upload has already decided for you.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every byte count and status code here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

string storage = Directory.CreateTempSubdirectory("uploads").FullName;

var statuses = new List<string>();

var app = builder.Build();

// Records what the server actually answered, because a rejected upload does
// not always reach the client as a status code - see the 40 MB row.
app.Use(async (context, next) =>
{
    await next(context);

    statuses.Add($"{context.Response.StatusCode}");
});

// The shortest thing that works, and what most examples show.
app.MapPost("/v1/receipts", async (IFormFile file) =>
{
    string path = Path.Combine(storage, file.FileName);

    await using FileStream target = File.Create(path);
    await file.CopyToAsync(target);

    return Results.Ok(new
    {
        file.FileName,
        file.ContentType,
        file.Length,
        savedTo = Path.GetRelativePath(storage, path)
    });
})
.DisableAntiforgery();

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Uploading a receipt");
Console.WriteLine();

// A real JPEG starts with these three bytes. The rest is invented.
byte[] jpeg = [0xFF, 0xD8, 0xFF, .. Encoding.UTF8.GetBytes("a small receipt image")];

Console.WriteLine($"   ordinary upload   {await Upload(http, "receipt.jpg", "image/jpeg", jpeg)}");
Console.WriteLine();

Console.WriteLine("   Four things that endpoint has already decided, none of them deliberately:");
Console.WriteLine();

// 1. It trusts the client's filename.
Console.WriteLine($"   a filename with a path   " +
    $"{await Upload(http, "../../escaped.txt", "text/plain", Encoding.UTF8.GetBytes("x"))}");

// 2. It trusts the client's content type.
byte[] executable = [0x4D, 0x5A, .. Encoding.UTF8.GetBytes("this is not an image")];

Console.WriteLine($"   a program called .jpg    " +
    $"{await Upload(http, "harmless.jpg", "image/jpeg", executable)}");

// 3. It has a size limit, and it is not one anybody chose.
byte[] large = new byte[40 * 1024 * 1024];

Console.WriteLine($"   a 40 MB file             {await Upload(http, "big.bin", "application/octet-stream", large)}");

// 4. It read the whole file before the handler ran.
Console.WriteLine();

await app.StopAsync();

Console.WriteLine($"   what the SERVER answered   {string.Join(", ", statuses)}");
Console.WriteLine();
Console.WriteLine("   THE LAST ROW IS THE INTERESTING ONE. The server rejected the 40 MB");
Console.WriteLine("   upload with a 413, and the client saw a broken connection rather than a");
Console.WriteLine("   status code - because the server stopped reading and closed the");
Console.WriteLine("   connection while the client was still sending.");
Console.WriteLine();
Console.WriteLine("   That is worth knowing before you debug it: A SIZE LIMIT OFTEN REACHES");
Console.WriteLine("   THE CLIENT AS A NETWORK ERROR, so a caller reporting 'the connection");
Console.WriteLine("   dropped' may be describing a limit working exactly as configured.");
Console.WriteLine();

string[] written = [.. Directory.GetFiles(storage, "*", SearchOption.AllDirectories)
    .Select(f => Path.GetRelativePath(storage, f))];

Console.WriteLine($"   files in the upload directory   {written.Length}");

foreach (string file in written)
{
    Console.WriteLine($"     {file}");
}

// Where '../../escaped.txt' actually resolves to, computed rather than
// searched - the search would need permission to read the whole temp tree.
string escapedPath = Path.GetFullPath(Path.Combine(storage, "../../escaped.txt"));

Console.WriteLine();
Console.WriteLine($"   the upload directory            {storage}");
Console.WriteLine($"   where '../../escaped.txt' went  {escapedPath}");
Console.WriteLine($"   is that inside the directory    " +
    $"{escapedPath.StartsWith(storage, StringComparison.OrdinalIgnoreCase)}");
Console.WriteLine($"   does the file exist there       {File.Exists(escapedPath)}");

if (File.Exists(escapedPath))
{
    File.Delete(escapedPath);
}

Directory.Delete(storage, recursive: true);

Console.WriteLine();
Console.WriteLine("   THE FOUR DECISIONS, and each is a section of this module:");
Console.WriteLine();
Console.WriteLine("     1. THE FILENAME CAME FROM THE CLIENT and was used to build a path.");
Console.WriteLine("        Whether that escaped the upload directory is above.");
Console.WriteLine();
Console.WriteLine("     2. THE CONTENT TYPE CAME FROM THE CLIENT and describes nothing. A");
Console.WriteLine("        program was accepted as an image because the client said so.");
Console.WriteLine();
Console.WriteLine("     3. THE SIZE LIMIT IS A DEFAULT nobody chose, applied at a layer nobody");
Console.WriteLine("        looked at, and the error it produces says so.");
Console.WriteLine();
Console.WriteLine("     4. THE WHOLE FILE WAS READ BEFORE THE HANDLER RAN. IFormFile is a file");
Console.WriteLine("        that already exists somewhere by the time you see it, which is the");
Console.WriteLine("        subject of the next file.");
Console.WriteLine();
Console.WriteLine("   None of those is a bug in ASP.NET Core. Every one is a decision the");
Console.WriteLine("   framework cannot make for you, defaulted to whatever costs least to");
Console.WriteLine("   implement.");

// ---------------------------------------------------------------------------
static async Task<string> Upload(HttpClient http, string filename, string contentType, byte[] bytes)
{
    using var content = new MultipartFormDataContent();
    var part = new ByteArrayContent(bytes);

    part.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
    content.Add(part, "file", filename);

    try
    {
        using HttpResponseMessage response = await http.PostAsync("/v1/receipts", content);
        string body = await response.Content.ReadAsStringAsync();

        return $"{(int)response.StatusCode}  {(body.Length > 88 ? body[..88] + "..." : body)}";
    }
    catch (Exception exception)
    {
        return $"the request failed: {exception.GetType().Name}";
    }
}
