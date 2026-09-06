// 02-targeting.cs — A percentage rollout is a hash, not a coin toss, and the
// difference is the whole of experiment design.
//
// Run:  dotnet run 02-targeting.cs -c Release
//
// EXACT vs RATIO: the hash-based results are fully deterministic and will be
// identical on every machine. The Random-based rows differ per run; the claim
// is that they are non-zero.

#:sdk Microsoft.NET.Sdk
#:property PublishAot=false

using System.Security.Cryptography;
using System.Text;

Console.WriteLine("Deciding who gets the feature");
Console.WriteLine();

CoinTossVersusHash();
Distribution();
Correlation();
Overrides();

// ---------------------------------------------------------------------------
static void CoinTossVersusHash()
{
    Console.WriteLine("1. The rollout that flipped under people");
    Console.WriteLine();
    Console.WriteLine("   A 50% rollout, written the obvious way and the correct way. Each of a");
    Console.WriteLine("   thousand users makes eight requests in a session.");
    Console.WriteLine();

    var random = new Random(12345);

    string[] users = [.. Enumerable.Range(1, 1000).Select(n => $"user-{n:0000}")];

    (string Name, Func<string, bool> Decide)[] strategies =
    [
        ("Random.Shared.NextDouble() < 0.5", _ => random.NextDouble() < 0.5),
        ("stable hash of the user id", user => InBucket(user, "NewCheckout", 50))
    ];

    Console.WriteLine("   how the 50% is decided             users who saw   users who saw BOTH");
    Console.WriteLine("                                      the feature     within one session");
    Console.WriteLine("   -----------------------            -------------   ------------------");

    foreach ((string name, Func<string, bool> decide) in strategies)
    {
        int sawFeature = 0;
        int sawBoth = 0;

        foreach (string user in users)
        {
            bool[] session = [.. Enumerable.Range(0, 8).Select(_ => decide(user))];

            if (session[0])
            {
                sawFeature++;
            }

            if (session.Distinct().Count() > 1)
            {
                sawBoth++;
            }
        }

        Console.WriteLine($"   {name,-34} {sawFeature,13}   {sawBoth}");
    }

    Console.WriteLine();
    Console.WriteLine("   BOTH ROLLED OUT TO ABOUT HALF THE USERS. That is the number anybody");
    Console.WriteLine("   would check, and it is the same for both, which is why this ships.");
    Console.WriteLine();
    Console.WriteLine("   THE SECOND COLUMN IS THE BUG. With a random draw, essentially every");
    Console.WriteLine("   user saw both versions during a single session - a new checkout on one");
    Console.WriteLine("   page and the old one on the next, back and forth, on every request.");
    Console.WriteLine();
    Console.WriteLine("   WHAT THAT COSTS IS WORSE THAN A CONFUSING INTERFACE:");
    Console.WriteLine();
    Console.WriteLine("     THE EXPERIMENT MEASURES NOTHING. Every user is in both arms, so the");
    Console.WriteLine("     two groups are identical and any difference between them is noise.");
    Console.WriteLine("     The dashboard still produces a number, with confidence intervals.");
    Console.WriteLine();
    Console.WriteLine("     STATE CROSSES THE BOUNDARY. If the two paths write different shapes");
    Console.WriteLine("     - a different idempotency key, a different cart representation, a");
    Console.WriteLine("     different ledger entry - then a session that crosses between them");
    Console.WriteLine("     produces data neither path can read.");
    Console.WriteLine();
    Console.WriteLine("     IT CANNOT BE REPRODUCED. A support ticket saying 'the checkout");
    Console.WriteLine("     looked different halfway through' is unfalsifiable, because the next");
    Console.WriteLine("     person to look gets a fresh coin toss.");
    Console.WriteLine();
    Console.WriteLine("   THE HASH VERSION IS STICKY BECAUSE IT IS A FUNCTION, not a draw. Same");
    Console.WriteLine("   user, same flag, same answer - on every request, on every instance, in");
    Console.WriteLine("   every process, forever, with nothing stored anywhere.");
    Console.WriteLine();
    Console.WriteLine("   THAT LAST PART IS WHY IT IS THE STANDARD APPROACH. There is no");
    Console.WriteLine("   assignment table to keep, nothing to replicate between instances, and");
    Console.WriteLine("   no lookup on the request path. The determinism IS the storage.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Distribution()
{
    Console.WriteLine("2. Whether the buckets are actually even");
    Console.WriteLine();
    Console.WriteLine("   'Hash the user id' only works if the hash spreads evenly. Ten thousand");
    Console.WriteLine("   users, at each rollout percentage:");
    Console.WriteLine();

    string[] users = [.. Enumerable.Range(1, 10_000).Select(n => $"user-{n:00000}")];

    Console.WriteLine("   asked for   actually enabled   error");
    Console.WriteLine("   ---------   ----------------   -----");

    foreach (int percent in new[] { 0, 1, 5, 25, 50, 75, 99, 100 })
    {
        int enabled = users.Count(u => InBucket(u, "NewCheckout", percent));
        double actual = enabled * 100.0 / users.Length;

        Console.WriteLine($"   {percent,8}%   {actual,15:0.00}%   {actual - percent,+6:0.00}");
    }

    Console.WriteLine();
    Console.WriteLine("   0% ENABLES NOBODY AND 100% ENABLES EVERYONE, which sounds trivial and");
    Console.WriteLine("   is the first thing to check in any implementation you did not write.");
    Console.WriteLine("   A rollout where 100% misses a handful of users is a rollout that can");
    Console.WriteLine("   never be finished, and where 0% catches a few is a kill switch that");
    Console.WriteLine("   does not kill.");
    Console.WriteLine();
    Console.WriteLine("   THE ERROR IN THE MIDDLE IS A FRACTION OF A PERCENT at ten thousand");
    Console.WriteLine("   users, and it is not random - it is FIXED. Run this again and you get");
    Console.WriteLine("   the same numbers, because a hash is a function. 'About 50%' means 'a");
    Console.WriteLine("   specific 49.7% of these specific users'.");
    Console.WriteLine();
    Console.WriteLine("   WHICH MATTERS AT SMALL SCALE. With a hundred users, a 5% rollout is");
    Console.WriteLine("   somewhere between three and eight of them, decided by the hash rather");
    Console.WriteLine("   than by anything you control. IF YOU NEED EXACTLY N USERS, LIST THEM -");
    Console.WriteLine("   percentage rollout is a tool for large populations.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Correlation()
{
    Console.WriteLine("3. Two rollouts that turn out to be the same rollout");
    Console.WriteLine();
    Console.WriteLine("   Two independent 50% experiments, run at the same time on the same");
    Console.WriteLine("   users. The question is whether they are independent.");
    Console.WriteLine();

    string[] users = [.. Enumerable.Range(1, 10_000).Select(n => $"user-{n:00000}")];

    // Without the flag name in the hash, every 50% flag picks the same half.
    int bothUnsalted = users.Count(u => InBucketUnsalted(u, 50) && InBucketUnsalted(u, 50));
    int aOnlyUnsalted = users.Count(u => InBucketUnsalted(u, 50));

    // With it, each flag hashes into its own space.
    int inA = users.Count(u => InBucket(u, "NewCheckout", 50));
    int inB = users.Count(u => InBucket(u, "NewPricing", 50));
    int inBoth = users.Count(u => InBucket(u, "NewCheckout", 50) && InBucket(u, "NewPricing", 50));

    Console.WriteLine("   hashing                          in flag A   in flag B   in BOTH   expected");
    Console.WriteLine("   -------                          ---------   ---------   -------   --------");
    Console.WriteLine($"   hash(user) only                  {aOnlyUnsalted,9}   {aOnlyUnsalted,9}   {bothUnsalted,7}   {users.Length / 4,8}");
    Console.WriteLine($"   hash(flag name + user)           {inA,9}   {inB,9}   {inBoth,7}   {users.Length / 4,8}");

    Console.WriteLine();
    Console.WriteLine("   WITHOUT THE FLAG NAME IN THE HASH, THE TWO EXPERIMENTS ARE THE SAME");
    Console.WriteLine("   EXPERIMENT. Every user in flag A's half is in flag B's half, because");
    Console.WriteLine("   the same input produced the same bucket. Two independent teams ran two");
    Console.WriteLine("   independent tests on two groups that were one group.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE MOST EXPENSIVE KIND OF BUG BECAUSE IT PRODUCES ANSWERS. No");
    Console.WriteLine("   error, no exception, no anomaly on any dashboard - two results that");
    Console.WriteLine("   look valid and are confounded with each other. If the pricing change");
    Console.WriteLine("   helped and the checkout change hurt, both experiments measured the sum");
    Console.WriteLine("   and neither team can tell.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS ONE STRING CONCATENATION: hash the FLAG NAME together with");
    Console.WriteLine("   the user id, so every flag gets its own independent assignment. The");
    Console.WriteLine("   overlap then lands at 25%, which is what two independent coin tosses");
    Console.WriteLine("   should give.");
    Console.WriteLine();
    Console.WriteLine("   AND THE GENERAL PRINCIPLE IS WORTH MORE THAN THE FIX: ANY TIME YOU");
    Console.WriteLine("   PARTITION THE SAME POPULATION TWICE BY THE SAME FUNCTION, YOU GET THE");
    Console.WriteLine("   SAME PARTITION. The same reasoning applies to shard keys, to cache");
    Console.WriteLine("   sharding, and to load balancer hashing - anywhere a deterministic");
    Console.WriteLine("   assignment is reused for a second purpose.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Overrides()
{
    Console.WriteLine("4. The list that has to sit above the percentage");
    Console.WriteLine();
    Console.WriteLine("   A percentage alone cannot answer the questions people actually ask of");
    Console.WriteLine("   a rollout, so real targeting is an ordered set of rules:");
    Console.WriteLine();

    string[] staff = ["user-00007", "user-00042"];
    string[] excluded = ["user-00099"];

    (string User, string Note)[] cases =
    [
        ("user-00007", "internal staff"),
        ("user-00042", "internal staff"),
        ("user-00099", "asked to be excluded after a bug"),
        ("user-00005", "ordinary, inside the 10%"),
        ("user-00002", "ordinary, outside it"),
        ("user-00001", "ordinary, well outside it")
    ];

    Console.WriteLine("   user         note                               10% rollout   why");
    Console.WriteLine("   ----         ----                               -----------   ---");

    foreach ((string user, string note) in cases)
    {
        (bool enabled, string why) = Evaluate(user, "NewCheckout", 10, staff, excluded);

        Console.WriteLine($"   {user,-12} {note,-34} {(enabled ? "on" : "off"),-13} {why}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE ORDER OF THOSE RULES IS THE DESIGN, and it is always the same:");
    Console.WriteLine();
    Console.WriteLine("     1. EXCLUSIONS FIRST. A customer who asked to be taken off a broken");
    Console.WriteLine("        rollout must stay off it when the percentage goes to 100. An");
    Console.WriteLine("        exclusion that a later rule can override is not an exclusion.");
    Console.WriteLine();
    Console.WriteLine("     2. THEN INCLUSIONS. Staff, the customer who asked for early access,");
    Console.WriteLine("        the account you are debugging. These have to be able to beat the");
    Console.WriteLine("        percentage, or you cannot test a feature at 0%.");
    Console.WriteLine();
    Console.WriteLine("     3. THEN THE PERCENTAGE, for everyone the first two did not decide.");
    Console.WriteLine();
    Console.WriteLine("   NOTICE WHAT RULE 2 BUYS: A ROLLOUT CAN START AT 0% AND STILL BE");
    Console.WriteLine("   TESTABLE IN PRODUCTION. That is the single most useful property of a");
    Console.WriteLine("   flag system, and it is the reason 'ship it dark' is possible at all.");
    Console.WriteLine();
    Console.WriteLine("   AND EVERY EVALUATION SHOULD BE ABLE TO SAY WHY. The 'why' column costs");
    Console.WriteLine("   almost nothing to produce and it is the difference between debugging a");
    Console.WriteLine("   rollout in minutes and reasoning about a hash function at 3am. When");
    Console.WriteLine("   somebody asks 'why did this customer get the new checkout', the answer");
    Console.WriteLine("   should be a lookup, not an investigation.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// The evaluation order that matters: exclusions, then inclusions, then the
// percentage - and it reports which rule decided.
static (bool Enabled, string Why) Evaluate(string user, string flag, int percent,
    string[] included, string[] excluded)
{
    if (excluded.Contains(user))
    {
        return (false, "excluded by list");
    }

    if (included.Contains(user))
    {
        return (true, "included by list");
    }

    return InBucket(user, flag, percent)
        ? (true, $"hash bucket {Bucket(user, flag)} < {percent}")
        : (false, $"hash bucket {Bucket(user, flag)} >= {percent}");
}

// ---------------------------------------------------------------------------
// A stable bucket in [0, 100) for one user and one flag. The FLAG NAME is part
// of the input, which is what keeps two rollouts independent.
static int Bucket(string user, string flag)
{
    byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{flag}:{user}"));

    // The first four bytes as an unsigned integer, then modulo 100. Using a
    // cryptographic hash is not about security - it is about getting an even
    // spread from inputs that are not random, like sequential ids.
    uint value = BitConverter.ToUInt32(hash, 0);

    return (int)(value % 100);
}

// ---------------------------------------------------------------------------
static bool InBucket(string user, string flag, int percent) => Bucket(user, flag) < percent;

// ---------------------------------------------------------------------------
// The same thing without the flag name, which is the mistake in section 3.
static bool InBucketUnsalted(string user, int percent)
{
    byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(user));

    return BitConverter.ToUInt32(hash, 0) % 100 < (uint)percent;
}
