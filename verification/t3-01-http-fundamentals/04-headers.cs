// 04-headers.cs — Content negotiation, conditional requests, and the caching
// headers that decide whether a request happens at all.
//
// Run:  dotnet run 04-headers.cs -c Release
//
// EXACT vs RATIO: status codes, header values and byte counts are deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true

using System.Net.Http.Headers;
using System.Text;

const string PayloadJson = """{"id":"PAY-0001","amountMinor":123450,"currency":"GBP"}""";
const string PayloadXml = "<payment><id>PAY-0001</id><amountMinor>123450</amountMinor></payment>";

// A weak-looking but perfectly ordinary strong ETag over the payload.
string etag = "\"" + Convert.ToHexString(
    System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(PayloadJson)))[..16] + "\"";

int fullResponses = 0;
int notModified = 0;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// Content negotiation: look at Accept and choose a representation.
app.MapGet("/payment", (HttpRequest request) =>
{
    string accept = request.Headers.Accept.ToString();

    if (accept.Contains("application/xml", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Text(PayloadXml, "application/xml");
    }

    if (accept.Contains("application/json", StringComparison.OrdinalIgnoreCase) ||
        accept.Contains("*/*", StringComparison.Ordinal) ||
        accept.Length == 0)
    {
        return Results.Text(PayloadJson, "application/json");
    }

    // The client asked for something we cannot produce.
    return Results.StatusCode(406);
});

// A conditional endpoint: returns 304 when the client already has this version.
app.MapGet("/payment/cached", (HttpRequest request, HttpResponse response) =>
{
    response.Headers.ETag = etag;
    response.Headers.CacheControl = "private, max-age=60";

    string? ifNoneMatch = request.Headers.IfNoneMatch.ToString();
    if (!string.IsNullOrEmpty(ifNoneMatch) && ifNoneMatch == etag)
    {
        notModified++;
        return Results.StatusCode(304);
    }

    fullResponses++;
    return Results.Text(PayloadJson, "application/json");
});

app.MapGet("/headers", (HttpRequest request) =>
    Results.Text(string.Join("\n", request.Headers.Select(h => $"{h.Key}: {h.Value}")), "text/plain"));

await app.StartAsync();
string baseUrl = app.Urls.First();

await ContentNegotiation(baseUrl);
await ConditionalRequests(baseUrl, etag);
CachingHeaders();
await HeaderRules(baseUrl);

Console.WriteLine();
Console.WriteLine($"   (server counted {fullResponses} full responses and {notModified} not-modified)");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task ContentNegotiation(string baseUrl)
{
    Console.WriteLine("1. Content negotiation");
    Console.WriteLine();
    Console.WriteLine("   The client says what it can accept; the server picks. Both headers");
    Console.WriteLine("   are needed and they point in opposite directions:");
    Console.WriteLine();
    Console.WriteLine("     Accept        (request)  what the CLIENT will take");
    Console.WriteLine("     Content-Type  (either)   what THIS body actually is");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    Console.WriteLine("   Accept sent                                status   Content-Type returned");
    Console.WriteLine("   -----------                                ------   ---------------------");

    await Negotiate(http, "application/json");
    await Negotiate(http, "application/xml");
    await Negotiate(http, "*/*");
    await Negotiate(http, "application/json, application/xml;q=0.9");
    await Negotiate(http, "text/csv");

    Console.WriteLine();
    Console.WriteLine("   The last row is 406 Not Acceptable: the client asked for something");
    Console.WriteLine("   the server cannot produce. Returning JSON anyway would be a lie the");
    Console.WriteLine("   client is not equipped to parse.");
    Console.WriteLine();
    Console.WriteLine("   Row four is the interesting one. The client asked for JSON at an");
    Console.WriteLine("   implied q=1 and XML at q=0.9 - a clear preference for JSON - and");
    Console.WriteLine("   this server returned XML.");
    Console.WriteLine();
    Console.WriteLine("   The q values are QUALITY weights from 0 to 1 saying how much the");
    Console.WriteLine("   client prefers each option, and absent means q=1. This server");
    Console.WriteLine("   ignores them completely: it checks for XML first, so XML wins");
    Console.WriteLine("   whenever it appears at all.");
    Console.WriteLine();
    Console.WriteLine("   That is not a bug in this file - it is what most hand-written");
    Console.WriteLine("   negotiation does, and it is why the SERVER'S CHECK ORDER, not the");
    Console.WriteLine("   client's stated preference, decides what comes back.");
    Console.WriteLine();
    Console.WriteLine("   If preference order matters to your callers, you have to parse and");
    Console.WriteLine("   sort by q yourself. MVC's formatter selection does; a chain of");
    Console.WriteLine("   Contains checks does not.");
    Console.WriteLine();

    static async Task Negotiate(HttpClient http, string accept)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/payment");
        request.Headers.TryAddWithoutValidation("Accept", accept);

        HttpResponseMessage response = await http.SendAsync(request);
        Console.WriteLine($"   {accept,-41}  {(int)response.StatusCode,6}   " +
            $"{response.Content.Headers.ContentType?.ToString() ?? "(none)"}");
    }
}

