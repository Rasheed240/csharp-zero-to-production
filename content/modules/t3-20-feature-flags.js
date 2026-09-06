CSPREP.module({
  id: "t3-20-feature-flags",
  minutes: 55,
  updated: "2026-09-06",
  summary: "A release toggle added twenty months ago, flipped at 3am by an engineer who did not write it, priced four thousand orders at GBP 0.00 - and the branch it re-enabled had never changed. Four kinds of flag with four lifetimes; twenty requests taking both code paths at once, measured; a percentage rollout by coin toss against one by hash, where 989 of 1000 users saw both variants in a session; two independent 50% experiments that turn out to be the same experiment; and the removal date enforced by a test, which is the only mechanism that survives a reorganisation.",
  terms: ["feature flag", "release toggle", "experiment toggle", "ops toggle", "permission toggle",
    "kill switch", "percentage rollout", "targeting key", "stickiness", "bucketing",
    "flag registry", "flag expiry", "override list", "flag debt", "dark launch"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Twenty months ago a team migrated its pricing engine carefully, behind a flag, keeping the old
  path as a fallback:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and it was right when it was written"><code>if (flags.IsEnabled("LegacyPricingFallback"))
{
    return LegacyPricing(order);
}

return NewPricing(order);</code></pre>

  <p>The rollout went well. The flag was set to false everywhere and the ticket to remove it went into
  the backlog, where it aged out.</p>

  <p>At 02:48 on a Tuesday, during an unrelated outage, an on-call engineer who joined fourteen months
  ago searched the flag console for anything relevant and found <code>LegacyPricingFallback</code>. The
  name was encouraging. They turned it on; the errors stopped; the incident was declared mitigated.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   product      flag off (new path)   flag on (legacy path)
   -------      -------------------   ---------------------
   SKU-001                GBP 49.99   GBP 0.00
   SKU-002               GBP 129.50   GBP 0.00
   SKU-003                GBP 75.00   GBP 0.00</code></pre>

  <p>Four thousand orders were taken overnight at nothing. The legacy path did not throw, log, or fail
  a health check — it read the field it had always read, and nothing had written to that field since
  the prices moved to integer minor units fifteen months earlier.</p>

  <div class="callout callout--note">
    <h4>The branch did not change. The world around it did.</h4>
    <p>The code compiles. The types match. The tests that exist pass. It is correct code operating on
    an assumption that stopped being true without anybody editing it — and a branch nobody executes
    gets no bug reports, no exceptions, and no attention during any of the migrations that invalidate
    it.</p>
  </div>

  <p>The mitigation worked, by every graph the engineer could see. It cost more than the outage it
  fixed.</p>
</section>

<section id="what-a-flag-is">
  <h2>What a flag is, and the four kinds it might be</h2>

  <p class="define"><span class="define__term">Feature flag</span> A runtime decision about which of
  two code paths executes, made outside the deployment. Also called a toggle or a switch.</p>

  <p class="define"><span class="define__term">Targeting key</span> The identifier a flag decision is
  made about — a user id, a tenant id, a session id. Without one, a flag applies to everyone at
  once.</p>

  <p class="define"><span class="define__term">Dark launch</span> Deploying code that is complete but
  reaches nobody, so that release and deployment become separate events.</p>

  <p class="define"><span class="define__term">Kill switch</span> A flag whose only job is to turn
  something off during an incident. Its defining requirement is that flipping it takes effect
  immediately, without a deployment or a restart.</p>

  <p class="define"><span class="define__term">Flag debt</span> The accumulated cost of flags that
  outlived their purpose: unreachable branches, untested combinations, and decisions nobody alive can
  explain.</p>

  <p class="define"><span class="define__term">Override list</span> Subjects explicitly included in or
  excluded from a flag, evaluated before the percentage. The reason "100%" and "everyone" are different
  numbers.</p>

  <p>The single most useful question to ask when adding a flag is <em>which kind is this</em>, because
  it answers every other question — scope, targeting, ownership, and when it goes away:</p>

  <pre data-lang="console" data-title="01-when-it-is-read.cs output"><code>   kind          lifetime      who flips it     changes while running?
   ----          --------      ------------     ----------------------
   release       days-weeks    the team         rarely
   experiment    weeks         product/data     no, per user
   ops           years         on-call          yes, urgently
   permission    forever       the product      per user, constantly</code></pre>

  <p class="define"><span class="define__term">Release toggle</span> Hides work in progress so it can
  be merged before it is finished. <strong>Temporary by definition</strong> — its removal is part of
  the work, not a follow-up ticket. It exists to be deleted.</p>

  <p class="define"><span class="define__term">Experiment toggle</span> Splits users between variants
  to measure a difference. It must be sticky per user: a user who flips between variants is both a bad
  experience and a corrupted measurement.</p>

  <p class="define"><span class="define__term">Ops toggle</span> A kill switch, a circuit breaker, a
  degradation switch. Long-lived <em>on purpose</em>, flipped at 3am by somebody who did not write it,
  so it must be findable, documented, and live rather than read at startup.</p>

  <p class="define"><span class="define__term">Permission toggle</span> "Premium accounts get advanced
  reports." Not a feature flag at all — a product rule that will outlive everyone currently employed,
  and putting it in a flag system means your pricing model lives in an operational tool.</p>

  <div class="callout callout--gotcha">
    <h4>The confusion that costs the most</h4>
    <p>A release toggle that was never removed becomes an ops toggle that nobody designed. Two years
    later, during an incident, somebody finds it and flips it — and the branch it re-enables has not
    been compiled against the current schema since it was written. That is the opening incident, and
    it starts with a naming decision, not a coding one.</p>
  </div>

  <h3>An analogy, and where it stops working</h3>

  <p>A feature flag is a light switch: the wiring is installed, and flipping the switch decides whether
  the current flows. Cheap to install, cheap to flip, reversible.</p>

  <p>Where it stops is that a light switch has one wire behind it. A flag has <em>two complete
  implementations</em> behind it, both of which have to keep working through every future change to
  everything they touch. The switch is cheap; the second wire is what you pay for, monthly, until
  somebody removes it.</p>
</section>

<section id="when-it-is-read">
  <h2>When the flag is read</h2>

  <p>A flag's value is not a fact, it is a reading taken at a moment. How many moments a request
  contains decides what can go wrong.</p>

  <p>A checkout reads the flag in three places — to pick a pricing rule, to pick a tax rule, and to
  decide what to write to the ledger. Nobody planned that; it grew. Twenty requests are in flight when
  somebody flips the flag:</p>

  <pre data-lang="console" data-title="01-when-it-is-read.cs output"><code>   endpoint     requests in flight when the flag was flipped   inconsistent
   --------     -------------------------------------------   ------------
   /live                                                 20   20
   /snapshot                                             20   0</code></pre>

  <p>Twenty requests took both code paths at once. Each priced the order under the old rules and taxed
  it under the new ones — a combination that was never designed, never tested, and does not correspond
  to either version of the feature.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - three readings, three chances to disagree"><code>app.MapPost("/checkout", async (IFeatureFlags flags) =&gt;
{
    bool pricing = flags.IsEnabled("NewCheckout");

    await gateway.AuthoriseAsync(order);      // 300 ms during which anything can change

    bool tax = flags.IsEnabled("NewCheckout");
    Money total = tax ? NewTax(order) : OldTax(order);

    bool ledger = flags.IsEnabled("NewCheckout");
    await ledger_.WriteAsync(ledger ? NewEntry(order, total) : OldEntry(order, total));

    return Results.Ok(total);
});</code></pre>

  <p>The fix is not a faster flag system. It is to read the flag once, at a defined point, and pass the
  answer down: <strong>a request should decide which version of the world it is in at the moment it
  starts, and stay there.</strong></p>

  <h3>Once per what?</h3>

  <pre data-lang="console" data-title="01-when-it-is-read.cs output"><code>   moment                  per-call   per-request   per-process
   ------                  --------   -----------   -----------
   flag is on              true       true          true
   after flipping it off   false      false         true</code></pre>

  <p>Per-process never changed, which is the row worth stopping on. A flag captured at startup is not a
  flag — it is a deployment-time constant with a flag-shaped API, and turning it off requires a
  restart.</p>

  <div class="callout callout--warn">
    <h4>Which is exactly wrong for a kill switch</h4>
    <p>An ops toggle exists to be used during an incident, which is precisely when restarting is the
    thing you do not want to do. Exercise 2 measures a team watching a kill switch do nothing for
    eleven minutes.</p>
  </div>

  <p>So the scope is a decision per flag rather than a house style. <strong>Per request</strong> is the
  default and right for almost everything. <strong>Per call</strong> is right when you want the newest
  value immediately and there is no unit of work to be consistent within — a background loop checking a
  kill switch between items. <strong>Per process</strong> is right when flipping it needs a restart
  anyway; say so out loud, because everyone else will assume it is live.</p>

  <p>A long-running operation is the hard case. A batch job that reads a flag once may run for an hour
  under a value somebody turned off forty minutes ago; one that reads it per item may process half its
  batch each way. Neither is wrong — the question is whether the batch is one unit of work or many.</p>
</section>

<section id="targeting">
  <h2>Deciding who gets it</h2>

  <p class="define"><span class="define__term">Percentage rollout</span> Enabling a feature for a
  proportion of subjects. Correctly implemented it is a <em>hash</em>, not a draw.</p>

  <p class="define"><span class="define__term">Stickiness</span> The property that the same subject
  always receives the same answer for the same flag.</p>

  <p class="define"><span class="define__term">Bucket</span> The number in <code>[0, 100)</code> that a
  subject hashes to for one flag. A rollout of N% enables every subject whose bucket is below N.</p>

  <p class="define"><span class="define__term">Staged rollout</span> Raising the percentage over time —
  1%, 10%, 50%, 100% — so that a defect is found by a small population rather than by all of them.
  Requires stickiness, or each stage re-draws its participants.</p>

  <p>A 50% rollout, written the obvious way and the correct way. Each of a thousand users makes eight
  requests in a session:</p>

  <pre data-lang="console" data-title="02-targeting.cs output"><code>   how the 50% is decided             users who saw   users who saw BOTH
                                      the feature     within one session
   -----------------------            -------------   ------------------
   Random.Shared.NextDouble() &lt; 0.5             493   989
   stable hash of the user id                   530   0</code></pre>

  <p>Both rolled out to about half the users — the number anybody would check, and the same for both,
  which is why this ships. The second column is the bug: with a random draw, essentially every user saw
  both versions during one session.</p>

  <ul>
    <li><strong>The experiment measures nothing.</strong> Every user is in both arms, so the two groups
    are identical and any difference is noise. The dashboard still produces a number, with confidence
    intervals.</li>
    <li><strong>State crosses the boundary.</strong> If the two paths write different shapes — a
    different idempotency key, a different cart representation — a session that crosses between them
    produces data neither path can read.</li>
    <li><strong>It cannot be reproduced.</strong> A ticket saying "the checkout looked different
    halfway through" is unfalsifiable, because the next person to look gets a fresh coin toss.</li>
  </ul>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>    // The flag name is part of the hash input, so two rollouts at the same
    // percentage pick two different halves.
    static int Bucket(Flag key, string subject)
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{key}:{subject}"));

        return (int)(BitConverter.ToUInt32(hash, 0) % 100);
    }</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the aggregate is right and the experience is not"><code>if (Random.Shared.NextDouble() &lt; 0.5)
{
    return NewCheckout(order);
}

return OldCheckout(order);</code></pre>

  <p>The hash version is sticky because it is a <em>function</em>, not a draw: same user, same flag,
  same answer — on every request, on every instance, in every process, forever, with nothing stored
  anywhere. <strong>The determinism is the storage</strong>, which is why this is the standard
  approach: no assignment table, nothing to replicate, no lookup on the request path.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - every 50% flag picks the same half"><code>static int Bucket(string subject)
{
    // No flag name in the input, so two rollouts at the same percentage
    // select exactly the same subjects.
    byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(subject));

    return (int)(BitConverter.ToUInt32(hash, 0) % 100);
}</code></pre>

  <h3>Two rollouts that turn out to be one rollout</h3>

  <pre data-lang="console" data-title="02-targeting.cs output"><code>   hashing                          in flag A   in flag B   in BOTH   expected
   -------                          ---------   ---------   -------   --------
   hash(user) only                       4986        4986      4986       2500
   hash(flag name + user)                5068        4929      2492       2500</code></pre>

  <p>Without the flag name in the hash, the two experiments are the same experiment. Every user in flag
  A's half is in flag B's half, because the same input produced the same bucket.</p>

  <div class="callout callout--why">
    <h4>The most expensive kind of bug, because it produces answers</h4>
    <p>No error, no exception, no anomaly on any dashboard — two results that look valid and are
    confounded with each other. If the pricing change helped and the checkout change hurt, both
    experiments measured the sum and neither team can tell. The fix is one string concatenation.</p>
    <p>The general principle outlives the fix: <strong>any time you partition the same population twice
    by the same function, you get the same partition.</strong> The same reasoning applies to shard keys,
    cache sharding, and load balancer hashing.</p>
  </div>

  <h3>The rules that sit above the percentage</h3>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   subject          NewCheckout   why
   ---------------- ------------- ---
   user-00005       on            bucket 0 &lt; 10%
   user-00002       off           bucket 30 &gt;= 10%
   staff-001        on            included by list
   tenant-014       off           excluded by list
   user-00042       on            included by list
   user-00099       off           excluded by list</code></pre>

  <p>The order is the design, and it is always the same: <strong>exclusions</strong> first, because an
  exclusion a later rule can override is not an exclusion; then <strong>inclusions</strong>, so a staff
  account can test a feature at 0%; then the <strong>percentage</strong>, for everyone the first two did
  not decide.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>    // The order is the design: exclusions, then inclusions, then the
    // percentage. Anything else makes an exclusion overridable.
    (bool Enabled, string Why) Decide(Flag key, string? subject)
    {
        if (subject is not null &amp;&amp; excluded.TryGetValue(key, out HashSet&lt;string&gt;? off)
            &amp;&amp; off.Contains(subject))
        {
            return (false, "excluded by list");
        }

        if (subject is not null &amp;&amp; included.TryGetValue(key, out HashSet&lt;string&gt;? on)
            &amp;&amp; on.Contains(subject))
        {
            return (true, "included by list");
        }

        int percent;

        lock (rollout)
        {
            percent = rollout[key];
        }

        // A flag with no subject - an ops toggle - is all-or-nothing, and
        // there is nothing to hash.
        if (subject is null)
        {
            return (percent &gt;= 100, percent &gt;= 100 ? "rollout at 100%" : $"rollout at {percent}%");
        }

        int bucket = Bucket(key, subject);

        return bucket &lt; percent
            ? (true, $"bucket {bucket} &lt; {percent}%")
            : (false, $"bucket {bucket} &gt;= {percent}%");
    }

    // The flag name is part of the hash input, so two rollouts at the same</code></pre>

  <p>Notice what the second rule buys: a rollout can start at 0% and still be testable in production.
  That is the single most useful property of a flag system, and the reason "ship it dark" is possible
  at all.</p>

  <p>And every evaluation should be able to say <em>why</em>. It costs almost nothing and it is the
  difference between debugging a rollout in minutes and reasoning about a hash function at 3am.</p>

  <h3>Whether the buckets are even</h3>

  <pre data-lang="console" data-title="02-targeting.cs output"><code>   asked for   actually enabled   error
   ---------   ----------------   -----
          0%              0.00%   +0.00
          1%              1.03%   +0.03
          5%              5.19%   +0.19
         25%             25.31%   +0.31
         50%             50.68%   +0.68
        100%            100.00%   +0.00</code></pre>

  <p>0% enables nobody and 100% enables everyone, which sounds trivial and is the first thing to check
  in an implementation you did not write: a rollout where 100% misses a handful can never be finished,
  and one where 0% catches a few is a kill switch that does not kill.</p>

  <p>The error in the middle is a fraction of a percent at ten thousand users, and it is not random —
  it is <em>fixed</em>. "About 50%" means "a specific 50.68% of these specific users". Which matters at
  small scale: with a hundred users a 5% rollout is somewhere between three and eight of them, decided
  by the hash rather than by you. <strong>If you need exactly N subjects, list them.</strong></p>
