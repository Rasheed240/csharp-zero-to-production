// 01-signing.cs — What the signature is actually over, why re-serialising the
// body destroys it, what the timestamp is for, and how a secret is rotated
// without an outage.
//
// Run:  dotnet run 01-signing.cs -c Release
//
// EXACT vs RATIO: the signatures, verdicts and byte counts are deterministic.
// The timing comparison in section 3 is machine-specific and is discussed
// rather than relied on.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

Console.WriteLine("What the signature is over");
Console.WriteLine();

const string Secret = "whsec_2f8a1c0e5b9d4a6f";

// The producer serialises once. These are the bytes on the wire.
string body = JsonSerializer.Serialize(new
{
    id = "evt_01HQ8",
    type = "payment.captured",
    data = new { paymentId = "PAY-001", amountMinor = 4999 }
});

long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();



// ---------------------------------------------------------------------------
Console.WriteLine("1. THE SIGNATURE IS OVER BYTES, NOT OVER MEANING");
Console.WriteLine();
Console.WriteLine("   Four consumers, all verifying 'the payload' - each having obtained the");
Console.WriteLine("   bytes to verify in a different, entirely reasonable way.");
Console.WriteLine();

// (a) The raw request body. The only correct one.
string raw = body;

// (b) Round-tripped through JsonElement, which is what a consumer does when it
// binds the body loosely and re-serialises to verify.
JsonElement parsed = JsonSerializer.Deserialize<JsonElement>(body);
string looselyBound = JsonSerializer.Serialize(parsed);

