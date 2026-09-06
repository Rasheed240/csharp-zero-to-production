// 03-status-codes.cs — The codes that carry meaning a client acts on, and the
// four that get chosen wrongly.
//
// Run:  dotnet run 03-status-codes.cs -c Release
//
// EXACT vs RATIO: every status code and header here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true

using System.Net;
using System.Net.Http.Json;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// --- the well-behaved endpoints ---------------------------------------------
app.MapGet("/ok", () => Results.Ok(new { id = "PAY-0001" }));

app.MapPost("/created", () =>
    Results.Created("/payments/PAY-0001", new { id = "PAY-0001" }));

app.MapDelete("/no-content", () => Results.NoContent());

app.MapGet("/moved", () => Results.Redirect("/ok", permanent: true));

app.MapGet("/bad-request", () =>
    Results.BadRequest(new { error = "amountMinor must be positive" }));

app.MapGet("/unauthorized", () => Results.Unauthorized());

// Results.StatusCode(403) rather than Results.Forbid(). Forbid() delegates to
// the registered authentication scheme's forbid handler, and with no scheme
// configured it throws - producing a 500. That is measured in section 5.
app.MapGet("/forbidden", () => Results.StatusCode(403));

app.MapGet("/forbid-helper", () => Results.Forbid());

app.MapGet("/not-found", () => Results.NotFound());

app.MapGet("/conflict", () =>
    Results.Conflict(new { error = "payment already settled" }));

app.MapGet("/unprocessable", () =>
    Results.UnprocessableEntity(new { error = "currency GBP not enabled for this tenant" }));

app.MapGet("/rate-limited", (HttpResponse response) =>
{
    response.Headers.RetryAfter = "30";
    return Results.StatusCode(429);
});

app.MapGet("/unavailable", (HttpResponse response) =>
{
    response.Headers.RetryAfter = "5";
    return Results.StatusCode(503);
});

// An explicit return type is required: the compiler cannot infer a
// delegate from a lambda whose body is only a throw expression.
app.MapGet("/boom", IResult () => throw new InvalidOperationException("gateway unreachable"));

// --- the anti-pattern -------------------------------------------------------
app.MapGet("/lying", () => Results.Ok(new { success = false, error = "payment declined" }));

await app.StartAsync();

await TheCodesThatMatter(app.Urls.First());
await TheFourThatGetChosenWrongly();
await TheLie(app.Urls.First());
await TheForbidTrap(app.Urls.First());
Classes();

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task TheCodesThatMatter(string baseUrl)
{
    Console.WriteLine("1. What each code tells a client to DO");
    Console.WriteLine();

    var handler = new HttpClientHandler { AllowAutoRedirect = false };
    using var http = new HttpClient(handler) { BaseAddress = new Uri(baseUrl) };

    Console.WriteLine("   endpoint          status   notable header        client should");
    Console.WriteLine("   --------          ------   --------------        -------------");

    await Show(http, "/ok", "GET", "use the body");
    await Show(http, "/created", "POST", "follow Location for the new thing");
    await Show(http, "/no-content", "DELETE", "expect no body at all");
    await Show(http, "/moved", "GET", "update its stored URL");
    await Show(http, "/bad-request", "GET", "fix the request, do not retry");
    await Show(http, "/unauthorized", "GET", "authenticate, then retry");
    await Show(http, "/forbidden", "GET", "give up; auth will not help");
    await Show(http, "/not-found", "GET", "give up, or create it");
    await Show(http, "/conflict", "GET", "re-read state and decide");
    await Show(http, "/unprocessable", "GET", "fix the DATA, not the syntax");
    await Show(http, "/rate-limited", "GET", "wait Retry-After, then retry");
    await Show(http, "/unavailable", "GET", "wait Retry-After, then retry");
    await Show(http, "/boom", "GET", "retry with backoff; it may be transient");

    Console.WriteLine();
    Console.WriteLine("   Read the last column rather than the numbers. A status code is an");
    Console.WriteLine("   INSTRUCTION to the client, and the only question that matters when");
    Console.WriteLine("   choosing one is what you want the caller to do next.");
    Console.WriteLine();

    static async Task Show(HttpClient http, string path, string method, string advice)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        HttpResponseMessage response = await http.SendAsync(request);

        string notable =
            response.Headers.Location is { } location ? $"Location: {location}" :
            response.Headers.TryGetValues("Retry-After", out var retry) ? $"Retry-After: {retry.First()}" :
            response.Headers.WwwAuthenticate.Count > 0 ? "WWW-Authenticate" :
            "";

        Console.WriteLine($"   {path,-16}  {(int)response.StatusCode,6}   {notable,-20}  {advice}");
    }
}