</section>

<section id="the-library">
  <h2>What a flag library gives you, and what it does not</h2>

  <p class="define"><span class="define__term"><code>IFeatureManager</code></span> The interface
  <code>Microsoft.FeatureManagement</code> exposes. <code>IsEnabledAsync(name)</code> is the whole API
  for a boolean flag; evaluation is async because a real provider may be remote.</p>

  <p class="define"><span class="define__term">Feature filter</span> A rule the library evaluates from
  configuration rather than from code — a percentage, a time window, a targeted group. Custom rules
  implement <code>IFeatureFilter</code>.</p>

  <p>Flags live under a <code>FeatureManagement</code> section. A plain boolean is the simple form; a
  filter list is the general one:</p>

  <pre data-lang="json" data-title="appsettings.json"><code>{
  "FeatureManagement": {
    "NewCheckout": true,
    "NewPricing": false,
    "BetaBanner": {
      "EnabledFor": [
        { "Name": "Percentage", "Parameters": { "Value": 100 } }
      ]
    }
  }
}</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Registering it and reading a flag"><code>var builder = WebApplication.CreateBuilder(args);

builder.Services.AddFeatureManagement();

var app = builder.Build();

app.MapGet("/checkout", async (IFeatureManager features) =&gt;
    await features.IsEnabledAsync("NewCheckout") ? "new" : "old");