// (c) Round-tripped through a typed model, which is what a consumer does when
// it binds to a class - the shape every framework encourages.
WebhookEvent typed = JsonSerializer.Deserialize<WebhookEvent>(body,
    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
string typedRoundTrip = JsonSerializer.Serialize(typed);

// (d) Pretty-printed, which is what a consumer does when it logs the body and
// verifies what it logged.
string pretty = JsonSerializer.Serialize(parsed, new JsonSerializerOptions { WriteIndented = true });

Console.WriteLine("   what the consumer verified against   bytes   signature matches?");
Console.WriteLine("   ----------------------------------   -----   ------------------");

foreach ((string label, string candidate) in new[]
{
    ("the raw request body", raw),
    ("a JsonElement round trip", looselyBound),
    ("a typed model round trip", typedRoundTrip),
    ("the body it pretty-printed", pretty)
})
{
    bool matches = Sign(Secret, now, candidate) == Sign(Secret, now, body);

    Console.WriteLine($"   {label,-34}   {candidate.Length,5}   {(matches ? "yes" : "NO")}");
}

Console.WriteLine();
Console.WriteLine($"   typed round trip: {typedRoundTrip}");
Console.WriteLine();
Console.WriteLine("   THE SECOND ROW IS THE DANGEROUS ONE, AND IT PASSED. Round-tripping");
Console.WriteLine("   through JsonElement happened to reproduce the bytes exactly, because");
Console.WriteLine("   System.Text.Json preserves property order and writes compactly. So a");
Console.WriteLine("   consumer written the wrong way CAN PASS EVERY TEST - until the producer");
Console.WriteLine("   adds a field with a character that escapes differently, or changes a");
Console.WriteLine("   serialiser option, or sends a number that round-trips to a different");
Console.WriteLine("   text form. The bug ships because the wrong thing works.");
Console.WriteLine();
Console.WriteLine("   THE THIRD ROW IS THE SAME MISTAKE WITH THE MASK OFF: bind to a class and");
Console.WriteLine("   the property names come back in the class's casing, so nothing matches.");
Console.WriteLine("   That one fails immediately, which makes it the lucky version.");
Console.WriteLine();
Console.WriteLine("   HMAC HAS NO IDEA WHAT A PAYMENT IS; it is a function of bytes. A space, a");
Console.WriteLine("   key order, a trailing newline or a re-encoded number changes every byte of");
Console.WriteLine("   the output, and there is no partial credit.");
Console.WriteLine();
Console.WriteLine("   SO THE CONSUMER MUST VERIFY AGAINST THE RAW REQUEST BODY, BEFORE ANY");
Console.WriteLine("   PARSING - in ASP.NET Core, reading request.Body rather than accepting a");
Console.WriteLine("   bound model. The producer has to document that, because the natural way");
Console.WriteLine("   to write the consumer is the broken way.");
Console.WriteLine();
Console.WriteLine("   AND THE PRODUCER MUST SERIALISE ONCE. Signing an object and then");
Console.WriteLine("   serialising it again for the wire is the identical bug from the other");
Console.WriteLine("   side, and it fails the same way: intermittently, long after release.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. WHAT THE TIMESTAMP IS FOR");
Console.WriteLine();

long fifteenMinutesAgo = now - 900;

Console.WriteLine("   an attacker replays a delivery they captured 15 minutes ago:");
Console.WriteLine();
Console.WriteLine("   scheme                              replay accepted?");
Console.WriteLine("   ------                              ----------------");

// Signed over the body alone: the captured request stays valid forever.
string bodyOnly = SignBodyOnly(Secret, body);

Console.WriteLine($"   signature over the body only        " +
    $"{(VerifyBodyOnly(Secret, body, bodyOnly) ? "YES - it is still a valid signature" : "no")}");

// Signed over timestamp AND body, with the consumer enforcing a window.
string timestamped = Sign(Secret, fifteenMinutesAgo, body);

bool accepted = Verify(Secret, fifteenMinutesAgo, body, timestamped, tolerance: 300, nowSeconds: now);

Console.WriteLine($"   signature over timestamp and body   " +
    $"{(accepted ? "YES" : "no - outside the 5-minute window")}");

// The same delivery, on time.
bool onTime = Verify(Secret, now, body, Sign(Secret, now, body), tolerance: 300, nowSeconds: now);

Console.WriteLine($"   the same scheme, delivered on time  {(onTime ? "yes, accepted" : "no")}");
Console.WriteLine();
Console.WriteLine("   A SIGNATURE PROVES AUTHORSHIP, NOT FRESHNESS. Without a timestamp inside");
Console.WriteLine("   the signed material, a captured delivery is a valid delivery forever -");
Console.WriteLine("   anybody who logs a request body, or reads one out of a proxy cache, can");
Console.WriteLine("   replay 'payment.captured' as many times as they like.");
Console.WriteLine();
Console.WriteLine("   THE TIMESTAMP MUST BE INSIDE THE SIGNATURE, NOT BESIDE IT. A timestamp");
Console.WriteLine("   header that is not signed is a header the attacker edits.");
Console.WriteLine();
Console.WriteLine("   AND THE TOLERANCE IS A REAL TRADE-OFF. Too tight and clock skew on the");
Console.WriteLine("   consumer's machine rejects honest deliveries; too loose and the replay");
Console.WriteLine("   window is wide. Five minutes is the common choice - and it is why a");
Console.WriteLine("   RETRY MUST BE RE-SIGNED WITH THE CURRENT TIME rather than resent");
Console.WriteLine("   verbatim, or a delivery retried after ten minutes fails verification.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. WHY THE COMPARISON IS CONSTANT-TIME");
Console.WriteLine();

string correct = Sign(Secret, now, body);
string wrongEarly = "v1=0" + correct[4..];
string wrongLate = correct[..^1] + (correct[^1] == 'a' ? 'b' : 'a');

const int Iterations = 2_000_000;

double naiveEarly = TimeNaive(correct, wrongEarly, Iterations);
double naiveLate = TimeNaive(correct, wrongLate, Iterations);
double fixedEarly = TimeFixed(correct, wrongEarly, Iterations);
double fixedLate = TimeFixed(correct, wrongLate, Iterations);

Console.WriteLine($"   {Iterations:N0} comparisons of a 67-character signature");
Console.WriteLine();
Console.WriteLine("   comparison                 mismatch at byte 3   mismatch at the last byte");
Console.WriteLine("   ----------                 ------------------   -------------------------");
Console.WriteLine($"   string ==                  {naiveEarly,15:0} ms   {naiveLate,22:0} ms");
Console.WriteLine($"   FixedTimeEquals            {fixedEarly,15:0} ms   {fixedLate,22:0} ms");
Console.WriteLine();
Console.WriteLine($"   ratio, string ==           {naiveLate / naiveEarly,15:0.00}x");
Console.WriteLine($"   ratio, FixedTimeEquals     {fixedLate / fixedEarly,15:0.00}x");
Console.WriteLine();
Console.WriteLine("   AN ORDINARY COMPARISON RETURNS AS SOON AS IT FINDS A DIFFERENCE, so how");
Console.WriteLine("   long it takes tells an attacker HOW MUCH OF THEIR GUESS WAS RIGHT. Guess");
Console.WriteLine("   one byte at a time and a 32-byte signature costs 8,192 attempts rather");
Console.WriteLine("   than 2^256.");
Console.WriteLine();
Console.WriteLine("   THE DIRECTION IS STABLE AND THE SIZE IS NOT. Across four runs on this");
Console.WriteLine("   machine the string == ratio came out between 1.67x and 3.45x, and");
Console.WriteLine("   FixedTimeEquals between 0.83x and 1.10x - a signal that is always there");
Console.WriteLine("   for one and never for the other. IN ABSOLUTE TERMS THE GAP IS A FEW");
Console.WriteLine("   NANOSECONDS PER COMPARISON.");
Console.WriteLine();
Console.WriteLine("   THAT IS THE HONEST POSITION: this was measured in-process with no network");
Console.WriteLine("   in the way, which is the most favourable case an attacker could hope for,");
Console.WriteLine("   and a remote timing attack across the internet is hard and sometimes");
Console.WriteLine("   impractical.");
Console.WriteLine();
Console.WriteLine("   IT IS STILL NOT A DEFENCE, because the attacker chooses how many samples");
Console.WriteLine("   to average and how long to be patient, and you do not get to know how");
Console.WriteLine("   quiet their network path is.");
Console.WriteLine();
Console.WriteLine("   AND NOTE WHAT FixedTimeEquals COSTS: ABOUT 0.36 MICROSECONDS PER CALL -");
Console.WriteLine("   twenty times the fast path, and once per webhook delivery. At a thousand");
Console.WriteLine("   deliveries a second that is 0.4 milliseconds of CPU. THE FLAT COST IS THE");
Console.WriteLine("   POINT: it is doing the same work regardless of where the mismatch is,");
Console.WriteLine("   which is the property being bought.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("4. ROTATING A SECRET WITHOUT AN OUTAGE");
Console.WriteLine();

const string OldSecret = "whsec_2f8a1c0e5b9d4a6f";
const string NewSecret = "whsec_9b3e7d21c40f8a55";

// During rotation the producer sends both signatures in one header.
string header = string.Join(",", Sign(OldSecret, now, body), Sign(NewSecret, now, body));

Console.WriteLine($"   x-ledger-signature: {header}");
Console.WriteLine();
Console.WriteLine("   consumer holding      accepts?");
Console.WriteLine("   ----------------      --------");
Console.WriteLine($"   only the old secret   {AcceptsAny(header, OldSecret, now, body)}");
Console.WriteLine($"   only the new secret   {AcceptsAny(header, NewSecret, now, body)}");
Console.WriteLine($"   an unrelated secret   {AcceptsAny(header, "whsec_wrong", now, body)}");
Console.WriteLine();
Console.WriteLine("   A SECRET CANNOT BE ROTATED IN ONE STEP, because the producer and every");
Console.WriteLine("   consumer would have to change at the same instant. Sending BOTH");
Console.WriteLine("   signatures during the overlap means a consumer verifies against whichever");
Console.WriteLine("   one it holds and rotates on its own schedule.");
Console.WriteLine();
Console.WriteLine("   THE SAME MECHANISM CARRIES ALGORITHM CHANGES, which is what the 'v1='");
Console.WriteLine("   prefix is for. A 'v2=' can appear alongside it, and consumers that do not");
Console.WriteLine("   understand v2 ignore it - so a comma-separated list of versioned");
Console.WriteLine("   signatures is not decoration, it is the upgrade path.");

// ---------------------------------------------------------------------------
static string Sign(string secret, long timestamp, string body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}"));

    return "v1=" + Convert.ToHexStringLower(hash);
}

static string SignBodyOnly(string secret, string body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    return "v1=" + Convert.ToHexStringLower(hmac.ComputeHash(Encoding.UTF8.GetBytes(body)));
}

static bool VerifyBodyOnly(string secret, string body, string signature) =>
    CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(signature),
        Encoding.UTF8.GetBytes(SignBodyOnly(secret, body)));