// ---------------------------------------------------------------------------
static async Task ConditionalRequests(string baseUrl, string etag)
{
    Console.WriteLine("2. Conditional requests: the response you do not send");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    // First request: no validator, so the server sends everything.
    HttpResponseMessage first = await http.GetAsync("/payment/cached");
    string body = await first.Content.ReadAsStringAsync();
    string? receivedEtag = first.Headers.ETag?.ToString();

    Console.WriteLine($"   first request");
    Console.WriteLine($"     status        : {(int)first.StatusCode}");
    Console.WriteLine($"     ETag          : {receivedEtag}");
    Console.WriteLine($"     Cache-Control : {first.Headers.CacheControl}");
    Console.WriteLine($"     body bytes    : {Encoding.UTF8.GetByteCount(body)}");
    Console.WriteLine();

    // Second request: send the validator back.
    using var conditional = new HttpRequestMessage(HttpMethod.Get, "/payment/cached");
    conditional.Headers.TryAddWithoutValidation("If-None-Match", receivedEtag);

    HttpResponseMessage second = await http.SendAsync(conditional);
    string secondBody = await second.Content.ReadAsStringAsync();

    Console.WriteLine($"   second request, with If-None-Match");
    Console.WriteLine($"     status        : {(int)second.StatusCode} {second.StatusCode}");
    Console.WriteLine($"     body bytes    : {Encoding.UTF8.GetByteCount(secondBody)}");
    Console.WriteLine();
    Console.WriteLine("   304 Not Modified means 'what you already have is current'. There is");
    Console.WriteLine("   no body, and the client uses its cached copy.");
    Console.WriteLine();
    Console.WriteLine("   Be clear about what this does and does not save. The request still");
    Console.WriteLine("   happened: a round trip, a connection, and whatever work the server");
    Console.WriteLine("   did to decide the ETag still matched. What it saves is the BODY.");
    Console.WriteLine();
    Console.WriteLine("   That is worth a great deal for a large payload and almost nothing");
    Console.WriteLine("   for a 60-byte one - and it is only free if computing the ETag is");
    Console.WriteLine("   cheaper than producing the body. An ETag computed by hashing the");
    Console.WriteLine("   body you have already generated saves bandwidth and no server work.");
    Console.WriteLine();
    Console.WriteLine("   The other half of the feature is CONCURRENCY control:");
    Console.WriteLine();
    Console.WriteLine("     If-None-Match  on GET    - send it only if it changed");
    Console.WriteLine("     If-Match       on PUT    - accept only if nobody else changed it");
    Console.WriteLine();
    Console.WriteLine("   If-Match turns a lost update into a 412 Precondition Failed. That");
    Console.WriteLine("   is optimistic concurrency over HTTP, and it costs one header.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void CachingHeaders()
{
    Console.WriteLine("3. Cache-Control, and who is allowed to keep a copy");
    Console.WriteLine();
    Console.WriteLine("   directive          meaning");
    Console.WriteLine("   ---------          -------");
    Console.WriteLine("   no-store           never write this down anywhere. For anything");
    Console.WriteLine("                      genuinely secret.");
    Console.WriteLine("   no-cache           you may store it, but revalidate every time");
    Console.WriteLine("                      before using it. NOT the same as no-store.");
    Console.WriteLine("   private            only the end client may cache. Shared caches -");
    Console.WriteLine("                      a CDN, a proxy - must not.");
    Console.WriteLine("   public             any cache may keep it, including shared ones.");
    Console.WriteLine("   max-age=N          usable without asking for N seconds.");
    Console.WriteLine("   must-revalidate    once stale, do not serve it; ask first.");
    Console.WriteLine();
    Console.WriteLine("   The two that get confused are no-cache and no-store, and the names");
    Console.WriteLine("   are the reason. NO-CACHE STILL CACHES - it revalidates first. If a");
    Console.WriteLine("   response must never touch a disk, no-store is the one.");
    Console.WriteLine();
    Console.WriteLine("   And the one that causes real incidents:");
    Console.WriteLine();
    Console.WriteLine("     Cache-Control: public, max-age=3600");
    Console.WriteLine();
    Console.WriteLine("   on a per-user response. A shared cache serves one user's data to");
    Console.WriteLine("   the next user who asks for the same URL, for an hour. Anything");
    Console.WriteLine("   varying by identity is 'private' at minimum, and 'no-store' if it");
    Console.WriteLine("   is sensitive.");
    Console.WriteLine();
    Console.WriteLine("   Related, and the reason the above still bites with 'private': if a");
    Console.WriteLine("   response varies by a REQUEST HEADER - Accept, Accept-Language,");
    Console.WriteLine("   Authorization - say so with Vary, or a cache keyed only on the URL");
    Console.WriteLine("   will serve the XML representation to a client that asked for JSON.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task HeaderRules(string baseUrl)
{
    Console.WriteLine("4. Rules about headers themselves");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    using var request = new HttpRequestMessage(HttpMethod.Get, "/headers");
    request.Headers.TryAddWithoutValidation("X-Tenant", "acme");
    request.Headers.TryAddWithoutValidation("x-TENANT-Case", "MixedValue");
    request.Headers.TryAddWithoutValidation("X-Repeated", "first");
    request.Headers.TryAddWithoutValidation("X-Repeated", "second");

    string echoed = await (await http.SendAsync(request)).Content.ReadAsStringAsync();

    Console.WriteLine("   what the server saw:");
    foreach (string line in echoed.Split('\n').Where(l => l.StartsWith("X-", StringComparison.OrdinalIgnoreCase)))
    {
        Console.WriteLine($"     {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   NAMES are case-insensitive. 'x-TENANT-Case' and 'X-Tenant-Case' are");
    Console.WriteLine("   the same header, so never compare a header name with ==.");
    Console.WriteLine();
    Console.WriteLine("   VALUES are case-SENSITIVE and are preserved exactly.");
    Console.WriteLine();
    Console.WriteLine("   REPEATED headers are legal and combine, comma-separated. That is");
    Console.WriteLine("   why HeaderDictionary values are StringValues rather than string:");
    Console.WriteLine("   calling .ToString() on a repeated header gives you 'first,second'");
    Console.WriteLine("   and reading [0] gives you only the first.");
    Console.WriteLine();
    Console.WriteLine("   The security consequence is worth stating plainly. If your code");
    Console.WriteLine("   reads a header like X-Forwarded-For or an API key with [0] while a");
    Console.WriteLine("   proxy in front of you reads the last one, a client that sends the");
    Console.WriteLine("   header twice makes the two of you disagree about its value.");
    Console.WriteLine();
    Console.WriteLine("   Note also that the X- prefix for custom headers was deprecated in");
    Console.WriteLine("   RFC 6648. It is still everywhere and it is harmless; do not");
    Console.WriteLine("   assume a header without it is a standard one.");
}