app.Run();</code></pre>

  <pre data-lang="console" data-title="01-when-it-is-read.cs output"><code>   flag                                    result
   ----                                    ------
   NewCheckout, configured true            new
   NewPricing, configured false            old
   BetaBanner, Percentage filter at 100    shown
   NoSuchFlag, absent from configuration   off
   an endpoint gated on a false flag       404

   flags the library knows about   BetaBanner, NewCheckout, NewPricing</code></pre>

  <p>Two things there are worth having. <strong>Filters are configuration, not code</strong>, so
  changing a rollout does not touch the application — and a custom <code>IFeatureFilter</code> is where
  a real targeting key belongs. And <strong><code>GetFeatureNamesAsync</code> enumerates what
  exists</strong>, which is the closest the library comes to a registry: a startup check that every
  configured flag appears in your own registry, and vice versa, catches both a flag nobody documented
  and a documented flag nobody configured.</p>

  <div class="callout callout--warn">
    <h4>And the things it does not give you, which are the ones this module is about</h4>
    <ul>
      <li><strong>A missing flag is false, silently</strong> — the same default and the same failure
      mode as reading a raw configuration key. See the <code>NoSuchFlag</code> row.</li>
      <li><strong>The names are still strings at the call site</strong>, so a typo is still a silent
      false. A typed accessor over the top is still yours to write.</li>
      <li><strong>There is no owner, no removal date and no expiry test.</strong> Nothing in any flag
      library will delete a flag for you, and flag debt is the expensive problem.</li>
      <li><strong>Evaluation is async</strong> — the right signature for a possibly-remote provider,
      and it means a flag check inside a tight synchronous loop is not something you retrofit.</li>
    </ul>
  </div>

  <p>So the library is worth using and it is not the decision. The decisions are which kind of flag
  this is, what scope it is read at, what the targeting key is, and when it goes away — and no library
  makes any of them for you.</p>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <p>The registry is the part most teams do not have, and it belongs in code rather than in a console —
  a flag that exists only in an external tool cannot be diffed, reviewed, or checked by a test:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// ---------------------------------------------------------------------------
