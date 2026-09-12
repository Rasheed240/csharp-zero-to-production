// 00-smallest.cs — The smallest outbound webhook: one event, one signed
// delivery, one consumer that verifies it. And the four things that are
// already different from calling an API.
//
// Run:  dotnet run 00-smallest.cs -c Release
//
// EXACT vs RATIO: every signature, status and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// The consumer. Somebody else's server, which we do not control.
var consumerBuilder = WebApplication.CreateBuilder();
consumerBuilder.WebHost.UseUrls("http://127.0.0.1:0");
consumerBuilder.Logging.ClearProviders();

var consumer = consumerBuilder.Build();

consumer.MapPost("/hooks/ledger", async (HttpRequest request) =>
{
    // The consumer reads the RAW BYTES, not a parsed object. This matters
    // more than it looks and section 2 of 01-signing.cs measures why.
    using var reader = new StreamReader(request.Body);

    string body = await reader.ReadToEndAsync();

    string? timestamp = request.Headers["x-ledger-timestamp"];
    string? signature = request.Headers["x-ledger-signature"];

    string expected = Sign(Secret, timestamp ?? "", body);

    // A constant-time comparison, for reasons 01-signing.cs comes back to.
    bool valid = CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(signature ?? ""),
        Encoding.UTF8.GetBytes(expected));

    Console.WriteLine($"     consumer received  {body}");
    Console.WriteLine($"     signature header   {signature}");
    Console.WriteLine($"     consumer computed  {expected}");
    Console.WriteLine($"     verdict            {(valid ? "accepted" : "REJECTED")}");

    return valid ? Results.Ok() : Results.Unauthorized();
});

await consumer.StartAsync();

string endpoint = $"{consumer.Urls.First()}/hooks/ledger";

Console.WriteLine("The smallest outbound webhook");
Console.WriteLine();

using var http = new HttpClient();

// -------------------------------------------------------------------------
Console.WriteLine("1. AN EVENT, SIGNED AND DELIVERED");
Console.WriteLine();

var payload = new
{
    id = "evt_01HQ8",
    type = "payment.captured",
    createdAt = "2026-09-08T10:14:02Z",
    data = new { paymentId = "PAY-001", amountMinor = 4999, currency = "GBP" }
};

// The body is serialised ONCE, and the bytes that are signed are the bytes
// that are sent. Nothing re-serialises them in between.
string json = JsonSerializer.Serialize(payload);
string sentAt = "1789123456";

var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
{
    Content = new StringContent(json, Encoding.UTF8, "application/json")
};

request.Headers.Add("x-ledger-timestamp", sentAt);
request.Headers.Add("x-ledger-signature", Sign(Secret, sentAt, json));

HttpResponseMessage response = await http.SendAsync(request);

Console.WriteLine($"     delivery status    {(int)response.StatusCode} {response.StatusCode}");

// -------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. AND THE SAME DELIVERY WITH ONE CHARACTER CHANGED");
Console.WriteLine();

string tampered = json.Replace("4999", "1");

var forged = new HttpRequestMessage(HttpMethod.Post, endpoint)
{
    Content = new StringContent(tampered, Encoding.UTF8, "application/json")
};

// The attacker keeps the signature they saw; they cannot produce a new one
// without the secret.
forged.Headers.Add("x-ledger-timestamp", sentAt);
forged.Headers.Add("x-ledger-signature", Sign(Secret, sentAt, json));

HttpResponseMessage forgedResponse = await http.SendAsync(forged);

Console.WriteLine($"     delivery status    {(int)forgedResponse.StatusCode} {forgedResponse.StatusCode}");

await consumer.StopAsync();

Console.WriteLine();
Console.WriteLine("   FOUR THINGS ARE ALREADY DIFFERENT FROM CALLING AN API:");
Console.WriteLine();
Console.WriteLine("     THE DIRECTION IS REVERSED, AND SO IS THE TRUST. We are the client and");
Console.WriteLine("     somebody else is the server - a server we do not run, cannot test");
Console.WriteLine("     against and cannot fix. Every assumption about availability, latency");
Console.WriteLine("     and correctness that holds for our own services is gone.");
Console.WriteLine();
Console.WriteLine("     THE CONSUMER CANNOT AUTHENTICATE US ANY OTHER WAY. There is no login,");
Console.WriteLine("     no session, no mutual TLS by default - the request arrives at a public");
Console.WriteLine("     URL that anybody can find. THE SIGNATURE IS THE ONLY THING SEPARATING");
Console.WriteLine("     our event from one an attacker sent, and the second delivery above is");
Console.WriteLine("     what that protection looks like when it works.");
Console.WriteLine();
Console.WriteLine("     THE URL BELONGS TO SOMEBODY ELSE. They chose it, they can change it,");
Console.WriteLine("     and they can point it anywhere - including at an address inside our");
Console.WriteLine("     own network. That is a whole exercise in 04-exercises.cs.");
Console.WriteLine();
Console.WriteLine("     AND NOBODY IS WAITING. A failed API call has a user in front of it who");
Console.WriteLine("     will see an error. A failed webhook has nobody: the event happened, we");
Console.WriteLine("     owe them a notification, and the only thing that will ever deliver it");
Console.WriteLine("     is our own retry policy. THAT IS WHY THE REST OF THIS MODULE IS ABOUT");
Console.WriteLine("     DELIVERY RATHER THAN ABOUT REQUESTS.");

// -------------------------------------------------------------------------
// HMAC-SHA256 over the timestamp and the exact body bytes.
static string Sign(string secret, string timestamp, string body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}"));

    return "v1=" + Convert.ToHexStringLower(hash);
}

public partial class Program
{
    public const string Secret = "whsec_2f8a1c0e5b9d4a6f";
}
