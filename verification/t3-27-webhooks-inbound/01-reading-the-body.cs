// 01-reading-the-body.cs — The signature is over the bytes that arrived, and
// ASP.NET Core makes those bytes surprisingly hard to hold on to. Three traps,
// all measured.
//
// Run:  dotnet run 01-reading-the-body.cs -c Release
//
// EXACT vs RATIO: every byte count and verdict here is deterministic.

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

// ---------------------------------------------------------------------------
// TRAP 1: the request body is a forward-only stream. Whoever reads it first
// gets the bytes, and everybody after them gets nothing.
app.MapPost("/read-twice", async (HttpRequest request) =>
{
    string first = await new StreamReader(request.Body).ReadToEndAsync();
    string second = await new StreamReader(request.Body).ReadToEndAsync();

    return Results.Ok(new { first = first.Length, second = second.Length });
});

// The same handler with buffering enabled and the stream rewound.
app.MapPost("/read-twice-buffered", async (HttpRequest request) =>
{
    request.EnableBuffering();

    string first = await new StreamReader(request.Body, leaveOpen: true).ReadToEndAsync();

    request.Body.Position = 0;

    string second = await new StreamReader(request.Body).ReadToEndAsync();

    return Results.Ok(new { first = first.Length, second = second.Length });
});

// ---------------------------------------------------------------------------
// TRAP 2: a bound parameter consumes the stream before the handler runs.
app.MapPost("/bound-model", async (WebhookEvent bound, HttpRequest request) =>
{
    // Model binding has already read the body. This is what is left.
    string leftover = await new StreamReader(request.Body).ReadToEndAsync();

    return Results.Ok(new { bound = bound.Id, leftoverBytes = leftover.Length });
});

// ---------------------------------------------------------------------------
// TRAP 3: decoding to a string and re-encoding is not always a round trip.
app.MapPost("/verify/{how}", async (string how, HttpRequest request) =>
{
    long timestamp = long.Parse(request.Headers["x-ledger-timestamp"]!);
    string presented = request.Headers["x-ledger-signature"].ToString();

    byte[] verified;

    if (how == "bytes")
    {
        using var buffer = new MemoryStream();

        await request.Body.CopyToAsync(buffer);

        verified = buffer.ToArray();
    }
    else
    {
        // The natural thing to write, and the thing that fails on some bodies.
        string text = await new StreamReader(request.Body).ReadToEndAsync();

        verified = Encoding.UTF8.GetBytes(text);
    }

    bool ok = CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(presented),
        Encoding.UTF8.GetBytes(Sign(Secret, timestamp, verified)));

    return Results.Ok(new { verifiedBytes = verified.Length, ok });
});

await app.StartAsync();

string baseAddress = app.Urls.First();

using var http = new HttpClient();

Console.WriteLine("Holding on to the bytes that arrived");
Console.WriteLine();

string payload = JsonSerializer.Serialize(new
{
    id = "evt_01HQ8",
    type = "payment.captured",
    data = new { paymentId = "PAY-001", amountMinor = 4999 }
});

// ---------------------------------------------------------------------------
Console.WriteLine("1. THE BODY CAN ONLY BE READ ONCE");
Console.WriteLine();

Console.WriteLine("   handler                       first read   second read");
Console.WriteLine("   -------                       ----------   -----------");

foreach ((string label, string route) in new[]
{
    ("reads it twice", "/read-twice"),
    ("EnableBuffering, then rewinds", "/read-twice-buffered")
})
{
    JsonElement result = await PostJson(http, $"{baseAddress}{route}", payload);

    Console.WriteLine($"   {label,-28}  {result.GetProperty("first").GetInt32(),10}   " +
        $"{result.GetProperty("second").GetInt32(),11}");
}

Console.WriteLine();
Console.WriteLine("   THE SECOND READ RETURNED NOTHING, AND DID NOT THROW. A request body is a");
Console.WriteLine("   forward-only network stream: the bytes are consumed as they are read, and");
Console.WriteLine("   there is nothing to rewind to. An empty string is not an error condition,");
Console.WriteLine("   so a verifier that reads second computes the signature of \"\" and rejects");
Console.WriteLine("   everything - or, far worse, ACCEPTS everything if the sender also happens");
Console.WriteLine("   to sign an empty body.");
Console.WriteLine();
Console.WriteLine("   EnableBuffering() SWITCHES IN A REWINDABLE STREAM, spilling to disk past a");
Console.WriteLine("   threshold. It has to be called BEFORE anything reads, and the position has");
Console.WriteLine("   to be reset afterwards or the next reader starts at the end.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. AND A BOUND PARAMETER READS IT FIRST");
Console.WriteLine();

JsonElement bound = await PostJson(http, $"{baseAddress}/bound-model", payload);

