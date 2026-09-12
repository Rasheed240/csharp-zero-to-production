// 04-exercises.cs — Four situations from real tickets. Every answer is
// measured here rather than asserted.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: the counts and verdicts are deterministic. The millisecond
// figures in exercise 3 are machine-specific; the ratio is the claim.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

const string Secret = "whsec_2f8a1c0e5b9d4a6f";

Console.WriteLine("Four situations from real tickets");
Console.WriteLine();

Exercise1();
Exercise2();
Exercise3();
Exercise4();

// ---------------------------------------------------------------------------
static void Exercise1()
{
    Console.WriteLine("EXERCISE 1 (easy) - the event that was retried for a day");
    Console.WriteLine();
    Console.WriteLine("   One malformed event - a field our parser cannot read - was redelivered");
    Console.WriteLine("   fourteen times over twenty-three hours. It failed identically every");
    Console.WriteLine("   time. Our on-call was paged twice.");
    Console.WriteLine();
    Console.WriteLine("   What did the handler return, and what should it have returned?");
    Console.WriteLine();

    Console.WriteLine("   what the handler returns      the sender's reaction         attempts");
    Console.WriteLine("   ------------------------      ---------------------         --------");

    foreach ((string status, string meaning) in new[]
    {
        ("200 OK", "done, never send it again"),
        ("202 Accepted", "done, never send it again"),
        ("400 Bad Request", "our fault, stop retrying"),
        ("401 Unauthorized", "our fault, stop retrying"),
        ("409 Conflict", "our fault, stop retrying"),
        ("429 Too Many Requests", "back off, retry later"),
        ("500 Internal Server Error", "their fault, retry"),
        ("503 Service Unavailable", "their fault, retry"),
        ("no response at all", "their fault, retry")
    })
    {
        bool retries = meaning.Contains("retry");

        Console.WriteLine($"   {status,-28}  {meaning,-28}  {(retries ? "up to 14" : "1"),8}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: IT RETURNED 500, AND A MALFORMED EVENT IS NOT A 500. A 5xx says");
    Console.WriteLine("   'this failed because of us and might work next time'. A payload we");
    Console.WriteLine("   cannot parse will never work next time, so every retry is guaranteed");
    Console.WriteLine("   waste - fourteen of them, plus the pages.");
    Console.WriteLine();
    Console.WriteLine("   THE STATUS CODE IS AN INSTRUCTION TO A RETRY LOOP, and that is the");
    Console.WriteLine("   whole of it. There are only three things you can say:");
    Console.WriteLine();
    Console.WriteLine("     2xx  I have this. Stop.");
    Console.WriteLine("     4xx  This will never work. Stop, and tell a human.");
    Console.WriteLine("     5xx  I am broken right now. Try again.");
    Console.WriteLine();
    Console.WriteLine("   A DUPLICATE IS A 200, NOT A 409. The sender is retrying because it is");
    Console.WriteLine("   not sure you got it; you did, so tell it so. A 409 is a permanent");
    Console.WriteLine("   failure in most senders' books and can disable your endpoint.");
    Console.WriteLine();
    Console.WriteLine("   AND AN UNPARSEABLE EVENT STILL HAS TO GO SOMEWHERE. Returning 400");
    Console.WriteLine("   stops the retries and drops the event: nobody will ever send it again.");
    Console.WriteLine("   So the 400 is correct only if you have ALSO stored the raw bytes for a");
    Console.WriteLine("   human to look at. Otherwise you have chosen silent data loss over");
    Console.WriteLine("   noisy retries, which is the worse of the two.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Exercise2()
{
    Console.WriteLine("EXERCISE 2 (medium) - the duplicates that only happen in production");
    Console.WriteLine();
    Console.WriteLine("   Our receiver deduplicates on the event id and it works perfectly in");
    Console.WriteLine("   testing. In production, roughly one event in three is processed twice.");
    Console.WriteLine("   We run three instances behind a load balancer.");
    Console.WriteLine();
    Console.WriteLine("   Why one in three?");
    Console.WriteLine();

    Console.WriteLine("   where the seen-ids live       instances   events   times applied");
    Console.WriteLine("   ---------------------       ---------   ------   -------------");

    foreach ((string label, bool shared) in new[]
    {
        ("in each instance's memory", false),
        ("in one shared store", true)
    })
    {
        var sharedStore = new ConcurrentDictionary<string, byte>();
        var perInstance = new[]
        {
            new ConcurrentDictionary<string, byte>(),
            new ConcurrentDictionary<string, byte>(),
            new ConcurrentDictionary<string, byte>()
        };

        int applied = 0;
        int sameInstance = 0;

        // Seeded, so the file reports the same number every run.
        var balancer = new Random(20260909);

        // 30 events, each delivered twice - a first attempt and one honest
        // retry - landing on instances chosen round-robin by the balancer.
        for (int n = 0; n < 30; n++)
        {
            string id = $"evt_{n:00}";

            // The balancer does not know or care that these two requests are
            // the same event. Each lands wherever it lands.
            int first = balancer.Next(3);
            int second = balancer.Next(3);

            if (first == second)
            {
                sameInstance++;
            }

            foreach (int instance in new[] { first, second })
            {
                ConcurrentDictionary<string, byte> store = shared ? sharedStore : perInstance[instance];

                if (store.TryAdd(id, 0))
                {
                    applied++;
                }
            }
        }

        Console.WriteLine($"   {label,-27}         3       30   {applied,13}");

        if (!shared)
        {
            Console.WriteLine($"     of 30 events, both deliveries landed on the same instance {sameInstance} times");
        }
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE DEDUPE STORE IS PER-INSTANCE, so it only works when both");
    Console.WriteLine("   deliveries of an event happen to land on the same instance. With three");
    Console.WriteLine("   instances and a balancer that does not care which one you get, THAT IS");
    Console.WriteLine("   ONE TIME IN THREE - measured above as 12 of 30, giving 48 applications");
    Console.WriteLine("   of 30 events. A shared store gave exactly 30.");
    Console.WriteLine();
    Console.WriteLine("   IT WORKS IN TESTING BECAUSE TESTING RUNS ONE INSTANCE. The bug is not");
    Console.WriteLine("   in the logic; it is in an assumption the logic quietly makes, and no");
    Console.WriteLine("   single-process test can see it.");
    Console.WriteLine();
    Console.WriteLine("   'ONE IN THREE' IS THE CLUE THAT NAMES THE CAUSE. A ratio that matches");
    Console.WriteLine("   your instance count is almost always per-instance state - a cache, a");
    Console.WriteLine("   rate limiter, a set of seen ids, an in-memory lock.");
    Console.WriteLine();
    Console.WriteLine("   AND THE FIX IS NOT STICKY SESSIONS. Pinning a sender to an instance");
    Console.WriteLine("   makes duplicates rarer and keeps the bug: the instance restarts, or");
    Console.WriteLine("   scales, or the pin expires between the attempt and the retry - which,");
    Console.WriteLine("   with a six-hour backoff, it certainly will. THE SEEN-IDS SET IS SHARED");
    Console.WriteLine("   STATE, and it belongs in the database the work commits to.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Exercise3()
{
    Console.WriteLine("EXERCISE 3 (medium-hard) - the endpoint that anyone could make work");
    Console.WriteLine();
    Console.WriteLine("   Our webhook endpoint is public, and correctly rejects anything without");
    Console.WriteLine("   a valid signature. A load test from an unauthenticated address still");
    Console.WriteLine("   took the service down.");
    Console.WriteLine();
    Console.WriteLine("   What work is an unauthenticated caller able to make us do?");
    Console.WriteLine();

    // A large, deeply nested payload. Entirely legal JSON, and unsigned.
    string hostile = BuildNested(depth: 40, siblings: 400);
    byte[] bytes = Encoding.UTF8.GetBytes(hostile);

    long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    const string BadSignature = "v1=0000000000000000000000000000000000000000000000000000000000000000";

    var clock = new Stopwatch();

    // Order A: parse, log, then verify. The shape that reads naturally.
    clock.Restart();

    for (int n = 0; n < 200; n++)
    {
        JsonDocument parsed = JsonDocument.Parse(bytes);
        string logged = parsed.RootElement.ToString();

        GC.KeepAlive(logged);

        parsed.Dispose();

        if (!Verify(Secret, timestamp, bytes, BadSignature))
        {
            continue;
        }
    }

    double parseFirst = clock.Elapsed.TotalMilliseconds;

    // Order B: verify, then parse.
    clock.Restart();

    for (int n = 0; n < 200; n++)
    {
        if (!Verify(Secret, timestamp, bytes, BadSignature))
        {
            continue;
        }

        JsonDocument parsed = JsonDocument.Parse(bytes);

        parsed.Dispose();
    }

    double verifyFirst = clock.Elapsed.TotalMilliseconds;

    Console.WriteLine($"   payload size                                 {bytes.Length:N0} bytes");
    Console.WriteLine();
    Console.WriteLine("   order of operations           200 unsigned requests cost");
    Console.WriteLine("   ------------------           --------------------------");
    Console.WriteLine($"   parse and log, then verify   {parseFirst,20:0} ms");
    Console.WriteLine($"   verify, then parse           {verifyFirst,20:0} ms");
    Console.WriteLine($"   ratio                        {parseFirst / Math.Max(verifyFirst, 0.001),19:0.0}x");
    Console.WriteLine();
    Console.WriteLine("   ANSWER: EVERYTHING THAT HAPPENS BEFORE THE SIGNATURE CHECK IS WORK AN");
    Console.WriteLine("   ANONYMOUS CALLER GETS FOR FREE. Parsing is the expensive one, and it");
    Console.WriteLine("   is the one that reads most naturally at the top of a handler, because");
    Console.WriteLine("   the parsed object is what everything below it wants.");
    Console.WriteLine();
    Console.WriteLine("   THE SIGNATURE CHECK IS CHEAP AND FIXED. One HMAC over the bytes,");
    Console.WriteLine("   regardless of what those bytes contain - which is exactly the property");
    Console.WriteLine("   you want in the first thing an untrusted request touches.");
    Console.WriteLine();
    Console.WriteLine("   SO THE ORDER IS: LENGTH LIMIT, TIMESTAMP, SIGNATURE, AND ONLY THEN");
    Console.WriteLine("   PARSE. The length limit comes first because the HMAC itself is linear");
    Console.WriteLine("   in the body size, so a 500 MB body is still work you are doing for a");
    Console.WriteLine("   stranger. Kestrel's default MaxRequestBodySize of 30 MB is a backstop,");
    Console.WriteLine("   not a webhook limit - a real event is kilobytes.");
    Console.WriteLine();
    Console.WriteLine("   AND LOGGING THE BODY IS PART OF THE PROBLEM, not the diagnosis. An");
    Console.WriteLine("   unverified payload written to a log is an unauthenticated caller");
    Console.WriteLine("   filling your disk and putting their text in front of your operators.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Exercise4()
{
    Console.WriteLine("EXERCISE 4 (hard) - the event that was claimed but never done");
    Console.WriteLine();
    Console.WriteLine("   The receiver verifies, records the event id, returns 200, and hands the");
    Console.WriteLine("   work to a background worker. Idempotency is solid: nothing is ever");
    Console.WriteLine("   processed twice. Occasionally an event is never processed at all, and");
    Console.WriteLine("   nothing anywhere reports it.");
    Console.WriteLine();
    Console.WriteLine("   Where does it go?");
    Console.WriteLine();

    Console.WriteLine("   claim records                  events   completed   lost   redelivery");
    Console.WriteLine("   -------------                  ------   ---------   ----   ----------");

    foreach (string design in new[] { "seen / not seen", "pending -> done, swept" })
    {
        var claims = new Dictionary<string, string>();
        int completed = 0;

        // Ten events. The worker dies partway through three of them.
        for (int n = 0; n < 10; n++)
        {
            string id = $"evt_{n:00}";
            bool workerDies = n is 3 or 6 or 9;

            if (design == "seen / not seen")
            {
                // One bit: have we seen it. Recorded on arrival.
                if (!claims.TryAdd(id, "seen"))
                {
                    continue;
                }

                if (workerDies)
                {
                    continue;
                }

                completed++;
            }
            else
            {
                // Two states, and a timestamp. Recorded as pending on arrival.
                if (claims.TryGetValue(id, out string? state) && state == "done")
                {
                    continue;
                }

                claims[id] = "pending";

                if (workerDies)
                {
                    continue;
                }

                claims[id] = "done";
                completed++;
            }
        }

        // The sender redelivers everything it did not get a 200 for. It got a
        // 200 for all ten, so it redelivers nothing - and a sweep is the only
        // thing that can find the stragglers.
        int lost = 10 - completed;
        int recovered = 0;

        if (design != "seen / not seen")
        {
            // The sweep: anything pending and older than the worker's budget
            // is retried locally.
            foreach (string id in claims.Where(c => c.Value == "pending").Select(c => c.Key).ToArray())
            {
                claims[id] = "done";
                recovered++;
            }
        }

        Console.WriteLine($"   {design,-28}  {10,7}   {completed,9}   {lost,4}   " +
            $"{(design == "seen / not seen" ? "never - it has a 200" : $"swept locally, {recovered} recovered"),-20}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: THE CLAIM RECORDS ARRIVAL, NOT COMPLETION. 'Seen' is written");
    Console.WriteLine("   the moment the event lands, so an event whose work never finished is");
    Console.WriteLine("   indistinguishable from one that finished perfectly. The dedupe check");
    Console.WriteLine("   then does its job flawlessly and skips it forever.");
    Console.WriteLine();
    Console.WriteLine("   AND THE SENDER CANNOT HELP, because we returned 200. That was the");
    Console.WriteLine("   right answer at the time and it moved the responsibility to us");
    Console.WriteLine("   permanently. FAST ACKNOWLEDGEMENT IS A TRANSFER OF LIABILITY: from");
    Console.WriteLine("   the instant you send it, the sender's retries are gone and every");
    Console.WriteLine("   remaining failure is yours to detect.");
    Console.WriteLine();
    Console.WriteLine("   SO THE CLAIM NEEDS A STATE AND A CLOCK, not a bit. Pending on arrival,");
    Console.WriteLine("   done on completion, and a sweep that finds anything pending for longer");
    Console.WriteLine("   than the work should take. A duplicate arriving while one is pending");
    Console.WriteLine("   is answered 200 and dropped - the first one is still going.");
    Console.WriteLine();
    Console.WriteLine("   THE METRIC THAT CATCHES IT IS THE AGE OF THE OLDEST PENDING CLAIM.");
    Console.WriteLine("   Not the failure rate, which is zero, and not the processed count,");
    Console.WriteLine("   which looks healthy. This is the same shape as queue age on the");
    Console.WriteLine("   sending side: THE THING TO WATCH IS THE WORK NOBODY HAS FINISHED, and");
    Console.WriteLine("   on both sides of the wire it is the number nobody has.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static string BuildNested(int depth, int siblings)
{
    var json = new StringBuilder();

    for (int n = 0; n < depth; n++)
    {
        json.Append("{\"a\":");
    }

    json.Append('[');

    for (int n = 0; n < siblings; n++)
    {
        json.Append(n == 0 ? "" : ",");
        json.Append($"{{\"paymentId\":\"PAY-{n:000}\",\"amountMinor\":{n},\"currency\":\"GBP\"}}");
    }

    json.Append(']');

    for (int n = 0; n < depth; n++)
    {
        json.Append('}');
    }

    return json.ToString();
}

static bool Verify(string secret, long timestamp, byte[] body, string presented)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    byte[] material = [.. Encoding.UTF8.GetBytes($"{timestamp}."), .. body];

    string expected = "v1=" + Convert.ToHexStringLower(hmac.ComputeHash(material));

    return CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(presented), Encoding.UTF8.GetBytes(expected));
}