// The registry. Everything a person needs in order to decide whether to touch
// a flag at 3am, in the repository rather than in a console.
static class FlagRegistry
{
    public static readonly FlagDefinition[] All =
    [
        new(Flag.NewCheckout, "NewCheckout", FlagKind.Release, "checkout",
            new DateOnly(2026, 11, 1),
            "On: the rewritten checkout. Off: the 2024 checkout. Both write the same ledger entries."),

        new(Flag.UseBackupGateway, "UseBackupGateway", FlagKind.Ops, "payments",
            null,
            "On: payments route to the backup provider, which does not support refunds. Safe to flip."),

        new(Flag.PremiumReports, "PremiumReports", FlagKind.Permission, "product",
            null,
            "On: advanced reporting. This is a pricing rule, not a rollout.")
    ];

    public static FlagDefinition Get(Flag key) =&gt; All.First(f =&gt; f.Key == key);
}</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   flag                   kind        owner        remove by    status
   ---------------------- ----------- ------------ ------------ ------
   NewCheckout            Release     checkout     2026-11-01   on time
   UseBackupGateway       Ops         payments     -            permanent
   PremiumReports         Permission  product      -            permanent

   THE TEST THAT RUNS ON EVERY BUILD

     overdue release and experiment flags   0
     the build would                        pass</code></pre>

  <p>The state it evaluates against holds the rollout percentages and the two override lists, and the order it applies them is the design:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// above them.
