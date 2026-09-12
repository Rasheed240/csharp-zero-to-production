// 02-replay-and-idempotency.cs — A timestamp window is not replay protection,
// a seen-ids check is not idempotency, and where the check sits relative to
// the work decides whether a crash loses an event or does it twice.
//
// Run:  dotnet run 02-replay-and-idempotency.cs -c Release
//
// EXACT vs RATIO: every count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;

Console.WriteLine("Replay, duplicates, and where the check goes");
Console.WriteLine();

// ---------------------------------------------------------------------------
Console.WriteLine("1. THE WINDOW IS NOT REPLAY PROTECTION");
Console.WriteLine();
Console.WriteLine("   An attacker captures one valid delivery and sends it again immediately.");
Console.WriteLine();

int appliedWindowOnly = 0;
var seen = new ConcurrentDictionary<string, byte>();
int appliedWithIds = 0;

long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

for (int replay = 0; replay < 3; replay++)
{
    // Freshness only. The signature is valid and the timestamp is recent,
    // because it IS a real delivery - just not the first copy of it.
    if (Math.Abs(now - now) <= 300)
    {
        appliedWindowOnly++;
    }

    // Freshness AND a memory of what has been handled.
    if (Math.Abs(now - now) <= 300 && seen.TryAdd("evt_01HQ8", 0))
    {
        appliedWithIds++;
    }
}

Console.WriteLine("   what the receiver checks           times it applied a 3x replay");
Console.WriteLine("   ------------------------           ----------------------------");
Console.WriteLine($"   signature and timestamp window     {appliedWindowOnly,28}");
Console.WriteLine($"   ...and whether it has seen the id  {appliedWithIds,28}");
Console.WriteLine();
Console.WriteLine("   THE WINDOW BOUNDS HOW OLD A REQUEST MAY BE. It says nothing about how");
Console.WriteLine("   many times that request may arrive, and a replay inside the window is");
Console.WriteLine("   indistinguishable from a genuine delivery - IT IS BYTE-FOR-BYTE THE SAME");
Console.WriteLine("   REQUEST, with the same valid signature. No cryptography can separate them.");
Console.WriteLine();
Console.WriteLine("   SO THE TWO CHECKS ANSWER DIFFERENT QUESTIONS. The window stops a delivery");
Console.WriteLine("   captured last week; the id check stops the same delivery arriving twice in");
Console.WriteLine("   the next second. A receiver needs both, and the id check is the one that");
Console.WriteLine("   also handles the sender's own honest retries.");
Console.WriteLine();
Console.WriteLine("   AND THE WINDOW IS WHAT MAKES THE ID STORE AFFORDABLE. Ids only have to be");
Console.WriteLine("   remembered for as long as a delivery could still be accepted - the window");
Console.WriteLine("   plus a margin, not forever.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("2. AND THE ID CHECK HAS TO BE ATOMIC");
Console.WriteLine();
Console.WriteLine("   A sender retried a delivery whose first attempt was slow. Both arrive at");
Console.WriteLine("   once, at different instances behind a load balancer.");
Console.WriteLine();

foreach ((string label, bool atomic) in new[] { ("check, then add", false), ("TryAdd", true) })
{
    var store = new ConcurrentDictionary<string, byte>();
    int applied = 0;

    // Twenty concurrent pairs, because a race that fires once in ten runs is
    // still a race.
    await Task.WhenAll(Enumerable.Range(0, 20).Select(pair => Task.Run(async () =>
    {
        string id = $"evt_{pair:00}";

        await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Task.Run(() =>
        {
            if (atomic)
            {
                if (store.TryAdd(id, 0))
                {
                    Interlocked.Increment(ref applied);
                }

                return;
            }

            // The shape everybody writes first.
            if (!store.ContainsKey(id))
            {
                Thread.SpinWait(200);

                store[id] = 0;

                Interlocked.Increment(ref applied);
            }
        })));
    })));

    Console.WriteLine($"   {label,-18}  20 events, 2 deliveries each  ->  applied {applied} times");
}

Console.WriteLine();
Console.WriteLine("   'IF NOT SEEN, THEN MARK SEEN' IS TWO OPERATIONS, and a duplicate can");
Console.WriteLine("   arrive between them. The gap is small, which is exactly why this survives");
Console.WriteLine("   testing and fails under load - and a retry storm after an outage is");
Console.WriteLine("   precisely when many duplicates arrive at once.");
Console.WriteLine();
Console.WriteLine("   IN A REAL RECEIVER THE ATOMIC OPERATION IS THE DATABASE'S: an INSERT of");
Console.WriteLine("   the event id against a UNIQUE constraint, where a duplicate-key violation");
Console.WriteLine("   IS the answer. That works across instances, which a dictionary does not -");
Console.WriteLine("   and two instances behind a load balancer is the normal case, not an");
Console.WriteLine("   advanced one.");

