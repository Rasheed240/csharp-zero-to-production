// 01-three-schemes.cs — URL, header and media type, measured on the wire, plus
// the decision every scheme has to make and usually does not.
//
// Run:  dotnet run 01-three-schemes.cs -c Release
//
// EXACT vs RATIO: every status code and header here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.AspNetCore.Http.Extensions;
using System.Net.Http.Headers;

await ThreeSchemes();
await NoVersionGiven();
await WhatEachCosts();
Recommendation();

// ---------------------------------------------------------------------------
static async Task ThreeSchemes()
{
    Console.WriteLine("1. The same call, three ways of saying which version");
    Console.WriteLine();

    using WebApplication app = await StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   scheme        the request                                       response");
    Console.WriteLine("   ------        -----------                                       --------");

    // URL path.
    await Show(http, "URL path", new HttpRequestMessage(HttpMethod.Get, "/v2/payments/PAY-1"));

    // Query string.
    await Show(http, "query string",
        new HttpRequestMessage(HttpMethod.Get, "/payments/PAY-1?api-version=2"));

    // Custom header.
    var headerRequest = new HttpRequestMessage(HttpMethod.Get, "/payments/PAY-1");
    headerRequest.Headers.Add("X-Api-Version", "2");
    await Show(http, "custom header", headerRequest);

    // Media type parameter, the one the REST purists argue for.
    var mediaRequest = new HttpRequestMessage(HttpMethod.Get, "/payments/PAY-1");
    mediaRequest.Headers.Accept.Add(
        MediaTypeWithQualityHeaderValue.Parse("application/vnd.ledger.payment+json; version=2"));
    await Show(http, "media type", mediaRequest);

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   ALL FOUR REACHED THE SAME HANDLER. The version is a value the server");
    Console.WriteLine("   has to find somewhere in the request, and every scheme is a different");
    Console.WriteLine("   place to put it.");
    Console.WriteLine();
    Console.WriteLine("   That is worth saying plainly because the argument about which is");
    Console.WriteLine("   'correct' is long, mostly about REST as a philosophy, and does not");
    Console.WriteLine("   affect what any of them can do.");
    Console.WriteLine();

    static async Task Show(HttpClient http, string label, HttpRequestMessage request)
    {
        using (request)
        {
            using HttpResponseMessage response = await http.SendAsync(request);
            string body = await response.Content.ReadAsStringAsync();

            string described = Describe(request);

            Console.WriteLine($"   {label,-12}  {described,-48}  {body}");
        }
    }

    static string Describe(HttpRequestMessage request)
    {
        string path = request.RequestUri!.IsAbsoluteUri
            ? request.RequestUri.PathAndQuery
            : request.RequestUri.OriginalString;

        if (request.Headers.TryGetValues("X-Api-Version", out IEnumerable<string>? values))
        {
            return $"{path}  + X-Api-Version: {string.Join(",", values)}";
        }

        if (request.Headers.Accept.Count > 0)
        {
            return $"{path}  + Accept: ...version=2";
        }

        return path;
    }
}

// ---------------------------------------------------------------------------
static async Task NoVersionGiven()
{
    Console.WriteLine("2. What happens when the caller says nothing");
    Console.WriteLine();
    Console.WriteLine("   This is the decision every scheme forces and most teams make by");
    Console.WriteLine("   accident, because it is whatever the code happens to do.");
    Console.WriteLine();

    Console.WriteLine("   policy                        response to GET /payments/PAY-1");
    Console.WriteLine("   ------                        -------------------------------");

    foreach (Missing policy in new[] { Missing.Latest, Missing.Oldest, Missing.Reject })
    {
        using WebApplication app = await StartAsync(policy);
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        using HttpResponseMessage response = await http.GetAsync("/payments/PAY-1");
        string body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"   {Describe(policy),-28}  {(int)response.StatusCode}  " +
            $"{(body.Length > 76 ? body[..76] + "..." : body)}");

        await app.StopAsync();
    }

    Console.WriteLine();
    Console.WriteLine("   DEFAULT TO THE LATEST is the most common and the worst. It means every");
    Console.WriteLine("   caller who forgot to specify a version is silently opted in to every");
    Console.WriteLine("   future breaking change - so the day you ship v3, some client you have");
    Console.WriteLine("   never heard of breaks, and the change that broke it was correct.");
    Console.WriteLine();
    Console.WriteLine("   DEFAULT TO THE OLDEST is defensible and has one real cost: v1 never");
    Console.WriteLine("   dies, because unversioned callers keep arriving and you cannot tell");
    Console.WriteLine("   them apart from deliberate ones.");
    Console.WriteLine();
    Console.WriteLine("   REJECT is the honest option, and it is the only one that makes the");
    Console.WriteLine("   version part of the contract rather than a suggestion. Its cost is");
    Console.WriteLine("   paid once, at integration, by a developer reading a 400 that says");
    Console.WriteLine("   exactly what to add.");
    Console.WriteLine();
    Console.WriteLine("   THE ANSWER DEPENDS ON WHO CALLS YOU, and it is worth deciding rather");
    Console.WriteLine("   than inheriting:");
    Console.WriteLine();
    Console.WriteLine("     - a public API with unknown clients: REJECT, because you can never");
    Console.WriteLine("       find out what an unversioned caller expected;");
    Console.WriteLine();
    Console.WriteLine("     - an internal API where you own every caller: latest is fine,");
    Console.WriteLine("       because you can grep for the callers before you break them;");
    Console.WriteLine();
    Console.WriteLine("     - anything in between: oldest, and treat unversioned traffic as a");
    Console.WriteLine("       number you are trying to get to zero.");
    Console.WriteLine();

    static string Describe(Missing policy) => policy switch
    {
        Missing.Latest => "default to the latest",
        Missing.Oldest => "default to the oldest",
        _ => "reject the request"
    };
}