// ---------------------------------------------------------------------------
static Task TheFourThatGetChosenWrongly()
{
    Console.WriteLine("2. The four decisions people get wrong");
    Console.WriteLine();
    Console.WriteLine("   400 or 422?");
    Console.WriteLine("     400 - the request is MALFORMED. Broken JSON, a string where a");
    Console.WriteLine("           number belongs, a missing required field.");
    Console.WriteLine("     422 - the request PARSED and the values are unacceptable. A");
    Console.WriteLine("           negative amount, a currency this tenant cannot use.");
    Console.WriteLine("     Both mean 'do not retry unchanged'. The distinction is worth");
    Console.WriteLine("     making because 422 says the client's CODE is fine and its DATA");
    Console.WriteLine("     is not, which is a different fix.");
    Console.WriteLine();
    Console.WriteLine("   401 or 403?");
    Console.WriteLine("     401 - I do not know who you are. Authenticating may help, and a");
    Console.WriteLine("           401 must carry WWW-Authenticate saying how.");
    Console.WriteLine("     403 - I know who you are and you may not do this. Authenticating");
    Console.WriteLine("           again will NOT help; do not prompt for credentials.");
    Console.WriteLine("     The names are backwards, which is why this is confusing:");
    Console.WriteLine("     401 is called Unauthorized and means unauthenticated.");
    Console.WriteLine();
    Console.WriteLine("   404 or 403 for something you may not see?");
    Console.WriteLine("     403 admits the resource exists. For a multi-tenant system that");
    Console.WriteLine("     leaks information: probing IDs tells an attacker which ones are");
    Console.WriteLine("     real. Returning 404 for 'not yours' is a deliberate choice, and");
    Console.WriteLine("     it makes debugging harder for legitimate users. Decide per");
    Console.WriteLine("     resource; do not drift.");
    Console.WriteLine();
    Console.WriteLine("   409 or 422?");
    Console.WriteLine("     409 - the request is fine but conflicts with CURRENT STATE.");
    Console.WriteLine("           Cancelling an already-settled payment. Retrying unchanged");
    Console.WriteLine("           might succeed later, after the state changes.");
    Console.WriteLine("     422 - the values are wrong regardless of state.");
    Console.WriteLine();
    return Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static async Task TheLie(string baseUrl)
{
    Console.WriteLine("3. The anti-pattern: 200 with a failure inside");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
    HttpResponseMessage response = await http.GetAsync("/lying");

    Console.WriteLine($"   status                       : {(int)response.StatusCode}");
    Console.WriteLine($"   IsSuccessStatusCode          : {response.IsSuccessStatusCode}");
    Console.WriteLine($"   body                         : {await response.Content.ReadAsStringAsync()}");
    Console.WriteLine();
    Console.WriteLine("   Every layer between you and the caller believes this succeeded:");
    Console.WriteLine();
    Console.WriteLine("     - EnsureSuccessStatusCode() does not throw");
    Console.WriteLine("     - a retry policy sees success and does not retry");
    Console.WriteLine("     - a circuit breaker never opens, however often it fails");
    Console.WriteLine("     - your own error-rate dashboard reads 0%");
    Console.WriteLine("     - a proxy or CDN may CACHE the failure");
    Console.WriteLine();
    Console.WriteLine("   The failure is only visible to code that parses the body and knows");
    Console.WriteLine("   to look for a 'success' field. That is every caller, forever, and");
    Console.WriteLine("   one that forgets treats a declined payment as a settled one.");
    Console.WriteLine();
    Console.WriteLine("   Use the status line. It is the one part of the response that every");
    Console.WriteLine("   layer already understands.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TheForbidTrap(string baseUrl)
{
    Console.WriteLine("5. Results.Forbid() is not a way to return 403");
    Console.WriteLine();

    using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };

    HttpResponseMessage explicitCode = await http.GetAsync("/forbidden");
    HttpResponseMessage helper = await http.GetAsync("/forbid-helper");

    Console.WriteLine($"   Results.StatusCode(403) -> {(int)explicitCode.StatusCode}");
    Console.WriteLine($"   Results.Forbid()        -> {(int)helper.StatusCode}");
    Console.WriteLine();
    Console.WriteLine("   Forbid() and Challenge() do not merely set a status code. They");
    Console.WriteLine("   ask the registered AUTHENTICATION SCHEME to handle the rejection,");
    Console.WriteLine("   so a cookie scheme redirects to a login page and a JWT scheme sets");
    Console.WriteLine("   a header.");
    Console.WriteLine();
    Console.WriteLine("   With no scheme registered - which is this program - there is no");
    Console.WriteLine("   handler to call and it throws. The caller gets a 500 for what was");
    Console.WriteLine("   meant to be a clean 403.");
    Console.WriteLine();
    Console.WriteLine("   This is worth knowing because it fails in exactly the environment");
    Console.WriteLine("   where it is least expected: a test host or a minimal service that");
    Console.WriteLine("   has authorisation logic but has not wired up authentication.");
    Console.WriteLine();
    Console.WriteLine("   Use Forbid() when a scheme is configured and you want its");
    Console.WriteLine("   behaviour. Use Results.StatusCode(403) when you want a 403.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Classes()
{
    Console.WriteLine("4. The five classes, and what they mean for blame");
    Console.WriteLine();
    Console.WriteLine("   1xx  informational   rare; 100 Continue and 101 Switching Protocols");
    Console.WriteLine("   2xx  success         it worked");
    Console.WriteLine("   3xx  redirection     look elsewhere");
    Console.WriteLine("   4xx  CLIENT error    the caller must change something");
    Console.WriteLine("   5xx  SERVER error    the caller did nothing wrong");
    Console.WriteLine();
    Console.WriteLine("   The 4xx/5xx split is an assignment of BLAME, and it drives real");
    Console.WriteLine("   behaviour: alerting, error budgets, retry policy, and circuit");
    Console.WriteLine("   breakers all key off it.");
    Console.WriteLine();
    Console.WriteLine("   So returning 500 for a validation failure pages somebody at 3am for");
    Console.WriteLine("   a caller sending bad data. And returning 400 for a genuine server");
    Console.WriteLine("   fault hides an outage - your error rate stays flat while every");
    Console.WriteLine("   request fails.");
    Console.WriteLine();
    Console.WriteLine("   The two that are frequently mixed up in this pair:");
    Console.WriteLine();
    Console.WriteLine("     429 is 4xx  - the CLIENT sent too many requests");
    Console.WriteLine("     503 is 5xx  - the SERVER cannot cope right now");
    Console.WriteLine();
    Console.WriteLine("   Both should carry Retry-After. The difference is whose fault it is,");
    Console.WriteLine("   and therefore whether it counts against your availability.");
}