static bool Verify(string secret, long timestamp, string body, string signature,
    long tolerance, long nowSeconds)
{
    // The window is checked FIRST, because a signature that is valid but old
    // is exactly what a replay looks like.
    if (Math.Abs(nowSeconds - timestamp) > tolerance)
    {
        return false;
    }

    return CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(signature),
        Encoding.UTF8.GetBytes(Sign(secret, timestamp, body)));
}

static string AcceptsAny(string header, string secret, long timestamp, string body)
{
    string expected = Sign(secret, timestamp, body);

    foreach (string candidate in header.Split(','))
    {
        if (CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(candidate),
            Encoding.UTF8.GetBytes(expected)))
        {
            return "yes";
        }
    }

    return "no";
}

static double TimeNaive(string a, string b, int iterations)
{
    // Warm up, so the first row measured is not the one that pays for the JIT.
    for (int n = 0; n < 200_000; n++)
    {
        Sink.Value ^= string.Equals(a, b, StringComparison.Ordinal);
    }

    double best = double.MaxValue;

    // Best of five. A timing signal this small is buried by any interruption,
    // and the minimum is the run that was interrupted least.
    for (int round = 0; round < 5; round++)
    {
        var clock = Stopwatch.StartNew();

        for (int n = 0; n < iterations; n++)
        {
            Sink.Value ^= string.Equals(a, b, StringComparison.Ordinal);
        }

        best = Math.Min(best, clock.Elapsed.TotalMilliseconds);
    }

    return best;
}

static double TimeFixed(string a, string b, int iterations)
{
    byte[] left = Encoding.UTF8.GetBytes(a);
    byte[] right = Encoding.UTF8.GetBytes(b);

    for (int n = 0; n < 200_000; n++)
    {
        Sink.Value ^= CryptographicOperations.FixedTimeEquals(left, right);
    }

    double best = double.MaxValue;

    for (int round = 0; round < 5; round++)
    {
        var clock = Stopwatch.StartNew();

        for (int n = 0; n < iterations; n++)
        {
            Sink.Value ^= CryptographicOperations.FixedTimeEquals(left, right);
        }

        best = Math.Min(best, clock.Elapsed.TotalMilliseconds);
    }

    return best;
}

// The shape a consumer binds to when it takes the convenient route.
// Kept alive so the comparison loops in section 3 cannot be optimised away.
public static class Sink
{
    public static bool Value;
}

public sealed record WebhookEvent(string Id, string Type, EventData Data);

public sealed record EventData(string PaymentId, int AmountMinor);