sealed class FlagState
{
    readonly Dictionary&lt;Flag, int&gt; rollout = new()
    {
        [Flag.NewCheckout] = 10,
        [Flag.UseBackupGateway] = 0,
        [Flag.PremiumReports] = 0
    };

    readonly Dictionary&lt;Flag, HashSet&lt;string&gt;&gt; included = new()
    {
        [Flag.NewCheckout] = ["staff-001", "user-00042"]
    };

    readonly Dictionary&lt;Flag, HashSet&lt;string&gt;&gt; excluded = new()
    {
        [Flag.NewCheckout] = ["tenant-014", "user-00099"]
    };

    public void SetRollout(Flag key, int percent)
    {
        lock (rollout)
        {
            rollout[key] = percent;
        }
    }

    public bool IsEnabled(Flag key, string? subject) =&gt; Decide(key, subject).Enabled;

    public string Explain(Flag key, string? subject) =&gt; Decide(key, subject).Why;</code></pre>

  <p>That test is the mechanism this whole module points at:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - the only thing that survives a reorganisation"><code>[Fact]
public void No_release_flag_is_past_its_removal_date()
{
    var overdue = FlagRegistry.All
        .Where(f =&gt; f.Kind is FlagKind.Release or FlagKind.Experiment)
        .Where(f =&gt; f.RemoveBy is { } by &amp;&amp; by &lt; DateOnly.FromDateTime(DateTime.UtcNow))
        .ToList();

    Assert.True(overdue.Count == 0,
        $"Overdue flags: {string.Join(", ", overdue.Select(f =&gt; f.Name))}");
}</code></pre>

  <p>Not a convention and not a backlog item — a failing build. It does not depend on anybody
  remembering, and the failure lands on whoever is working now rather than on whoever left.</p>

  <p>The rest of the system follows from the kinds. Release flags are snapshotted per request — one
  reading, taken when the scope is created, so every read inside the request agrees:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// ---------------------------------------------------------------------------
// One reading of the release flags, taken when the request scope is created.
// Every read within the request agrees, whatever happens to the flag meanwhile.
sealed class FlagSnapshot(FlagState state, IHttpContextAccessor accessor)
{
    readonly Dictionary&lt;Flag, bool&gt; values = FlagRegistry.All
        .Where(f =&gt; f.Kind is FlagKind.Release or FlagKind.Experiment)
        .ToDictionary(
            f =&gt; f.Key,
            f =&gt; state.IsEnabled(f.Key, accessor.HttpContext?.Request.Headers["X-Subject"].ToString()));

    public bool IsEnabled(Flag key) =&gt; values.TryGetValue(key, out bool value) &amp;&amp; value;
}</code></pre>

  <p>The ops toggle is read live, and every evaluation explains itself:</p>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   THE OPS TOGGLE, READ LIVE

     before   {"gateway":"primary"}
     after    {"gateway":"backup"}   (no restart)

   THE ENDPOINT THAT ANSWERS SUPPORT TICKETS

     GET /internal/flags/tenant-014
       "flag":"NewCheckout","enabled":false,"why":"excluded by list"
       "flag":"UseBackupGateway","enabled":true,"why":"bucket 90 &lt; 100%"
       "flag":"PremiumReports","enabled":false,"why":"bucket 10 &gt;= 0%"</code></pre>

  <div class="callout callout--note">
    <h4>What is still not automated</h4>
    <p>Deleting the branch. The test catches an overdue flag; a human still has to remove one of the
    two worlds. The point of removing a flag is that only one path remains — <strong>if both still
    compile, the cleanup has not happened</strong>, and the branch nobody runs will keep rotting whether
    or not a flag still points at it.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>The flag that was never removed</h3>

  <p>The opening incident. What makes it expensive is that the rot is not made of mistakes — it is made
  of progress the dormant branch did not participate in:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   month   change                                     effect on the legacy branch
   -----   ------                                     ---------------------------
       0   flag added, both paths live                none - both are exercised
       2   rollout completes, flag set to false       the branch stops executing
       5   prices move to integer minor units         reads a field nothing fills
       8   VAT rules change for digital goods         the branch keeps the old rate
      11   currency support added                     the branch assumes GBP
      14   its integration test deleted as 'dead'     nothing exercises it at all
      20   flipped on during an incident              all of the above, at once</code></pre>

  <p>Month 14 is the most instructive row. Someone noticed the legacy test had no corresponding traffic
  and deleted it as dead code, which is a defensible call. It removed the last thing that would have
  caught months 5 and 8. <strong>A dead branch and its tests die in the wrong order</strong> — the tests
  go first, because they are the part that costs time.</p>

  <p>Any one of those changes alone would produce a visible failure. Together they produce a path that
  runs cleanly and returns plausible-looking nonsense.</p>

  <h3>Reading the flag more than once per unit of work</h3>

  <p>Measured above: twenty requests taking both code paths at once. The window is narrow and it opens
  every time anyone touches a flag.</p>

