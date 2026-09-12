// 00-smallest.cs — The smallest correct webhook receiver, and the four
// questions it has to answer before it does any work.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every status code and verdict here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

const string Secret = "whsec_2f8a1c0e5b9d4a6f";

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

var app = builder.Build();

// The whole receiver.
app.MapPost("/hooks/ledger", async (HttpRequest request) =>
{
    // 1. THE RAW BYTES. Not a bound model, not a re-serialised object.
    byte[] body;

    using (var buffer = new MemoryStream())
    {
        await request.Body.CopyToAsync(buffer);

        body = buffer.ToArray();
    }

    // 2. IS THE TIMESTAMP FRESH? Checked before the signature, because a
    //    valid signature on an old request is exactly what a replay is.
    if (!long.TryParse(request.Headers["x-ledger-timestamp"], out long timestamp)
        || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp) > 300)
    {
        return Results.BadRequest("stale or missing timestamp");
    }

    // 3. IS THE SIGNATURE OURS? Compared in constant time.
    string presented = request.Headers["x-ledger-signature"].ToString();

    if (!CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(presented),
            Encoding.UTF8.GetBytes(Sign(Secret, timestamp, body))))
    {
        return Results.BadRequest("bad signature");
    }

    // 4. HAVE WE SEEN IT BEFORE? Only now is it safe to parse and act.
    var received = JsonSerializer.Deserialize<JsonElement>(body);

    return Results.Ok(new { accepted = received.GetProperty("id").GetString() });
});

await app.StartAsync();

string endpoint = $"{app.Urls.First()}/hooks/ledger";

Console.WriteLine("The smallest correct receiver");
Console.WriteLine();

using var http = new HttpClient();

string payload = JsonSerializer.Serialize(new
{
    id = "evt_01HQ8",
    type = "payment.captured",
    version = 1,
    data = new { paymentId = "PAY-001", status = "captured", amountMinor = 4999 }
});

long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

Console.WriteLine("   what arrived                              receiver said");
Console.WriteLine("   ------------                              -------------");

// A genuine delivery.
Console.WriteLine($"   a properly signed event                   " +
    $"{await Post(http, endpoint, payload, now, Sign(Secret, now, Encoding.UTF8.GetBytes(payload)))}");

// The body edited, the captured signature kept.
string tampered = payload.Replace("4999", "1");

Console.WriteLine($"   the same signature, body edited           " +
    $"{await Post(http, endpoint, tampered, now, Sign(Secret, now, Encoding.UTF8.GetBytes(payload)))}");

// Signed with a secret we do not share.
Console.WriteLine($"   signed with somebody else's secret        " +
    $"{await Post(http, endpoint, payload, now, Sign("whsec_attacker", now, Encoding.UTF8.GetBytes(payload)))}");

// Correctly signed, twenty minutes old.
long old = now - 1200;

Console.WriteLine($"   correctly signed, 20 minutes old          " +
    $"{await Post(http, endpoint, payload, old, Sign(Secret, old, Encoding.UTF8.GetBytes(payload)))}");

// No signature at all.
Console.WriteLine($"   no signature header                       " +
    $"{await Post(http, endpoint, payload, now, "")}");

await app.StopAsync();

Console.WriteLine();
Console.WriteLine("   FOUR THINGS THIS RECEIVER GETS RIGHT, AND EACH IS A SECTION LATER:");
Console.WriteLine();
Console.WriteLine("     IT READS THE RAW BYTES. Not a bound model, not a string it re-encoded.");
Console.WriteLine("     The signature is over bytes, and the moment the body passes through a");
Console.WriteLine("     parser it is a different message. THIS IS THE SINGLE COMMONEST WAY A");
Console.WriteLine("     RECEIVER IS WRITTEN WRONG, and 01-reading-the-body.cs shows the two");
Console.WriteLine("     traps ASP.NET Core adds on top of it.");
Console.WriteLine();
Console.WriteLine("     IT CHECKS THE TIMESTAMP BEFORE THE SIGNATURE. A replayed request has a");
Console.WriteLine("     PERFECTLY VALID signature - that is what makes it a replay rather than a");
Console.WriteLine("     forgery. Freshness is a separate question from authorship and neither");
Console.WriteLine("     one answers the other.");
Console.WriteLine();
Console.WriteLine("     IT COMPARES IN CONSTANT TIME. An ordinary comparison returns as soon as");
Console.WriteLine("     it finds a difference, and how long that took is information.");
Console.WriteLine();
Console.WriteLine("     AND IT DOES NOTHING UNTIL ALL THREE PASS. No parsing, no database, no");
Console.WriteLine("     logging of the payload. Everything before the last line treats the");
Console.WriteLine("     request as hostile, because until the signature verifies, it is.");
Console.WriteLine();
Console.WriteLine("   WHAT IT STILL GETS WRONG, AND THE REST OF THE MODULE FIXES:");
Console.WriteLine();
Console.WriteLine("     IT HAS NO MEMORY. A valid delivery replayed twice inside the five-minute");
Console.WriteLine("     window is accepted twice, because the window is a bound on how old a");
Console.WriteLine("     request may be, not a record of what has already been seen.");
Console.WriteLine();
Console.WriteLine("     AND IT DOES ITS WORK BEFORE ANSWERING. That is fine at this size and it");
Console.WriteLine("     is the cause of the incident in 03-production.cs.");

// ---------------------------------------------------------------------------
static async Task<string> Post(HttpClient http, string url, string body, long timestamp, string signature)
{
    var message = new HttpRequestMessage(HttpMethod.Post, url)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    message.Headers.Add("x-ledger-timestamp", timestamp.ToString());
    message.Headers.Add("x-ledger-signature", signature);

    HttpResponseMessage response = await http.SendAsync(message);

    string detail = response.IsSuccessStatusCode
        ? "accepted"
        : await response.Content.ReadAsStringAsync();

    return $"{(int)response.StatusCode}  {Trim(detail)}";
}

static string Trim(string value)
{
    string flat = value.Replace("\"", "").Trim();

    return flat.Length <= 40 ? flat : flat[..40];
}

static string Sign(string secret, long timestamp, byte[] body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    // The timestamp and the body bytes, with a separator that cannot appear
    // in the timestamp - so "1.23" and "12.3" cannot collide.
    byte[] material = [.. Encoding.UTF8.GetBytes($"{timestamp}."), .. body];

    return "v1=" + Convert.ToHexStringLower(hmac.ComputeHash(material));
}