// ---------------------------------------------------------------------------
static async Task WhatEachCosts()
{
    Console.WriteLine("3. What each scheme is actually good and bad at");
    Console.WriteLine();

    using WebApplication app = await StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    // The property that decides most arguments: can you paste it into a
    // browser, a curl command, a support ticket?
    Console.WriteLine("   can the whole request be expressed as a URL?");
    Console.WriteLine();
    Console.WriteLine("     URL path       https://api.ledger.example/v2/payments/PAY-1     YES");
    Console.WriteLine("     query string   https://api.ledger.example/payments/PAY-1?api-version=2   YES");
    Console.WriteLine("     custom header  needs -H 'X-Api-Version: 2'                      no");
    Console.WriteLine("     media type     needs -H 'Accept: ...;version=2'                 no");
    Console.WriteLine();

    // The other property that decides arguments: does an intermediary see it?
    Console.WriteLine("   what a cache or proxy sees as the cache key:");
    Console.WriteLine();

    using HttpResponseMessage pathResponse = await http.GetAsync("/v2/payments/PAY-1");

    var headerRequest = new HttpRequestMessage(HttpMethod.Get, "/payments/PAY-1");
    headerRequest.Headers.Add("X-Api-Version", "2");
    using HttpResponseMessage headerResponse = await http.SendAsync(headerRequest);

    Console.WriteLine($"     URL path       the URL differs per version, so caching works");
    Console.WriteLine($"     custom header  the URL is identical for v1 and v2");
    Console.WriteLine($"                    Vary header sent: " +
        $"{(headerResponse.Headers.Vary.Count > 0 ? string.Join(",", headerResponse.Headers.Vary) : "(none)")}");
    Console.WriteLine();
    Console.WriteLine("   WITHOUT A Vary HEADER, A SHARED CACHE WILL SERVE A v1 RESPONSE TO A v2");
    Console.WriteLine("   REQUEST, because from its point of view they are the same request. Any");
    Console.WriteLine("   header-based or media-type scheme has to send Vary and most");
    Console.WriteLine("   hand-rolled ones do not.");
    Console.WriteLine();
    Console.WriteLine("   That is not an argument against headers - it is one line - but it is a");
    Console.WriteLine("   real thing the URL scheme gets for nothing.");
    Console.WriteLine();

    await app.StopAsync();

    Console.WriteLine("   The full comparison:");
    Console.WriteLine();
    Console.WriteLine("   property                          URL path   query   header   media type");
    Console.WriteLine("   --------                          --------   -----   ------   ----------");
    Console.WriteLine("   pasteable into a browser              yes      yes       no           no");
    Console.WriteLine("   visible in an access log              yes      yes       no           no");
    Console.WriteLine("   cached correctly by default           yes      yes       no           no");
    Console.WriteLine("   version per resource                   no       no       no          yes");
    Console.WriteLine("   keeps one URL per resource             no      yes      yes          yes");
    Console.WriteLine("   obvious to a first-time caller        yes     yes*       no           no");
    Console.WriteLine();
    Console.WriteLine("   * obvious once they have read a document that mentions it.");
    Console.WriteLine();
    Console.WriteLine("   THE ONE ROW THAT IS A REAL ARGUMENT is 'version per resource'. A media");
    Console.WriteLine("   type lets /payments be at version 3 while /refunds is at version 1,");
    Console.WriteLine("   because the version belongs to the representation rather than to the");
    Console.WriteLine("   service.");
    Console.WriteLine();
    Console.WriteLine("   That is genuinely more expressive, and it is also more to explain, more");
    Console.WriteLine("   to test, and a support conversation that starts with 'what Accept");
    Console.WriteLine("   header did you send'. It earns its place in an API with many resources");
    Console.WriteLine("   evolving at different rates, and nowhere else.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Recommendation()
{
    Console.WriteLine("4. What to use");
    Console.WriteLine();
    Console.WriteLine("   USE THE URL PATH, unless you have a specific reason not to.");
    Console.WriteLine();
    Console.WriteLine("   The reasons, in the order they matter:");
    Console.WriteLine();
    Console.WriteLine("     1. IT IS VISIBLE EVERYWHERE. In an access log, in a support ticket,");
    Console.WriteLine("        in a browser address bar, in a metrics dashboard grouped by");
    Console.WriteLine("        route. 'How much traffic is still on v1' is a question you will");
    Console.WriteLine("        ask repeatedly, and with a path it is already answered.");
    Console.WriteLine();
    Console.WriteLine("     2. IT CACHES CORRECTLY WITHOUT ANYBODY THINKING ABOUT IT.");
    Console.WriteLine();
    Console.WriteLine("     3. A DEVELOPER CAN TRY IT WITHOUT READING ANYTHING. That is worth");
    Console.WriteLine("        more than it sounds: the cost of an API is dominated by how many");
    Console.WriteLine("        people integrate with it and how long each takes.");
    Console.WriteLine();
    Console.WriteLine("   THE ARGUMENT AGAINST IT is that a URL should identify a resource, and");
    Console.WriteLine("   /v1/payments/PAY-1 and /v2/payments/PAY-1 are the same payment. That is");
    Console.WriteLine("   correct, and it is a statement about REST rather than about anything");
    Console.WriteLine("   that will happen to you.");
    Console.WriteLine();
    Console.WriteLine("   WHEN TO CHOOSE OTHERWISE:");
    Console.WriteLine();
    Console.WriteLine("     - MEDIA TYPE, when different resources genuinely evolve at different");
    Console.WriteLine("       rates and you would otherwise be forced to version the whole API");
    Console.WriteLine("       for one endpoint;");
    Console.WriteLine();
    Console.WriteLine("     - HEADER, when a gateway or client framework already imposes one, or");
    Console.WriteLine("       when the URL is fixed by something outside your control;");
    Console.WriteLine();
    Console.WriteLine("     - QUERY STRING, essentially never - it has the URL scheme's");
    Console.WriteLine("       drawbacks and looks like a filter rather than a contract.");
    Console.WriteLine();
    Console.WriteLine("   AND WHATEVER YOU CHOOSE: PICK ONE. An API that accepts three schemes");
    Console.WriteLine("   has three code paths, three sets of tests, and a question about what");
    Console.WriteLine("   happens when two of them disagree - which is a question with no good");
    Console.WriteLine("   answer and which somebody will eventually ask by accident.");
}

// ---------------------------------------------------------------------------
static async Task<WebApplication> StartAsync(Missing missing = Missing.Reject)
{
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var app = builder.Build();

    // URL path: two groups, and nothing to work out.
    app.MapGroup("/v1").MapGet("/payments/{id}", (string id) => Results.Ok(V1(id)));
    app.MapGroup("/v2").MapGet("/payments/{id}", (string id) => Results.Ok(V2(id)));

    // Everything else: one route, and the version read from wherever it is.
    app.MapGet("/payments/{id}", (string id, HttpContext context) =>
    {
        int? version = ReadVersion(context.Request);

        if (version is null)
        {
            return missing switch
            {
                Missing.Latest => Results.Ok(V2(id)),
                Missing.Oldest => Results.Ok(V1(id)),
                _ => Results.Problem(
                    title: "An api version is required",
                    detail: "Send ?api-version=, X-Api-Version, or an Accept parameter.",
                    statusCode: 400)
            };
        }

        // A header-based scheme must tell caches that the response depends on
        // something other than the URL. One line, and usually missing.
        context.Response.Headers.Vary = "X-Api-Version, Accept";

        return version switch
        {
            1 => Results.Ok(V1(id)),
            2 => Results.Ok(V2(id)),
            _ => Results.Problem(title: $"Unsupported api version '{version}'", statusCode: 400)
        };
    });

    await app.StartAsync();

    return app;

    static object V1(string id) => new { id, amount = 500.00m, currency = "GBP" };

    static object V2(string id) =>
        new { id, amountMinor = 50_000L, currency = "GBP", status = "captured" };
}

// Reads the version from any of the three places, in a fixed order.
static int? ReadVersion(HttpRequest request)
{
    if (request.Query.TryGetValue("api-version", out var query)
        && int.TryParse(query, out int fromQuery))
    {
        return fromQuery;
    }

    if (request.Headers.TryGetValue("X-Api-Version", out var header)
        && int.TryParse(header, out int fromHeader))
    {
        return fromHeader;
    }

    foreach (string? accept in request.Headers.Accept)
    {
        if (accept is null)
        {
            continue;
        }

        foreach (string part in accept.Split(';'))
        {
            string trimmed = part.Trim();

            if (trimmed.StartsWith("version=", StringComparison.OrdinalIgnoreCase)
                && int.TryParse(trimmed["version=".Length..], out int fromMedia))
            {
                return fromMedia;
            }
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
enum Missing { Latest, Oldest, Reject }