  <h3>Resolving the flag at startup</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - looks like good design, and cannot be flipped"><code>builder.Services.AddSingleton&lt;IGateway&gt;(_ =&gt; flags.IsEnabled("UseBackupGateway")
    ? new BackupGateway()
    : new PrimaryGateway());</code></pre>

  <p>The flag is read in one place, the rest of the code depends on an interface, and nothing
  downstream knows a flag exists — every one of which is a virtue in other contexts. What it costs is
  the only property that mattered: the switch needs a restart.</p>

  <h3>A rollout by coin toss</h3>

  <p>989 of 1000 users saw both variants in one session. The overall percentage looks correct, which is
  the number anybody checks.</p>

  <h3>Hashing without the flag name</h3>

  <p>Two independent experiments become one, silently, producing confounded results that look valid.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - half the population shares one key"><code>// user.Id is null for anonymous visitors, so every one of them hashes
// to the same bucket and gets the same answer.
bool enabled = flags.IsEnabled(Flag.NewLanding, subject: user?.Id);</code></pre>

  <h3>A targeting key that is sometimes null</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   group                 visitors   in the variant   share
   -----                 --------   --------------   -----
   signed in                  500              243   48.6%
   signed out                 500                0    0.0%

   the bucket every signed-out visitor lands in   88</code></pre>

  <p>Every signed-out visitor has the same key, so they all hash to the same bucket. A hash of a
  constant is a constant — the code is correct and half the population has no identity.</p>

  <h3>String keys at the call site</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   how it was set                             GetValue&lt;bool&gt; returns
   --------------                             ----------------------
   appsettings, colon separator               True
   environment variable, double underscore    True
   environment variable, single underscore    False
   environment variable, uppercase            True
   value with a capital T                     True
   value as 1                                 InvalidOperationException
   value as yes                               InvalidOperationException</code></pre>

  <p>A single underscore is not a separator, and the resulting silence looks identical to "the flag is
  deliberately off". Nobody investigates a feature not appearing when its flag is supposed to be
  off.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - a pricing rule in an operational tool"><code>// This will outlive the flag system, the team, and probably the company.
