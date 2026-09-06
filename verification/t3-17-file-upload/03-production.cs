// 03-production.cs — The uploads that retried themselves into a full disk.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: the byte counts, file counts and status codes are exact. The
// incident narrative is a composite; the MECHANISM is measured here.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

Console.WriteLine("An incident: 'the disk is full and nothing is uploading'");
Console.WriteLine();

TheIncident();
await WhyTheClientRetried();
await WhichAttemptsLeakedAndWhy();
await MakingTheRefusalArrive();
await TheFix();
WhatToWatch();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   A receipts API. Mobile clients upload a photo of a receipt; the API");
    Console.WriteLine("   stores it and returns an id. It had run for eight months.");
    Console.WriteLine();
    Console.WriteLine("     02:14   Readiness fails on one instance. It is replaced. The");
    Console.WriteLine("             replacement fails readiness four minutes later.");
    Console.WriteLine();
    Console.WriteLine("     02:31   EVERY endpoint is returning 500, including the ones that");
    Console.WriteLine("             touch nothing but memory. The database is healthy.");
    Console.WriteLine();
    Console.WriteLine("     02:40   Someone gets a shell on an instance. The volume holding");
    Console.WriteLine("             uploads is at 100%. 480,000 files, most of them around");
    Console.WriteLine("             8 MB, all named with a GUID and the suffix '.partial'.");
    Console.WriteLine();
    Console.WriteLine("     02:55   The directory is emptied. Everything recovers. Nobody");
    Console.WriteLine("             knows why there were 480,000 partial files.");
    Console.WriteLine();
    Console.WriteLine("     09:00   The upload graph is normal. Requests per second is normal.");
    Console.WriteLine("             The 4xx rate is normal. NOTHING ON THE DASHBOARD MOVED.");
    Console.WriteLine();
    Console.WriteLine("   THE SHAPE OF THIS ONE IS WORTH NOTING BEFORE THE CAUSE. A resource");
    Console.WriteLine("   that is not memory and not CPU filled up, and it took every endpoint");
    Console.WriteLine("   down rather than the one that caused it. Uploads are the most common");
    Console.WriteLine("   way for a web service to acquire a resource nobody is watching.");
    Console.WriteLine();
    Console.WriteLine("   AND ONE DETAIL TO HOLD ON TO: only SOME clients were affected. The");
    Console.WriteLine("   partial files were a fraction of the traffic, which is why it took six");
    Console.WriteLine("   weeks. Section 3 finds out which fraction, and it is not the one you");
    Console.WriteLine("   would guess.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhyTheClientRetried()
{
    Console.WriteLine("2. Why a client that was working correctly retried forever");
    Console.WriteLine();
    Console.WriteLine("   The first question is why there were so many attempts. Here is what");
    Console.WriteLine("   the server did, and what the client made of it.");
    Console.WriteLine();

    string storage = Directory.CreateTempSubdirectory("incident").FullName;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    // The production setting: 8 MB, chosen years ago for photos from phones
    // that took smaller photos.
    builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 8L * 1024 * 1024);

    var app = builder.Build();

    bool handlerRan = false;
    string finalStatus = "";

    // Stands in for whatever records request metrics. It sees what the app
    // layer sees, which turns out not to be what happened.
    app.Use(async (context, next) =>
    {
        await next(context);

        finalStatus = $"{context.Response.StatusCode}";
    });

    app.MapPost("/v1/receipts", async (HttpContext context) =>
    {
        handlerRan = true;

        await Store(context, storage);

        return Results.Ok();
    }).DisableAntiforgery();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   upload size   handler ran   pipeline recorded   what the CLIENT saw");
    Console.WriteLine("   -----------   -----------   -----------------   -------------------");

    foreach (int megabytes in new[] { 4, 12 })
    {
        handlerRan = false;
        finalStatus = "nothing";

        string seen = await Upload(http, megabytes * 1024 * 1024);

        Console.WriteLine($"   {megabytes,8} MB   {handlerRan,-11}   {finalStatus,-17}   {seen}");
    }

    await app.StopAsync();
    await app.DisposeAsync();
    Directory.Delete(storage, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   THE OVERSIZED UPLOAD DID NOT REACH THE CLIENT AS A STATUS CODE. The");
    Console.WriteLine("   server refused to finish reading the body and closed the connection");
    Console.WriteLine("   while the client was still sending, so the client saw a TRANSPORT");
    Console.WriteLine("   failure with no status code in it at all.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE WHOLE MECHANISM, and it is reasonable behaviour on both");
    Console.WriteLine("   sides:");
    Console.WriteLine();
    Console.WriteLine("     THE SERVER cannot politely answer a request whose body it has");
    Console.WriteLine("     refused to finish reading. There is more of the request arriving.");
    Console.WriteLine();
    Console.WriteLine("     THE CLIENT'S retry policy - the sensible, off-the-shelf one - treats");
    Console.WriteLine("     a broken connection as TRANSIENT and a 4xx as PERMANENT. It retried,");
    Console.WriteLine("     because it was told the network failed.");
    Console.WriteLine();
    Console.WriteLine("   NOW THE MIDDLE COLUMNS, which are the reason the dashboards were");
    Console.WriteLine("   flat, and they are not what you would expect:");
    Console.WriteLine();
    Console.WriteLine("     THE HANDLER DID RUN. The request was routed, the endpoint was");
    Console.WriteLine("     invoked, and it began reading. This is not a request that Kestrel");
    Console.WriteLine("     turned away before your application saw it.");
    Console.WriteLine();
    Console.WriteLine("     THE MIDDLEWARE RECORDED NOTHING. It is written the way almost all");
    Console.WriteLine("     request instrumentation is written - call next, then record what");
    Console.WriteLine("     happened - and the failed read threw straight past the line that");
    Console.WriteLine("     records. There was no exception handler above it, so the request");
    Console.WriteLine("     left no entry at all.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS A GENERAL BUG AND IT IS NOT ABOUT UPLOADS: ANY MIDDLEWARE");
    Console.WriteLine("   THAT RECORDS AFTER await next(context) RECORDS ONLY THE REQUESTS THAT");
    Console.WriteLine("   DID NOT THROW. It is a metric that goes quiet precisely when things");
    Console.WriteLine("   are going wrong, and it looks identical to a metric that is telling");
    Console.WriteLine("   you everything is fine. The fix is a try/finally, and the reason to");
    Console.WriteLine("   remember it is that the failure is invisible by construction.");
    Console.WriteLine();
    Console.WriteLine("   Phones got better cameras. Photos crossed 8 MB. A slice of users");
    Console.WriteLine("   entered a retry loop that no graph in the building could see.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhichAttemptsLeakedAndWhy()
{
    Console.WriteLine("3. Which attempts left a file, and which did not");
    Console.WriteLine();
    Console.WriteLine("   A retry loop is a nuisance. It became an outage because of what some");
    Console.WriteLine("   of the attempts left behind. SOME. The difference between the two");
    Console.WriteLine("   kinds is the part of this incident that took longest to find.");
    Console.WriteLine();

    string storage = Directory.CreateTempSubdirectory("incident").FullName;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 8L * 1024 * 1024);

    var app = builder.Build();

    bool fileCreated = false;

    // The handler as it was written. It streams, which is the right instinct,
    // and it writes to a '.partial' file and renames on success, which is also
    // the right instinct. What it never does is clean up when it does not
    // reach the rename.
    app.MapPost("/v1/receipts", async (HttpContext context) =>
    {
        await Store(context, storage, onCreate: () => fileCreated = true);

        return Results.Ok();
    }).DisableAntiforgery();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   how the client sent it        got as far as     files left   bytes on disk");
    Console.WriteLine("   ----------------------        -------------     ----------   -------------");

    foreach (bool chunked in new[] { false, true })
    {
        fileCreated = false;

        await Upload(http, 12 * 1024 * 1024, chunked);

        FileInfo[] files = new DirectoryInfo(storage).GetFiles();

        Console.WriteLine($"   {(chunked ? "chunked, no length header" : "with Content-Length"),-27}   " +
            $"{(fileCreated ? "opening the file" : "reading headers"),-16}  {files.Length,10}   " +
            $"{files.Sum(f => f.Length) / 1024.0 / 1024.0,10:0.0} MB");
    }

    await app.StopAsync();
    await app.DisposeAsync();
    Directory.Delete(storage, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   TWO CLIENTS SENDING THE SAME 12 MB FILE TO THE SAME ENDPOINT, and");
    Console.WriteLine("   only one of them left anything on the disk.");
    Console.WriteLine();
    Console.WriteLine("     WITH CONTENT-LENGTH, Kestrel knows the body is too big before it");
    Console.WriteLine("     reads any of it. The very first read from the body throws. The");
    Console.WriteLine("     handler never reaches File.Create, so there is nothing to leak.");
    Console.WriteLine();
    Console.WriteLine("     CHUNKED, there is no declared length to check. Kestrel can only");
    Console.WriteLine("     COUNT, so the body streams in and the limit trips somewhere in the");
    Console.WriteLine("     middle - by which point the handler has created its file and copied");
    Console.WriteLine("     most of 8 MB into it. The exception unwinds past the rename and the");
    Console.WriteLine("     file stays.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS WHY IT TOOK SIX WEEKS AND WHY IT LOOKED RANDOM. A client that");
    Console.WriteLine("   loads the photo into memory first sends a Content-Length and leaks");
    Console.WriteLine("   nothing. A client that streams the photo from the camera roll cannot");
    Console.WriteLine("   know the length in advance, sends it chunked, and leaks 8 MB per");
    Console.WriteLine("   attempt. ONE APP VERSION CHANGED HOW IT READ THE FILE and the leak");
    Console.WriteLine("   began - with no change on the server at all.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL FORM IS WORTH MORE THAN THE SPECIFIC BUG: A LIMIT ENFORCED");
    Console.WriteLine("   ON A DECLARED VALUE FAILS EARLY AND CHEAPLY; THE SAME LIMIT ENFORCED");
    Console.WriteLine("   BY COUNTING FAILS LATE AND HALFWAY THROUGH WHATEVER YOU WERE DOING.");
    Console.WriteLine("   Everything you do before that count is reached, you must be prepared");
    Console.WriteLine("   to undo.");
    Console.WriteLine();
    Console.WriteLine("   AND NOTE WHAT WAS NOT WRONG. The handler streamed rather than");
    Console.WriteLine("   buffering. It wrote to a temporary name and renamed on success, so no");
    Console.WriteLine("   half-written file was ever visible as a real receipt. Both are the");
    Console.WriteLine("   recommended patterns. THE BUG IS THE MISSING CLEANUP on the path that");
    Console.WriteLine("   ends without reaching the rename - the path nobody writes a test for.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task MakingTheRefusalArrive()
{
    Console.WriteLine("4. Getting the refusal to the client at all");
    Console.WriteLine();
    Console.WriteLine("   Cleaning up the file stops the disk filling. It does not stop the");
    Console.WriteLine("   retry loop, because the client still cannot tell a refusal from a");
    Console.WriteLine("   network fault. The obvious fix - check the size and return 413 before");
    Console.WriteLine("   reading anything - does not work, and it is worth seeing why.");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 8L * 1024 * 1024);

    var app = builder.Build();

    // Refuse at once and never touch the body.
    app.MapPost("/refuse-now", () => Results.StatusCode(413)).DisableAntiforgery();

    // Refuse, but read the body to its end first so the client finishes
    // sending and there is a live connection to answer on.
    app.MapPost("/refuse-after-draining", async (HttpContext context) =>
    {
        // The drain must be allowed to exceed the limit, or the read that
        // drains it throws for the same reason the handler did.
        context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = null;

        await context.Request.Body.CopyToAsync(Stream.Null);

        return Results.StatusCode(413);
    }).DisableAntiforgery();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   server behaviour        client sends Expect: 100-continue   client saw");
    Console.WriteLine("   ----------------        ---------------------------------   ----------");

    foreach (string path in new[] { "/refuse-now", "/refuse-after-draining" })
    {
        foreach (bool expectContinue in new[] { false, true })
        {
            string seen = await Upload(http, 12 * 1024 * 1024, expectContinue: expectContinue, path: path);

            Console.WriteLine($"   {path,-22}  {(expectContinue ? "yes" : "no"),-33}   {seen}");
        }
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THREE OUTCOMES, AND THEY ARE A REAL TRADE-OFF:");
    Console.WriteLine();
    Console.WriteLine("     REFUSING IMMEDIATELY IS THE FASTEST AND THE CLIENT DOES NOT GET IT.");
    Console.WriteLine("     You wrote a response while 12 MB was still arriving; the connection");
    Console.WriteLine("     is torn down before the client is in a position to read it. The");
    Console.WriteLine("     handler was correct, the response was correct, and the client saw a");
    Console.WriteLine("     network error. THIS IS THE FIX MOST PEOPLE WRITE FIRST, and it");
    Console.WriteLine("     changes the server logs without changing the client's behaviour.");
    Console.WriteLine();
    Console.WriteLine("     DRAINING THE BODY FIRST ALWAYS DELIVERS THE 413. You read and");
    Console.WriteLine("     discard the whole upload so that the exchange completes normally,");
    Console.WriteLine("     then answer. It costs you the entire transfer to refuse it, which");
    Console.WriteLine("     is galling, and it is often the right price: a client that stops");
    Console.WriteLine("     retrying is worth more than the bandwidth of one refusal.");
    Console.WriteLine();
    Console.WriteLine("     EXPECT: 100-CONTINUE MAKES THE PROBLEM DISAPPEAR. The client sends");
    Console.WriteLine("     the headers first and waits for permission before sending the body.");
    Console.WriteLine("     Refusing costs nothing, arrives cleanly, and the 12 MB is never");
    Console.WriteLine("     sent. THE CATCH IS THAT THE CLIENT MUST OPT IN - you cannot make");
    Console.WriteLine("     this happen from the server, and most HTTP clients do not do it by");
    Console.WriteLine("     default. In .NET it is one line on the request:");
    Console.WriteLine();
    Console.WriteLine("       request.Headers.ExpectContinue = true;");
    Console.WriteLine();
    Console.WriteLine("   IF YOU OWN BOTH SIDES - a mobile app and its API - turning that on for");
    Console.WriteLine("   uploads is the highest-value line in this module. If you do not own");
    Console.WriteLine("   the client, drain before refusing, and treat the wasted transfer as");
    Console.WriteLine("   the cost of an error the caller can actually act on.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheFix()
{
    Console.WriteLine("5. The handler that was deployed");
    Console.WriteLine();
    Console.WriteLine("   The first attempt combined the two fixes in the obvious way: catch the");
    Console.WriteLine("   failure, drain, return 413, delete the file in a finally. It half");
    Console.WriteLine("   worked, and the half that failed says something important.");
    Console.WriteLine();

    string storage = Directory.CreateTempSubdirectory("attempt").FullName;

    var first = WebApplication.CreateBuilder();
    first.WebHost.UseUrls("http://127.0.0.1:0");
    first.Logging.ClearProviders();
    first.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 8L * 1024 * 1024);

    var attempt = first.Build();
    string drainResult = "";

    attempt.MapPost("/v1/receipts", async (HttpContext context) =>
    {
        string partial = Path.Combine(storage, $"{Guid.NewGuid():n}.partial");

        try
        {
            await Store(context, storage, partialPath: partial);

            return Results.Ok();
        }
        catch (BadHttpRequestException)
        {
            try
            {
                // Lift the limit so the drain itself is not refused.
                context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = null;
                await context.Request.Body.CopyToAsync(Stream.Null);

                drainResult = "drained";
            }
            catch (Exception exception)
            {
                drainResult = $"{exception.GetType().Name}: {exception.Message}";
            }

            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge);
        }
        finally
        {
            if (File.Exists(partial))
            {
                File.Delete(partial);
            }
        }
    }).DisableAntiforgery();

    await attempt.StartAsync();
    using (var http = new HttpClient { BaseAddress = new Uri(attempt.Urls.First()) })
    {
        string seen = await Upload(http, 12 * 1024 * 1024, chunked: true);

        Console.WriteLine($"   files left on disk   {new DirectoryInfo(storage).GetFiles().Length}");
        Console.WriteLine($"   what the client saw  {seen}");
        Console.WriteLine($"   what the drain did   {drainResult}");
    }

    await attempt.StopAsync();
    await attempt.DisposeAsync();
    Directory.Delete(storage, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   THE CLEANUP WORKED AND THE DRAIN DID NOT, and the exception message");
    Console.WriteLine("   is the whole explanation: THE LIMIT CANNOT BE CHANGED ONCE YOU HAVE");
    Console.WriteLine("   STARTED READING THE BODY. By the time you know the upload is too big,");
    Console.WriteLine("   it is too late to give yourself permission to finish reading it.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL LESSON IS BIGGER THAN THE API: THE DECISION ABOUT WHAT TO");
    Console.WriteLine("   DO WITH AN OVERSIZED UPLOAD HAS TO BE MADE BEFORE THE FIRST READ. Not");
    Console.WriteLine("   when it fails - before it starts. An endpoint that wants to answer");
    Console.WriteLine("   politely has to arrange that in advance.");
    Console.WriteLine();
    Console.WriteLine("   So the endpoint takes the limit over. It tells the server not to");
    Console.WriteLine("   enforce one, counts bytes itself, and keeps reading past its own cap");
    Console.WriteLine("   so it can answer:");
    Console.WriteLine();

    string kept = Directory.CreateTempSubdirectory("fixed").FullName;

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 8L * 1024 * 1024);

    var app = builder.Build();

    const long Cap = 8L * 1024 * 1024;

    app.MapPost("/v1/receipts", async (HttpContext context) =>
    {
        // Before the first read, and only on this endpoint: this handler is
        // now responsible for the limit it removed.
        context.Features.Get<IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = null;

        string partial = Path.Combine(kept, $"{Guid.NewGuid():n}.partial");

        try
        {
            MediaTypeHeaderValue media = MediaTypeHeaderValue.Parse(context.Request.ContentType!);
            string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value!;

            var reader = new MultipartReader(boundary, context.Request.Body);
            bool tooBig = false;

            while (await reader.ReadNextSectionAsync() is { } section)
            {
                await using FileStream target = File.Create(partial);

                byte[] buffer = new byte[8192];
                long written = 0;
                int read;

                while ((read = await section.Body.ReadAsync(buffer)) > 0)
                {
                    written += read;

                    // Past the cap, keep READING and stop WRITING. The read
                    // is what lets the client finish and hear the answer; the
                    // write is what would cost disk.
                    if (written > Cap)
                    {
                        tooBig = true;

                        continue;
                    }

                    await target.WriteAsync(buffer.AsMemory(0, read));
                }
            }

            if (tooBig)
            {
                return Results.Problem(
                    title: "Upload too large",
                    detail: "Receipts must be 8 MB or smaller.",
                    statusCode: StatusCodes.Status413PayloadTooLarge);
            }

            File.Move(partial, Path.ChangeExtension(partial, ".jpg"));

            return Results.Ok();
        }
        finally
        {
            // The line the incident was missing.
            if (File.Exists(partial))
            {
                File.Delete(partial);
            }
        }
    }).DisableAntiforgery();

    await app.StartAsync();
    using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   attempt   sent as    client saw                 files left   bytes on disk");
    Console.WriteLine("   -------   -------    ----------                 ----------   -------------");

    for (int i = 1; i <= 4; i++)
    {
        string seen = await Upload(client, 12 * 1024 * 1024, chunked: true);

        FileInfo[] files = new DirectoryInfo(kept).GetFiles();

        Console.WriteLine($"   {i,7}   chunked    {seen,-25}  {files.Length,10}   " +
            $"{files.Sum(f => f.Length) / 1024.0 / 1024.0,10:0.0} MB");
    }

    Console.WriteLine();
    Console.WriteLine("   and an upload within the limit, to show the endpoint still works:");
    Console.WriteLine($"   {await Upload(client, 4 * 1024 * 1024, chunked: true)}");
    Console.WriteLine($"   files kept   {new DirectoryInfo(kept).GetFiles().Length}");

    await app.StopAsync();
    await app.DisposeAsync();
    Directory.Delete(kept, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   THE CLIENT NOW GETS A STATUS CODE, so its retry policy stops. THE");
    Console.WriteLine("   DISK STAYS EMPTY, so a retry loop from any other cause cannot fill it.");
    Console.WriteLine("   Either change alone would have shortened the incident; only the pair");
    Console.WriteLine("   prevents it.");
    Console.WriteLine();
    Console.WriteLine("   READ THE INNER LOOP AGAIN, because it is the unusual part: PAST THE");
    Console.WriteLine("   CAP IT KEEPS READING AND STOPS WRITING. Reading is what buys the");
    Console.WriteLine("   ability to answer; writing is what costs disk. Separating the two is");
    Console.WriteLine("   what lets you refuse politely without paying for the refusal, and it");
    Console.WriteLine("   is invisible unless you have watched a limit fail the other way.");
    Console.WriteLine();
    Console.WriteLine("   WHAT THIS ENDPOINT GAVE UP is the server-level limit. It is now the");
    Console.WriteLine("   only thing standing between a hostile client and an unbounded read,");
    Console.WriteLine("   so the counter has to be right and it has to be inside the loop.");
    Console.WriteLine("   THAT TRADE IS PER-ENDPOINT AND DELIBERATE: every other endpoint in the");
    Console.WriteLine("   app keeps Kestrel's limit, including the ones written after you left.");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD CHANGE IS NOT IN THE CODE, BECAUSE IT CANNOT BE: A SWEEPER.");
    Console.WriteLine("   A background job that deletes '.partial' files older than an hour. The");
    Console.WriteLine("   finally block handles the failures you thought of; the sweeper handles");
    Console.WriteLine("   the process that was killed between the write and the rename, which no");
    Console.WriteLine("   finally block can. ANY SCHEME WITH A TEMPORARY STATE NEEDS SOMETHING");
    Console.WriteLine("   THAT CLEANS UP TEMPORARY STATE, because a process can stop between any");
    Console.WriteLine("   two instructions you write.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToWatch()
{
    Console.WriteLine("6. What would have caught it");
    Console.WriteLine();
    Console.WriteLine("   FREE SPACE AND INODE COUNT ON EVERY WRITABLE VOLUME. Not the");
    Console.WriteLine("   database's volume - all of them, including the one you forgot the");
    Console.WriteLine("   service writes to. This incident was six weeks of a straight line on");
    Console.WriteLine("   a graph nobody had.");
    Console.WriteLine();
    Console.WriteLine("   THE COUNT AND AGE OF INCOMPLETE UPLOADS. One gauge: how many");
    Console.WriteLine("   '.partial' files exist and how old the oldest is. Under healthy");
    Console.WriteLine("   operation it is near zero and seconds old. It went to five figures.");
    Console.WriteLine();
    Console.WriteLine("   RESPONSES THE CLIENT NEVER RECEIVED. Section 2 is the uncomfortable");
    Console.WriteLine("   one: the pipeline recorded a status for a response that was never");
    Console.WriteLine("   delivered. Kestrel counts aborted connections; your request metrics");
    Console.WriteLine("   do not. If the two disagree, the difference is requests your service");
    Console.WriteLine("   believes it answered and the caller believes it failed.");
    Console.WriteLine();
    Console.WriteLine("   THE SIZE DISTRIBUTION OF ACCEPTED UPLOADS, not the average. The");
    Console.WriteLine("   average was well under 8 MB throughout. The 99th percentile had been");
    Console.WriteLine("   climbing toward the limit for a year, and a percentile pressed");
    Console.WriteLine("   against a hard limit is the shape of traffic being silently refused.");
    Console.WriteLine();
    Console.WriteLine("   AND A REVIEW QUESTION, cheaper than all of them: FOR EVERY LIMIT, WHAT");
    Console.WriteLine("   DOES THE CLIENT SEE WHEN IT TRIPS? If the answer is 'a closed");
    Console.WriteLine("   connection', you have a limit that clients will retry against, and a");
    Console.WriteLine("   retry loop is a load generator you installed yourself.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// Streams the multipart body to a '.partial' file and renames it on success.
// This is the handler from the incident: correct on the happy path, and it
// leaves the partial file behind on every other path.
static async Task Store(HttpContext context, string storage, string? partialPath = null,
    Action? onCreate = null)
{
    MediaTypeHeaderValue media = MediaTypeHeaderValue.Parse(context.Request.ContentType!);
    string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value!;

    var reader = new MultipartReader(boundary, context.Request.Body);
    string partial = partialPath ?? Path.Combine(storage, $"{Guid.NewGuid():n}.partial");

    while (await reader.ReadNextSectionAsync() is { } section)
    {
        onCreate?.Invoke();

        await using FileStream target = File.Create(partial);
        await section.Body.CopyToAsync(target);
    }

    File.Move(partial, Path.ChangeExtension(partial, ".jpg"));
}

// ---------------------------------------------------------------------------
static async Task<string> Upload(HttpClient http, int size, bool chunked = false,
    bool expectContinue = false, string path = "/v1/receipts")
{
    using var content = new MultipartFormDataContent();

    // A client that streams the file cannot declare a length, so the request
    // goes out chunked. One that loads it into memory first declares one.
    content.Add(chunked
        ? new StreamContent(new UnmeasurableStream(size))
        : new ByteArrayContent(new byte[size]), "file", "receipt.jpg");

    var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = content };
    request.Headers.ExpectContinue = expectContinue;

    try
    {
        using HttpResponseMessage response = await http.SendAsync(request);

        return $"{(int)response.StatusCode} {response.StatusCode}";
    }
    catch (Exception exception)
    {
        return exception.GetType().Name;
    }
}

// ---------------------------------------------------------------------------
// Produces a known number of bytes while refusing to report its length, which
// is what makes HttpClient send the request with chunked transfer encoding and
// no Content-Length header.
sealed class UnmeasurableStream(long size) : Stream
{
    long produced;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        int take = (int)Math.Min(count, size - produced);
        produced += take;

        return take;
    }

    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