Console.WriteLine($"   the model bound successfully to           {bound.GetProperty("bound").GetString()}");
Console.WriteLine($"   bytes left in the body for the handler    {bound.GetProperty("leftoverBytes").GetInt32()}");
Console.WriteLine($"   bytes that actually arrived              {Encoding.UTF8.GetByteCount(payload)}");
Console.WriteLine();
Console.WriteLine("   THIS IS THE TRAP, AND IT IS INVISIBLE. The handler signature says");
Console.WriteLine("   'WebhookEvent bound' because binding is convenient, and that convenience");
Console.WriteLine("   consumed the stream before the first line of the handler ran. Nothing");
Console.WriteLine("   warns, nothing throws, and the verification code below it is now hashing");
Console.WriteLine("   an empty array.");
Console.WriteLine();
Console.WriteLine("   THE FIX IS NOT EnableBuffering. It is to STOP BINDING - take HttpRequest,");
Console.WriteLine("   read the bytes, verify, and parse those same bytes yourself. Binding first");
Console.WriteLine("   and re-serialising the model is the other well-known way to get this");
Console.WriteLine("   wrong, because the bytes it produces are not the bytes that were signed.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. DECODE-AND-RE-ENCODE IS NOT ALWAYS A ROUND TRIP");
Console.WriteLine();

Console.WriteLine("   body                                  bytes sent   verified as   signature");
Console.WriteLine("   ----                                  ----------   -----------   ---------");

foreach ((string label, byte[] bytes) in new[]
{
    ("plain ASCII JSON", Encoding.UTF8.GetBytes(payload)),
    ("JSON containing a pound sign", Encoding.UTF8.GetBytes(payload.Replace("PAY-001", "PAY-£1"))),
    ("the same JSON with a UTF-8 BOM", (byte[])[.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(payload)])
})
{
    long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    string signature = Sign(Secret, timestamp, bytes);

    foreach (string how in new[] { "bytes", "string" })
    {
        JsonElement result = await PostRaw(http, $"{baseAddress}/verify/{how}", bytes, timestamp, signature);

        string tag = how == "bytes" ? "read as bytes" : "decoded to a string";

        Console.WriteLine($"   {(how == "bytes" ? label : ""),-36}  {bytes.Length,10}   " +
            $"{result.GetProperty("verifiedBytes").GetInt32(),11}   " +
            $"{(result.GetProperty("ok").GetBoolean() ? "ok" : "FAILS"),-5}  {tag}");
    }
}

Console.WriteLine();
Console.WriteLine("   THE FIRST TWO BODIES SURVIVE THE ROUND TRIP. Valid UTF-8 decoded to a");
Console.WriteLine("   string and re-encoded as UTF-8 gives back the same bytes, pound sign and");
Console.WriteLine("   all - which is exactly why this code passes review and passes tests.");
Console.WriteLine();
Console.WriteLine("   THE BOM IS THE ONE THAT BREAKS IT. StreamReader treats a leading byte-order");
Console.WriteLine("   mark as an encoding declaration and STRIPS IT, so three bytes that were");
Console.WriteLine("   signed are not three bytes that were verified. Nothing is corrupt and");
Console.WriteLine("   nothing throws; the signature is simply over a different message.");
Console.WriteLine();
Console.WriteLine("   A BOM ON A JSON POST IS UNUSUAL AND ENTIRELY LEGAL, and some senders emit");
Console.WriteLine("   one because their serialiser defaults to it. So this is a bug that arrives");
Console.WriteLine("   as 'our integration works with everyone except one partner' - which is the");
Console.WriteLine("   hardest kind to be handed.");
Console.WriteLine();
Console.WriteLine("   AND THE GENERAL RULE IS SIMPLER THAN THE EXCEPTION: THE SIGNATURE IS OVER");
Console.WriteLine("   BYTES, SO VERIFY BYTES. Decoding is a transformation, transformations have");
Console.WriteLine("   edge cases, and you do not have to know what they are if you never decode.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task<JsonElement> PostJson(HttpClient http, string url, string body)
{
    HttpResponseMessage response = await http.PostAsync(
        url, new StringContent(body, Encoding.UTF8, "application/json"));

    return JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
}

static async Task<JsonElement> PostRaw(HttpClient http, string url, byte[] body, long timestamp, string signature)
{
    var content = new ByteArrayContent(body);
    content.Headers.Add("Content-Type", "application/json");

    var message = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };

    message.Headers.Add("x-ledger-timestamp", timestamp.ToString());
    message.Headers.Add("x-ledger-signature", signature);

    HttpResponseMessage response = await http.SendAsync(message);

    return JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
}

static string Sign(string secret, long timestamp, byte[] body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    byte[] material = [.. Encoding.UTF8.GetBytes($"{timestamp}."), .. body];

    return "v1=" + Convert.ToHexStringLower(hmac.ComputeHash(material));
}

// ---------------------------------------------------------------------------
public sealed record WebhookEvent(string Id, string Type);
