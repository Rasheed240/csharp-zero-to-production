// 03-production.cs — The flag nobody removed, flipped at 3am by somebody who
// did not write it.
//
// Run:  dotnet run 03-production.cs -c Release
//
// EXACT vs RATIO: every value and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

Console.WriteLine("An incident: 'we turned the safety switch on and it got worse'");
Console.WriteLine();

TheIncident();
await WhatTheFallbackDid();
WhyItRotted();
TheRegistry();
WhatToDo();

// ---------------------------------------------------------------------------
static void TheIncident()
{
    Console.WriteLine("1. What was seen");
    Console.WriteLine();
    Console.WriteLine("   Twenty months ago Ledger migrated its pricing engine. The migration");
    Console.WriteLine("   was done carefully, behind a flag, with the old path kept as a");
    Console.WriteLine("   fallback:");
    Console.WriteLine();
    Console.WriteLine("     if (flags.IsEnabled(\"LegacyPricingFallback\"))");
    Console.WriteLine("     {");
    Console.WriteLine("         return LegacyPricing(order);");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("     return NewPricing(order);");
    Console.WriteLine();
    Console.WriteLine("   The rollout went well. The flag was set to false everywhere and the");
    Console.WriteLine("   ticket to remove it went into the backlog, where it aged out.");
    Console.WriteLine();
    Console.WriteLine("     02:40   The pricing service starts returning 500s after a bad");
    Console.WriteLine("             deployment. Checkout is broken.");
    Console.WriteLine();
    Console.WriteLine("     02:48   The on-call engineer, who joined fourteen months ago,");
    Console.WriteLine("             searches the flag console for anything relevant and finds");
    Console.WriteLine("             LegacyPricingFallback. The name is encouraging.");
    Console.WriteLine();
    Console.WriteLine("     02:49   They turn it on. The 500s stop immediately. Checkout works.");
    Console.WriteLine("             The incident is declared mitigated and everybody goes back");
    Console.WriteLine("             to bed.");
    Console.WriteLine();
    Console.WriteLine("     09:15   Finance asks why 4,000 orders were taken overnight at");
    Console.WriteLine("             GBP 0.00.");
    Console.WriteLine();
    Console.WriteLine("   THE MITIGATION WORKED - the errors stopped, and every graph the");
    Console.WriteLine("   on-call engineer could see said the incident was over. It cost more");
    Console.WriteLine("   than the outage it fixed.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task WhatTheFallbackDid()
{
    Console.WriteLine("2. What the fallback path actually returned");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();

    var flags = new Flags();
    builder.Services.AddSingleton(flags);

    var app = builder.Build();

    // The catalogue as it is TODAY. Twenty months ago prices lived in
    // Amount, a decimal of pounds. The migration moved them to AmountMinor,
    // an integer of pence, and left the old field in place so that nothing
    // broke during the transition.
    List<Product> catalogue =
    [
        new("SKU-001", "Desk lamp", AmountMinor: 4999, Amount: 0m),
        new("SKU-002", "Bookshelf", AmountMinor: 12950, Amount: 0m),
        new("SKU-003", "Rug", AmountMinor: 7500, Amount: 0m)
    ];

    app.MapGet("/v1/price/{sku}", (string sku, Flags f) =>
    {
        Product product = catalogue.First(p => p.Sku == sku);

        // The branch, exactly as it was written twenty months ago.
        if (f.IsEnabled("LegacyPricingFallback"))
        {
            return Results.Ok(new { sku, path = "legacy", pence = LegacyPricing(product) });
        }

        return Results.Ok(new { sku, path = "new", pence = NewPricing(product) });
    });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    Console.WriteLine("   product      flag off (new path)   flag on (legacy path)");
    Console.WriteLine("   -------      -------------------   ---------------------");

    foreach (string sku in new[] { "SKU-001", "SKU-002", "SKU-003" })
    {
        flags.Set("LegacyPricingFallback", false);
        string newPath = await Price(http, sku);

        flags.Set("LegacyPricingFallback", true);
        string legacyPath = await Price(http, sku);

        Console.WriteLine($"   {sku,-12} {newPath,19}   {legacyPath}");
    }

    await app.StopAsync();
    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   THE LEGACY PATH PRICED EVERYTHING AT ZERO, and it did not throw, log,");
    Console.WriteLine("   or fail a health check while doing it. It read the field it had always");
    Console.WriteLine("   read. Nothing has written to that field for twenty months.");
    Console.WriteLine();
    Console.WriteLine("   THE CODE COMPILES. THE TYPES MATCH. THE TESTS - the ones that exist -");
    Console.WriteLine("   PASS. The branch is not broken in any way a tool can detect; it is");
    Console.WriteLine("   correct code operating on an assumption that stopped being true");
    Console.WriteLine("   without anybody editing it.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS THE DEFINING PROPERTY OF A ROTTED BRANCH: IT DID NOT CHANGE.");
    Console.WriteLine("   THE WORLD AROUND IT DID. A branch nobody executes gets no bug reports,");
    Console.WriteLine("   no profiling data, no exceptions, and no attention during any of the");
    Console.WriteLine("   migrations that invalidate it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhyItRotted()
{
    Console.WriteLine("3. Everything that happened to that branch while nobody looked");
    Console.WriteLine();
    Console.WriteLine("   Twenty months of ordinary, well-executed work, none of which was");
    Console.WriteLine("   wrong:");
    Console.WriteLine();
    Console.WriteLine("   month   change                                     effect on the legacy branch");
    Console.WriteLine("   -----   ------                                     ---------------------------");
    Console.WriteLine("       0   flag added, both paths live                none - both are exercised");
    Console.WriteLine("       2   rollout completes, flag set to false       the branch stops executing");
    Console.WriteLine("       5   prices move to integer minor units         reads a field nothing fills");
    Console.WriteLine("       8   VAT rules change for digital goods         the branch keeps the old rate");
    Console.WriteLine("      11   currency support added                     the branch assumes GBP");
    Console.WriteLine("      14   its integration test deleted as 'dead'     nothing exercises it at all");
    Console.WriteLine("      20   flipped on during an incident              all of the above, at once");
    Console.WriteLine();
    Console.WriteLine("   READ THE 'CHANGE' COLUMN AGAIN. Every one of those is a normal piece of");
    Console.WriteLine("   work done properly. Nobody was careless. THE ROT IS NOT MADE OF");
    Console.WriteLine("   MISTAKES - IT IS MADE OF PROGRESS THAT THE DORMANT BRANCH DID NOT");
    Console.WriteLine("   PARTICIPATE IN.");
    Console.WriteLine();
    Console.WriteLine("   AND MONTH 14 IS THE MOST INSTRUCTIVE ROW. Someone noticed the legacy");
    Console.WriteLine("   test had no corresponding traffic and deleted it as dead code, which");
    Console.WriteLine("   is a defensible call. It removed the last thing that would have caught");
    Console.WriteLine("   month 5 and month 8. A DEAD BRANCH AND ITS TESTS DIE IN THE WRONG");
    Console.WriteLine("   ORDER: the tests go first, because they are the part that costs time.");
    Console.WriteLine();
    Console.WriteLine("   THE COMPOUND EFFECT IS WHAT MAKES THIS EXPENSIVE. Any one of those");
    Console.WriteLine("   changes alone would produce a visible failure - a missing column, a");
    Console.WriteLine("   wrong rate. Together they produce a path that runs cleanly and returns");
    Console.WriteLine("   plausible-looking nonsense.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheRegistry()
{
    Console.WriteLine("4. What an audit of the flags found");
    Console.WriteLine();
    Console.WriteLine("   After the incident somebody listed every flag with the date it was");
    Console.WriteLine("   added and the date it was last changed.");
    Console.WriteLine();

    var today = new DateOnly(2026, 9, 6);

    (string Name, string Kind, DateOnly Added, DateOnly LastChanged, string Owner)[] registry =
    [
        ("LegacyPricingFallback", "release", new(2025, 1, 12), new(2025, 3, 4), "pricing (disbanded)"),
        ("NewCheckout", "release", new(2026, 8, 20), new(2026, 9, 1), "checkout"),
        ("SearchV2Rollout", "release", new(2026, 2, 9), new(2026, 3, 30), "search"),
        ("DisableGatewayRetries", "ops", new(2024, 6, 1), new(2026, 5, 2), "payments"),
        ("PremiumReports", "permission", new(2024, 2, 14), new(2026, 7, 7), "product"),
        ("CheckoutButtonColour", "experiment", new(2025, 11, 3), new(2025, 12, 1), "growth (disbanded)")
    ];

    Console.WriteLine("   flag                     kind         age      unchanged for   verdict");
    Console.WriteLine("   ----                     ----         ---      -------------   -------");

    foreach ((string name, string kind, DateOnly added, DateOnly changed, _) in registry)
    {
        int ageDays = today.DayNumber - added.DayNumber;
        int stillDays = today.DayNumber - changed.DayNumber;

        // A release or experiment toggle that has not moved in months has
        // finished its job, whatever the backlog says.
        string verdict = kind switch
        {
            "release" or "experiment" when stillDays > 90 => "OVERDUE - delete it",
            "release" or "experiment" => "in progress",
            "ops" => "keep, and exercise it",
            _ => "not a feature flag"
        };

        Console.WriteLine($"   {name,-24} {kind,-12} {ageDays / 30,3} mo   {stillDays / 30,10} mo   {verdict}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE COLUMN THAT DOES THE WORK IS 'UNCHANGED FOR', NOT 'AGE'. An ops");
    Console.WriteLine("   toggle two years old is doing its job. A RELEASE TOGGLE THAT HAS NOT");
    Console.WriteLine("   BEEN TOUCHED IN THREE MONTHS HAS FINISHED ITS JOB and is now a");
    Console.WriteLine("   liability, regardless of what any backlog says about it.");
    Console.WriteLine();
    Console.WriteLine("   'OWNER: DISBANDED' APPEARS TWICE, and it is the strongest signal in");
    Console.WriteLine("   the table. A flag whose owning team no longer exists cannot be");
    Console.WriteLine("   evaluated by anyone - nobody can say what it does, whether the branch");
    Console.WriteLine("   still works, or what happens if it moves. Those are the flags that get");
    Console.WriteLine("   flipped at 3am, because nobody is left to say not to.");
    Console.WriteLine();
    Console.WriteLine("   PremiumReports IS IN THE TABLE FOR CONTRAST. It will never be removed,");
    Console.WriteLine("   because it is not a feature flag - it is a pricing rule living in an");
    Console.WriteLine("   operational tool. It will still be there when the flag system is");
    Console.WriteLine("   replaced, and it will have to be migrated by hand.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatToDo()
{
    Console.WriteLine("5. What would have prevented it");
    Console.WriteLine();
    Console.WriteLine("   AN EXPIRY DATE ON EVERY FLAG, ENFORCED BY A TEST. Not a convention, not");
    Console.WriteLine("   a backlog item - a unit test that fails when a flag is past its date.");
    Console.WriteLine("   It is the only mechanism that survives a reorganisation, because it");
    Console.WriteLine("   does not depend on anybody remembering, and the failing build lands on");
    Console.WriteLine("   whoever is working now rather than on whoever left.");
    Console.WriteLine();
    Console.WriteLine("     [Fact]");
    Console.WriteLine("     public void No_release_flag_is_past_its_removal_date()");
    Console.WriteLine("     {");
    Console.WriteLine("         var overdue = FlagRegistry.All");
    Console.WriteLine("             .Where(f => f.Kind == FlagKind.Release)");
    Console.WriteLine("             .Where(f => f.RemoveBy < DateOnly.FromDateTime(DateTime.UtcNow))");
    Console.WriteLine("             .ToList();");
    Console.WriteLine();
    Console.WriteLine("         Assert.True(overdue.Count == 0,");
    Console.WriteLine("             $\"Overdue flags: {string.Join(\", \", overdue.Select(f => f.Name))}\");");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   THE REGISTRY IS THE OTHER HALF, and it belongs in code rather than in a");
    Console.WriteLine("   console: a flag that exists only in an external tool cannot be diffed,");
    Console.WriteLine("   reviewed, or checked by a test. Name, kind, owner, removal date, and");
    Console.WriteLine("   one sentence on what happens when it moves.");
    Console.WriteLine();
    Console.WriteLine("   REMOVE THE BRANCH, NOT ONLY THE FLAG. Deleting the flag and leaving");
    Console.WriteLine("   LegacyPricing() as an unreferenced method is half a cleanup: the dead");
    Console.WriteLine("   code still has to be maintained through every refactor, and somebody");
    Console.WriteLine("   will eventually call it. THE POINT OF REMOVING A FLAG IS TO DELETE ONE");
    Console.WriteLine("   OF THE TWO WORLDS, and if both still compile you have not done it.");
    Console.WriteLine();
    Console.WriteLine("   AND IF A FALLBACK MUST BE KEPT, TREAT IT AS AN OPS TOGGLE AND EXERCISE");
    Console.WriteLine("   IT. Run the legacy path in production on a small percentage, forever,");
    Console.WriteLine("   or in an integration test that runs on every build. AN EMERGENCY");
    Console.WriteLine("   MECHANISM THAT HAS NOT BEEN USED IN TWO YEARS IS NOT AN EMERGENCY");
    Console.WriteLine("   MECHANISM - it is an untested code path with a reassuring name, which");
    Console.WriteLine("   is more dangerous than not having one, because somebody will trust it");
    Console.WriteLine("   at 3am.");
    Console.WriteLine();
    Console.WriteLine("   ONE MORE, CHEAPER THAN ALL OF THEM: MAKE THE FLAG CONSOLE SHOW THE");
    Console.WriteLine("   OWNER, THE AGE AND THE LAST CHANGE next to every switch. The engineer");
    Console.WriteLine("   at 02:48 was making a reasonable decision from the information in front");
    Console.WriteLine("   of them. 'Release toggle, 20 months old, unchanged for 18, owner:");
    Console.WriteLine("   disbanded' would have been a different decision.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// The pricing path written twenty months ago. It reads Amount, a decimal of
// pounds, which is what prices were then.
static long LegacyPricing(Product product) => (long)(product.Amount * 100);

// ---------------------------------------------------------------------------
// The pricing path in use today.
static long NewPricing(Product product) => product.AmountMinor;

// ---------------------------------------------------------------------------
static async Task<string> Price(HttpClient http, string sku)
{
    string body = await http.GetStringAsync($"/v1/price/{sku}");
    int start = body.IndexOf("\"pence\":", StringComparison.Ordinal) + 8;
    string pence = body[start..].TrimEnd('}');

    return $"GBP {long.Parse(pence) / 100.0:0.00}";
}

// ---------------------------------------------------------------------------
// The catalogue row. Amount is the pre-migration field: still present, still
// typed correctly, and nothing has written to it since month five.
record Product(string Sku, string Name, long AmountMinor, decimal Amount);

// ---------------------------------------------------------------------------
sealed class Flags
{
    readonly Dictionary<string, bool> values = [];

    public bool IsEnabled(string name)
    {
        lock (values)
        {
            return values.TryGetValue(name, out bool value) && value;
        }
    }

    public void Set(string name, bool value)
    {
        lock (values)
        {
            values[name] = value;
        }
    }
}