// ---------------------------------------------------------------------------
Console.WriteLine();
Console.WriteLine("3. WHERE THE CLAIM SITS DECIDES WHAT A CRASH COSTS");
Console.WriteLine();
Console.WriteLine("   The receiver crashes between claiming the event and doing the work. The");
Console.WriteLine("   sender sees no response and redelivers. What happened to the charge?");
Console.WriteLine();

Console.WriteLine("   order of operations              charges applied   after redelivery");
Console.WriteLine("   ------------------              ---------------   ----------------");

foreach (string order in new[] { "claim-then-work", "work-then-claim", "one-transaction" })
{
    var db = new Database();

    // First attempt: crashes partway through.
    try
    {
        Handle(db, "evt_01HQ8", order, crash: true);
    }
    catch (SimulatedCrash)
    {
        db.Rollback();
    }

    int afterCrash = db.Charges;

    // The sender redelivers, because it never got a response.
    Handle(db, "evt_01HQ8", order, crash: false);

    Console.WriteLine($"   {order,-30}  {afterCrash,15}   {db.Charges,16}");
}

Console.WriteLine();
Console.WriteLine("   CLAIM-THEN-WORK LOSES THE EVENT. The claim was committed, the work was");
Console.WriteLine("   not, and the redelivery is correctly identified as a duplicate and");
Console.WriteLine("   skipped. The customer is never charged, nothing is logged as a failure,");
Console.WriteLine("   and the sender's delivery log says 'delivered'. THIS IS THE WORST OUTCOME");
Console.WriteLine("   IN THE TABLE and it is the arrangement that looks most careful.");
Console.WriteLine();
Console.WriteLine("   WORK-THEN-CLAIM CHARGES TWICE. The work committed, the claim did not, and");
Console.WriteLine("   the redelivery looks new. At least this one is visible: a customer with");
Console.WriteLine("   two charges tells you about it.");
Console.WriteLine();
Console.WriteLine("   ONE TRANSACTION IS THE ONLY CORRECT ANSWER. The claim and the work commit");
Console.WriteLine("   together or not at all, so a crash leaves nothing behind and the");
Console.WriteLine("   redelivery does the whole thing exactly once.");
Console.WriteLine();
Console.WriteLine("   WHICH IS A CONSTRAINT ON THE DESIGN, NOT A DETAIL OF IT. It means the");
Console.WriteLine("   dedupe store has to live in the SAME database as the work - a Redis SETNX");
Console.WriteLine("   beside a SQL transaction is the claim-then-work row, with a network");
Console.WriteLine("   partition instead of a crash. If the work spans two systems the problem");
Console.WriteLine("   does not go away; it becomes the outbox pattern again.");

// ---------------------------------------------------------------------------
static void Handle(Database db, string eventId, string order, bool crash)
{
    if (order == "claim-then-work")
    {
        if (!db.TryClaimCommitted(eventId))
        {
            return;
        }

        if (crash)
        {
            throw new SimulatedCrash();
        }

        db.ApplyChargeCommitted();

        return;
    }

    if (order == "work-then-claim")
    {
        if (db.HasClaim(eventId))
        {
            return;
        }

        db.ApplyChargeCommitted();

        if (crash)
        {
            throw new SimulatedCrash();
        }

        db.TryClaimCommitted(eventId);

        return;
    }

    // One transaction: the claim and the work are the same commit.
    db.Begin();

    if (!db.TryClaimPending(eventId))
    {
        db.Rollback();

        return;
    }

    db.ApplyChargePending();

    if (crash)
    {
        throw new SimulatedCrash();
    }

    db.Commit();
}

// ---------------------------------------------------------------------------
public sealed class SimulatedCrash : Exception;

// A database with exactly enough behaviour to tell committed state from
// pending state.
public sealed class Database
{
    private readonly HashSet<string> claims = [];

    private readonly List<string> pendingClaims = [];

    private int pendingCharges;

    public int Charges { get; private set; }

    public bool HasClaim(string id) => claims.Contains(id);

    public bool TryClaimCommitted(string id) => claims.Add(id);

    public void ApplyChargeCommitted() => Charges++;

    public void Begin()
    {
        pendingClaims.Clear();
        pendingCharges = 0;
    }

    public bool TryClaimPending(string id)
    {
        if (claims.Contains(id) || pendingClaims.Contains(id))
        {
            return false;
        }

        pendingClaims.Add(id);

        return true;
    }

    public void ApplyChargePending() => pendingCharges++;

    public void Commit()
    {
        foreach (string id in pendingClaims)
        {
            claims.Add(id);
        }

        Charges += pendingCharges;

        Begin();
    }

    public void Rollback() => Begin();
}