if (await features.IsEnabledAsync("PremiumReports"))
{
    return await BuildAdvancedReport(account);
}</code></pre>

  <h3>Treating a permission as a feature flag</h3>

  <p>A pricing rule in an operational tool. It will still be there when the flag system is replaced,
  and it will have to be migrated by hand.</p>

  <h3>Removing a flag without clearing its overrides</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   state                                    tenants with the feature
   -----                                    ------------------------
   flag at 100%, exclusions in place        197 of 200
   flag deleted, branch removed             200 of 200</code></pre>

  <p>"100%" was never "everyone" — the percentage is the last rule, and exclusions sit above it. The
  dashboard reports the rollout percentage, which is an <em>input</em>, not the proportion of subjects
  for whom the flag evaluates true, which is an <em>output</em>.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>Ask the system what it evaluated, and why.</strong> If your flag layer cannot answer
    "why did this subject get this answer", build that before anything else — it turns every future
    question into a lookup.</li>
    <li><strong>Log every flag's resolved value at startup.</strong> One line of output settles the
    entire class of separator and value-parsing failures above, permanently.</li>
    <li><strong>Count the distinct targeting keys.</strong> If it is much smaller than your subject
    count, some population is sharing a key and every one of them is getting the same answer.</li>
    <li><strong>Check whether the flag is read more than once per request.</strong> Grep for the flag
    name; more than one call site in a request path is the inconsistency bug waiting for a flip.</li>
    <li><strong>Before flipping anything old, ask when the branch last ran.</strong> If the answer is
    "not since the rollout", you are about to execute code that has not been exercised against the
    current schema, the current rates, or the current data.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>Age and last-changed date per flag, shown in the console next to the switch.</strong>
      The engineer at 02:48 was making a reasonable decision from the information in front of them.
      "Release toggle, 20 months old, unchanged for 18, owner: disbanded" is a different decision.</li>
      <li><strong>Flags whose owning team no longer exists.</strong> The strongest signal in any flag
      audit. Nobody can say what it does or what happens if it moves, which is exactly why it gets
      flipped.</li>
      <li><strong>Subjects who saw more than one variant in a session.</strong> Should be zero. If it
      is not, your rollout is not sticky.</li>
      <li><strong>The evaluated-true proportion, not the configured percentage.</strong> Those two
      numbers differ by exactly the size of your override lists, and most consoles show the first
      one.</li>
    </ul>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"A feature flag is a boolean in configuration"</h4>
    <p>That is a configuration setting you can change without a deploy — useful, and much less than a
    flag. It has no targeting, no stickiness, no owner, no expiry, and no way to enable a feature for
    one customer.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"We will remove it after the rollout"</h4>
    <p>Measured in the incident: twenty months, a disbanded team, and a branch that priced everything
    at zero. Intent is not a mechanism. A date enforced by a test is.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A percentage rollout is a random sample"</h4>
    <p>It must be a deterministic function of the subject, or users flip between variants on every
    request. A random draw produces the right aggregate and the wrong experience.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"The old path is our safety net"</h4>
    <p>Only if it runs. An emergency mechanism unused for two years is an untested code path with a
    reassuring name — more dangerous than not having one, because somebody will trust it at 3am.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Reading the flag where you need it is simplest"</h4>
    <p>It is, and it means one request can take both code paths. Read once per unit of work and pass
    the answer down.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A flag at 100% is on for everyone"</h4>
    <p>The percentage is the last rule in the evaluation. Exclusions sit above it, which is the correct
    design and the reason deleting a "fully rolled out" flag can change behaviour.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Deleting the flag is the cleanup"</h4>
    <p>Deleting the flag and leaving the old method unreferenced is half a cleanup. The dead code still
    has to be maintained through every refactor, and somebody will eventually call it.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Every flag is a permanent tax paid in exchange for a temporary option</h4>
    <p>The option is real and valuable: deploy without releasing, roll out gradually, turn something
    off in seconds. The tax is that two implementations must both keep working through every future
    change to everything they touch — and it is paid monthly, by people who did not choose it, until
    somebody deletes one of them.</p>
  </div>

  <p>The second reason is that flags are where combinatorics arrive quietly. Ten independent boolean
  flags describe 1,024 possible configurations of your system, and your test suite exercises perhaps
  two of them. Nobody decides to support a thousand configurations; it happens one reasonable flag at a
  time, and the ones that break are always combinations nobody imagined.</p>

  <p>The third is the shape of the opening incident, which recurs far beyond flags: <strong>code that
  does not execute does not stay correct.</strong> The same is true of a disaster-recovery procedure
  nobody rehearses, a fallback path nobody exercises, and a runbook nobody follows. The value of an
  emergency mechanism is not that it exists but that it works, and the only evidence for the second is
  having run it recently.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A flag is read with <code>configuration.GetValue&lt;bool&gt;("Features:NewCheckout")</code>. It
    works on every developer machine, where it is set in <code>appsettings.Development.json</code>. In
    production, where it is set by environment variable, it is never on. Both places set it to
    true.</p>
    <p>What is different?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   how it was set                             GetValue&lt;bool&gt; returns
   --------------                             ----------------------
   appsettings, colon separator               True
   environment variable, double underscore    True
   environment variable, single underscore    False
   environment variable, uppercase            True
   value with a capital T                     True
   value as 1                                 InvalidOperationException
   value as yes                               InvalidOperationException
   value as on                                InvalidOperationException</code></pre>
        <p>Two separate traps, and the exercise contains both.</p>
        <p><strong>The separator.</strong> Environment variables cannot contain a colon on every
        platform, so the environment provider maps a <em>double underscore</em> onto the colon. A single
        underscore is not a separator — it produces a key called <code>Features_NewCheckout</code>,
        which nothing reads. Case does not matter; the number of underscores does.</p>
        <p><strong>The value.</strong> <code>true</code> and <code>True</code> both bind.
        <code>1</code>, <code>yes</code> and <code>on</code> all throw — the better failure, because it
        is loud, and still the wrong place for it: the exception surfaces at the read, inside a handler,
        on the first request that reaches that line. Not at startup, where a bad value belongs.</p>
        <p>The separator failure is the dangerous one, because it is silent and looks identical to "the
        flag is deliberately off".</p>
        <p>The fix is to stop using raw strings at the call site. One typed accessor, with the key
        written once, turns a silent false into a compile error — and gives you a place to log every
        flag's resolved value at startup.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A payment gateway starts failing. The team has a kill switch that routes payments to a backup
    provider. On-call flips it and watches the error rate. Nothing changes for eleven minutes, until
    somebody restarts the service. The flag value was correct in the console the whole time.</p>
    <p>Why did nothing happen?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   moment                        resolved at startup   chosen per request
   ------                        -------------------   ------------------
   before the incident           primary               primary
   after flipping the switch     primary               backup</code></pre>
        <p>The flag was read once, at startup, to choose which object to register. After that the
        container holds a <code>PrimaryGateway</code> and no amount of flipping changes which object it
        holds. The eleven minutes ended when the restart re-ran the factory.</p>
        <p>The registration looks like good design, which is why it survives review: the flag is read in
        one place, the rest of the code depends on an interface, and nothing downstream knows a flag
        exists. Every one of those is a virtue elsewhere.</p>
        <p>What it costs is the only property that mattered — <strong>a kill switch exists to be used
        during an incident, which is exactly when restarting is the thing you do not want to do.</strong>
        A flag that requires a restart is a configuration setting; calling it a kill switch is the
        bug.</p>
        <p>And this is in tension with "snapshot per request", deliberately. Per-request is right for a
        release toggle, where consistency within a unit of work matters more than latency. An ops toggle
        wants the newest value it can get. <strong>The scope is a property of the flag's kind</strong>,
        and "always snapshot" is as wrong as "never snapshot".</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>A 50% experiment on a new landing page. The results are clean for signed-in users. For
    signed-out visitors, 100% of them are in the control group — the variant never shows. The targeting
    code is one line and has no branch in it.</p>
    <p>What is happening?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   group                 visitors   in the variant   share
   -----                 --------   --------------   -----
   signed in                  500              243   48.6%
   signed out                 500                0    0.0%

   the bucket every signed-out visitor lands in   88</code></pre>
        <p>Every signed-out visitor has the same targeting key — the empty one — so they all hash to
        the same bucket and all receive the same answer. Whether that answer is "variant" or "control"
        is decided by one hash of one string.</p>
        <p>There is no branch in the code because the code is correct. A hash of a constant is a
        constant. The defect is that half the population has no identity, and nobody noticed because
        the experiment was designed thinking about users rather than about visitors.</p>
        <p>It could have been worse in a quieter way. Had that bucket landed under 50, every signed-out
        visitor would have got the variant, the overall split would still have looked like 50%, and the
        experiment would have compared "signed-in half" against "signed-in half plus all anonymous
        traffic" — <strong>the same bug producing a confident and completely wrong result</strong>
        rather than an obvious one.</p>
        <p>The fix is a targeting key that always exists: a session id or first-party cookie set on
        first visit, falling back to the user id once they sign in. Which raises the question key
        changes always raise — a visitor who signs in mid-session changes bucket, so decide deliberately
        whether that is acceptable.</p>
        <p>The check that finds this class of bug in seconds: count the distinct targeting keys. If it
        is much smaller than your visitor count, some population is sharing one.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A rollout reaches 100%. The team does the right thing: deletes the flag, deletes the old branch,
    ships the cleanup. Three enterprise customers immediately report that a feature they had switched
    off is back. The rollout really was at 100%.</p>
    <p>How were those three not already on it?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   state                                    tenants with the feature
   -----                                    ------------------------
   flag at 100%, exclusions in place        197 of 200
   flag deleted, branch removed             200 of 200

   tenants whose behaviour changed at cleanup   3
   which ones                                   tenant-014, tenant-088, tenant-137</code></pre>
        <p>"100%" was never "everyone". The percentage is the last rule in the evaluation and the
        exclusion list sits above it — which is exactly the design you want, because an exclusion a
        later rule can override is not an exclusion. So "100%" means "everyone the earlier rules did not
        already decide".</p>
        <p>The dashboard said 100% and the dashboard was right. It was reporting the rollout
        percentage, which is an <em>input</em> to the evaluation, not the proportion of tenants for whom
        the flag evaluates true, which is an <em>output</em>. Those two numbers differ by exactly the
        size of your override lists, and almost every flag console shows the first one.</p>
        <p>So removing a flag is not always a no-op, and the test is specific: does any override still
        exist? Each one is a customer with a reason — usually a reason recorded in a support ticket
        nobody involved in the cleanup has read.</p>
        <p>What to do instead, in order: <strong>clear the overrides first</strong>, as a separate change
        where each removal is a decision about one customer; <strong>wait</strong>, with the flag at 100%
        and no overrides, to prove the rollout is genuinely complete; <strong>then</strong> delete the
        flag and the branch, which is now provably a no-op.</p>
        <p>And the deeper lesson is about what the overrides were doing. Three customers had a durable
        preference recorded in a temporary mechanism. <strong>A release toggle's override list is not a
        place to store customer preferences</strong> — the moment a preference needs to outlive the
        rollout, it is a product feature and belongs in the product.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Name the four kinds of flag and say which one is temporary by definition.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Release, experiment, ops and permission. The release toggle is
        temporary by definition — its removal is part of the work. The permission toggle is not really
        a feature flag at all.</p></div>
      </details></li>

    <li><p>Why can one request take both code paths, and what fixes it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A flag can change at any moment and the request reads it at more
        than one moment. Read it once, at a defined point, and pass the answer down — the request
        decides which version of the world it is in and stays there.</p></div>
      </details></li>

    <li><p>What is wrong with resolving a flag in a DI factory at startup?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The container holds the object that was chosen then, so flipping
        the flag changes nothing until a restart. For a kill switch that is fatal, because an incident
        is exactly when you do not want to restart.</p></div>
      </details></li>

    <li><p>Why must a percentage rollout be a hash rather than a random draw?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A draw is re-taken on every request, so users flip between
        variants — 989 of 1000 saw both in one session. A hash is a function: same subject, same flag,
        same answer, everywhere, with nothing stored.</p></div>
      </details></li>

    <li><p>Why does the flag name have to be part of the hash input?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Otherwise every rollout at the same percentage picks the same
        subjects, so two independent experiments become one and their results are confounded — with no
        error anywhere.</p></div>
      </details></li>

    <li><p>State the evaluation order and why it is that way round.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Exclusions, then inclusions, then the percentage. An exclusion a
        later rule can override is not an exclusion; and inclusions above the percentage are what let a
        staff account test a feature at 0%.</p></div>
      </details></li>

    <li><p>What happens to visitors who have no targeting key?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>They share one key, hash to one bucket, and all get the same
        answer. A hash of a constant is a constant. The check is to count distinct targeting keys
        against the visitor count.</p></div>
      </details></li>

    <li><p>Why did the twenty-month-old fallback branch return zero prices without failing?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It read a field that still existed and still typed correctly, and
        that nothing had written to since prices moved to integer minor units. The branch never
        changed; the world around it did.</p></div>
      </details></li>

    <li><p>Why is an expiry date enforced by a test better than a backlog ticket?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It does not depend on anybody remembering, it survives
        reorganisations, and the failure lands on whoever is working now rather than on whoever
        left.</p></div>
      </details></li>

    <li><p>Why can deleting a flag that is "at 100%" change behaviour?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The percentage is the last rule; exclusions sit above it. Anyone
        on an override list was not covered by the 100%, and deleting the flag moves exactly those
        subjects.</p></div>
      </details></li>

    <li><p>What is left undone when you delete a flag but leave both methods compiling?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The cleanup. The point of removing a flag is that only one path
        remains; unreferenced dead code still has to be maintained through every refactor, and somebody
        will eventually call it.</p></div>
      </details></li>

    <li><p>Why is an emergency mechanism nobody has exercised in two years worse than not having
      one?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Because somebody will trust it. Code that does not execute does
        not stay correct, and a reassuring name on an untested path invites exactly the decision that
        was made at 02:48.</p></div>
      </details></li>
  </ol>
</section>
`
});
