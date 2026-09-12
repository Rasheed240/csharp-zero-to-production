CSPREP.module({
  id: "t3-26-webhooks-outbound",
  minutes: 60,
  updated: "2026-09-08",
  summary: "One customer's endpoint slowed from 5 ms to 400 ms and every other customer stopped receiving webhooks - while the delivery success rate stayed at 100% the whole time. Measured: a shared queue costing healthy consumers 1,314 ms against 152 ms once separated; a consumer verifying the wrong bytes and passing anyway; a captured delivery replayable forever without a timestamp; a customer's webhook URL reaching an internal admin endpoint through a redirect; and a refund that un-refunded itself because two events arrived backwards.",
  terms: ["webhook", "HMAC", "signature", "replay window", "constant-time comparison", "secret rotation",
    "at-least-once", "idempotency key", "exponential backoff", "jitter", "head-of-line blocking",
    "delivery log", "outbox", "SSRF", "event version"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>Every previous module in this track has been about answering a request. This one is about the
  opposite: something happened in your system, and somebody else's system needs to know. You are the
  client now, and the server belongs to a customer.</p>

  <p>At 14:40 one Ledger customer's endpoint slowed from 5 ms to 400 ms. Not down — slow. By 14:52 three
  unrelated customers were reporting webhooks arriving late. At 15:10 the delivery success rate was still
  100%. At 15:20 the oldest undelivered event was twenty-eight minutes old.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   events delivered                        60 of 60
   deliveries that failed                  0
   healthy consumers, worst wait             1314 ms
   healthy consumers, average wait            736 ms
   the slow consumer, worst wait             1267 ms
   whole batch                               1672 ms</code></pre>

  <p>The same 60 events, the same endpoints, one thing changed:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   healthy consumers, worst wait              152 ms
   healthy consumers, average wait             81 ms
   the slow consumer, worst wait             3690 ms
   whole batch                               4105 ms</code></pre>

  <div class="callout callout--note">
    <h4>Every delivery succeeded in both runs</h4>
    <p>That is what the dashboard was showing, and it was true. The failure was not in the deliveries, it
    was in the <em>waiting</em> — and nothing was measuring that.</p>
  </div>
</section>

<section id="what-it-is">
  <h2>What a webhook is, and what changes</h2>

  <p class="define"><span class="define__term">Webhook</span> An HTTP request your system sends to a URL
  somebody else configured, when something happens that they asked to be told about.</p>

  <p>Mechanically it is one <code>POST</code>. Everything hard about it comes from who is on each
  end.</p>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>     consumer received  {"id":"evt_01HQ8","type":"payment.captured","createdAt":"2026-09-08T10:14:02Z",...}
     signature header   v1=e5b0d49ff48753463f9537ecf65b54e3e760557d48bf31f8e13df95b19fa986d
     consumer computed  v1=e5b0d49ff48753463f9537ecf65b54e3e760557d48bf31f8e13df95b19fa986d
     verdict            accepted
     delivery status    200 OK</code></pre>

  <h3>Four things are already different from calling an API</h3>

  <p><strong>The direction is reversed, and so is the trust.</strong> You are the client and somebody
  else is the server — a server you do not run, cannot test against and cannot fix. Every assumption
  about availability, latency and correctness that holds for your own services is gone.</p>

  <p><strong>The consumer cannot authenticate you any other way.</strong> There is no login, no session,
  no mutual TLS by default. The request arrives at a public URL that anybody can find, so the signature
  is the only thing separating your event from one an attacker sent.</p>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>     consumer received  {..."amountMinor":1,...}
     signature header   v1=e5b0d49ff48753463f9537ecf65b54e3e760557d48bf31f8e13df95b19fa986d
     consumer computed  v1=4f20a3ec1b066648099c4a6ebd3dac4085bd55780549863fe0436b7487f01e74
     verdict            REJECTED
     delivery status    401 Unauthorized</code></pre>

  <p><strong>The URL belongs to somebody else.</strong> They chose it, they can change it, and they can
  point it anywhere — including at an address inside your own network. That has its own section.</p>

  <p><strong>And nobody is waiting.</strong> A failed API call has a user in front of it who will see an
  error and try again. A failed webhook has nobody: the event happened, you owe them a notification, and
  the only thing that will ever deliver it is your own retry policy.</p>

  <div class="callout callout--why">
    <h4>Which is why this module is about delivery rather than about requests</h4>
    <p>Sending the <code>POST</code> is four lines. The system around it — an outbox, a queue per
    consumer, a schedule, a log, a way to replay, a way to disable — is the actual work, and it is what
    gets built by accident one requirement at a time.</p>
  </div>

  <h3>An analogy, and where it stops working</h3>

  <p>A webhook is registered post. You are delivering something the recipient asked for, to an address
  they gave you, and you keep a record of every attempt.</p>

  <p>Where it stops is that the post office can give up. If nobody is in after three attempts the letter
  goes back and the sender is told. A webhook has no such reverse channel: <strong>from the consumer's
  side, "we retried for a day and gave up" and "nothing happened" look identical</strong> — both are
  silence.</p>
</section>

<section id="signing">
  <h2>Signing: what is actually being signed</h2>

  <p class="define"><span class="define__term">HMAC</span> A keyed hash. Given a secret and a message it
  produces a fixed-length value that cannot be produced by anyone without the secret, and that changes
  completely if any byte of the message changes.</p>

  <p class="define"><span class="define__term">Signature</span> The HMAC of the timestamp and the request
  body, sent in a header. It proves the request came from someone holding the secret.</p>

  <pre data-lang="csharp" data-net="10" data-title="The whole of the signing side"><code>static string Sign(string secret, long timestamp, string body)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));

    byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{body}"));

    return "v1=" + Convert.ToHexStringLower(hash);
}</code></pre>

  <h3>It is over bytes, and the wrong bytes pass</h3>

  <pre data-lang="console" data-title="01-signing.cs output"><code>   what the consumer verified against   bytes   signature matches?
   ----------------------------------   -----   ------------------
   the raw request body                    94   yes
   a JsonElement round trip                94   yes
   a typed model round trip                94   NO
   the body it pretty-printed             129   NO</code></pre>

  <div class="callout callout--gotcha">
    <h4>The second row is the dangerous one, and it passed</h4>
    <p>Round-tripping through <code>JsonElement</code> happened to reproduce the bytes exactly, because
    System.Text.Json preserves property order and writes compactly. <strong>A consumer written the wrong
    way can pass every test</strong> — until the producer adds a field with a character that escapes
    differently, changes a serialiser option, or sends a number that round-trips to a different text
    form.</p>
  </div>

  <p>The third row is the same mistake with the mask off — bind to a class and the property names come
  back in the class's casing, so nothing matches. That one fails immediately, which makes it the lucky
  version.</p>

  <p>So the consumer must verify against the raw request body before any parsing, and the producer must
  say so in the documentation, because the natural way to write the consumer is the broken way:</p>

  <pre data-lang="csharp" data-net="10" data-title="The consumer side, done correctly"><code>app.MapPost("/hooks/ledger", async (HttpRequest request) =&gt;
{
    // The RAW bytes. Not a bound model, not a re-serialised object.
    using var reader = new StreamReader(request.Body);

    string body = await reader.ReadToEndAsync();

    string timestamp = request.Headers["x-ledger-timestamp"]!;
    string signature = request.Headers["x-ledger-signature"]!;

    bool valid = CryptographicOperations.FixedTimeEquals(
        Encoding.UTF8.GetBytes(signature),
        Encoding.UTF8.GetBytes(Sign(Secret, timestamp, body)));

    return valid ? Results.Ok() : Results.Unauthorized();
});</code></pre>

  <p>And the producer must serialise once. Signing an object and then serialising it again for the wire
  is the identical bug from the other side, failing the same way: intermittently, long after release.</p>

  <h3>The timestamp, which is not decoration</h3>

  <p class="define"><span class="define__term">Replay window</span> A tolerance the consumer enforces
  between the signed timestamp and its own clock. Outside it, a correctly-signed request is rejected.</p>

  <pre data-lang="console" data-title="01-signing.cs output"><code>   an attacker replays a delivery they captured 15 minutes ago:

   scheme                              replay accepted?
   ------                              ----------------
   signature over the body only        YES - it is still a valid signature
   signature over timestamp and body   no - outside the 5-minute window
   the same scheme, delivered on time  yes, accepted</code></pre>

  <p><strong>A signature proves authorship, not freshness.</strong> Without a timestamp inside the signed
  material, a captured delivery is a valid delivery forever — anybody who logs a request body, or reads
  one out of a proxy cache, can replay <code>payment.captured</code> as many times as they like.</p>

  <p>The timestamp has to be <em>inside</em> the signature, not beside it: a timestamp header that is not
  signed is a header the attacker edits. And the tolerance is a real trade-off — too tight and clock skew
  on the consumer's machine rejects honest deliveries, too loose and the replay window is wide.</p>

  <div class="callout callout--gotcha">
    <h4>Which means a retry must be re-signed, not resent</h4>
    <p>A stored, fully-built HTTP request is a record with an expiry date on it. Exercise 1 is the ticket
    this produces, and it only appears after a long outage — exactly when the retry machinery matters
    most.</p>
  </div>

  <h3>Constant-time comparison</h3>

  <p class="define"><span class="define__term">Constant-time comparison</span> A comparison that examines
  every byte regardless of where the first difference is, so that how long it took reveals nothing about
  how much of the guess was right.</p>

  <pre data-lang="console" data-title="01-signing.cs output"><code>   2,000,000 comparisons of a 67-character signature

   comparison                 mismatch at byte 3   mismatch at the last byte
   ----------                 ------------------   -------------------------
   string ==                                9 ms                       31 ms
   FixedTimeEquals                        652 ms                      627 ms

   ratio, string ==                      3.45x
   ratio, FixedTimeEquals                0.96x</code></pre>

  <p>An ordinary comparison returns as soon as it finds a difference, so how long it takes tells an
  attacker how much of their guess was right. Guess one byte at a time and a 32-byte signature costs
  8,192 attempts rather than 2<sup>256</sup>.</p>

  <p>Across four runs the <code>string ==</code> ratio came out between 1.67x and 3.45x and
  <code>FixedTimeEquals</code> between 0.83x and 1.10x — a signal that is always there for one and never
  for the other. In absolute terms the gap is a few nanoseconds per comparison, measured in-process with
  no network in the way, which is the most favourable case an attacker could hope for.</p>

  <p>That is the honest position: a remote timing attack across the internet is hard and sometimes
  impractical. It is still not a defence, because the attacker chooses how many samples to average and
  how patient to be, and you do not get to know how quiet their network path is.</p>

  <h3>Rotating the secret</h3>

  <pre data-lang="console" data-title="01-signing.cs output"><code>   x-ledger-signature: v1=10ebba2df1238f77...,v1=e84303da5aa87eb3...

   consumer holding      accepts?
   ----------------      --------
   only the old secret   yes
   only the new secret   yes
   an unrelated secret   no</code></pre>

  <p>A secret cannot be rotated in one step, because the producer and every consumer would have to change
  at the same instant. Sending both signatures during the overlap lets each consumer verify against
  whichever one it holds and rotate on its own schedule.</p>

  <p>The same mechanism carries algorithm changes, which is what the <code>v1=</code> prefix is for. A
  <code>v2=</code> can appear alongside it and consumers that do not understand v2 ignore it — so a
  comma-separated list of versioned signatures is not decoration, it is the upgrade path.</p>
</section>

<section id="retries">
  <h2>Retries, and what they commit you to</h2>

  <p class="define"><span class="define__term">Exponential backoff</span> Doubling the wait between
  attempts, so early failures are retried quickly and a long outage is not hammered.</p>

  <pre data-lang="console" data-title="02-retries-and-ordering.cs output"><code>   attempt   delay before it   elapsed since the event
   -------   ---------------   -----------------------
         1              10 s                      10 s
         2              20 s                      30 s
         3              40 s                     1 min
         6             5 min                    11 min
         9            43 min                     1.4 h
        12             5.7 h                    11.4 h
        13             6.0 h                    17.4 h
        14             6.0 h                    23.4 h</code></pre>

  <p>Fourteen attempts over roughly a day, which is the shape every webhook provider converges on. The
  cap matters as much as the growth: uncapped doubling reaches days between attempts, and a consumer that
  comes back cannot tell whether it is being retried or forgotten.</p>

  <p>The end of the schedule is a product decision, not a technical one. After the last attempt the event
  is dropped, parked for manual replay, or the endpoint is disabled — and the consumer has to be told
  which, because from their side all three look identical.</p>

  <h3>Jitter</h3>

  <p class="define"><span class="define__term">Jitter</span> Randomising the retry delay, so callers that
  failed together do not retry together.</p>

  <pre data-lang="console" data-title="02-retries-and-ordering.cs output"><code>   100 consumers behind one platform. It restarts, every delivery in flight
   fails at the same moment, and every one of them is retried.

   fixed backoff
     busiest 50 ms window   100 of 100 retries
     windows used           1 of 20

   with jitter
     busiest 50 ms window   9 of 100 retries
     windows used           20 of 20</code></pre>

  <p>Without jitter the retry is a second outage. Every consumer failed at the same instant, so every
  retry is scheduled for the same instant — and the platform that was struggling gets the whole backlog
  in one 50 ms window, fails again, and re-synchronises the herd for the next round.</p>

  <div class="callout callout--why">
    <h4>Jitter is not a refinement</h4>
    <p>It is the difference between a retry policy that helps a recovering consumer and one that prevents
    it recovering.</p>
  </div>

  <h3>At-least-once, which means duplicates</h3>

  <p class="define"><span class="define__term">At-least-once</span> The delivery guarantee a retrying
  sender can actually offer: every event arrives, and some arrive more than once.</p>

  <pre data-lang="console" data-title="02-retries-and-ordering.cs output"><code>   one event, delivered with retries on timeout
     delivery attempts the consumer saw     3
     times the consumer applied it          3

   the same event, consumer keyed on the event id
     times the consumer applied it          1</code></pre>

  <p>The sender did nothing wrong. <strong>A timeout does not say whether the work happened</strong> — the
  request may have been received, processed and acknowledged into a connection that had already gone. The
  only safe assumption is that it did, and the only safe action is to retry anyway.</p>

  <pre data-lang="csharp" data-net="10" data-title="The consumer's half of the contract, which is one dictionary"><code>app.MapPost("/hooks/ledger", async (HttpRequest request, IProcessedEvents processed) =&gt;
{
    string eventId = request.Headers["x-ledger-event-id"]!;

    // Recorded in the SAME transaction as the work, or a crash between the
    // two puts you back where you started.
    if (!await processed.TryClaimAsync(eventId))
    {
        // Already handled. Acknowledge and do nothing - a duplicate is not
        // an error and must not be answered as one, or it will be retried.
        return Results.Ok();
    }

    await ApplyAsync(eventId, request);

    return Results.Ok();
});</code></pre>

  <p>So every event needs a stable id that survives retries, and the consumer needs to key on it. That is
  a contract obligation on both sides: the producer promises the id does not change between attempts, the
  consumer promises to look at it. And it has to be documented, because "at least once" is not what most
  people assume when they read "we send you a webhook".</p>
</section>

<section id="ordering">
  <h2>Ordering, which you cannot have</h2>

  <pre data-lang="console" data-title="02-retries-and-ordering.cs output"><code>   sent                    1 2 3 4 5 6 7 8
   received, in parallel   4 6 2 8 5 1 7 3
   received, one at a time 1 2 3 4 5 6 7 8

   out-of-order pairs, parallel      15
   out-of-order pairs, serialised    0</code></pre>

  <p>Parallel delivery is fast and unordered. One slow delivery lets everything behind it overtake, and a
  retry makes it far worse: a delivery retried after thirty seconds arrives after thirty seconds of later
  events.</p>

  <p>So <code>payment.refunded</code> can arrive before <code>payment.captured</code>, and a consumer that
  applies events in the order they arrive will hold the wrong state <em>permanently</em> — not for a
  moment, permanently, because nothing will ever send them again.</p>

  <p class="define"><span class="define__term">Event version</span> A number that increases with each
  change to a subject, carried in the payload, so a consumer can discard anything not newer than what it
  already holds.</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   consumer                       final state
   --------                       -----------
   applies what it is told        captured (version 1)
   checks the version             refunded (version 2)</code></pre>

  <div class="callout callout--why">
    <h4>The fix is not ordering — it is making order stop mattering</h4>
    <p>The events still arrived backwards. One integer and one comparison made that harmless, which is
    far cheaper than guaranteeing order and does not collapse when a delivery is retried for six
    hours.</p>
  </div>

  <p>And it pushes the payload design the right way. <strong>An event that carries the current state plus
  a version is safe to apply out of order and safe to apply twice. An event that carries a transition —
  "add 5 to the balance" — is safe to do neither.</strong> That choice is made once, before anything is
  built, and it decides how hard every consumer's life is.</p>

  <pre data-lang="json" data-title="A payload a consumer can survive"><code>{
  "id": "evt_01HQ8",
  "type": "payment.captured",
  "version": 4,
  "createdAt": "2026-09-08T10:14:02Z",
  "data": {
    "paymentId": "PAY-001",
    "status": "captured",
    "amountMinor": 4999,
    "currency": "GBP"
  }
}</code></pre>
</section>

<section id="isolation">
  <h2>Isolation, and the delivery log</h2>

  <p class="define"><span class="define__term">Head-of-line blocking</span> Work queued behind slower
  work that has nothing to do with it. In a shared delivery queue, the slowest consumer sets the pace for
  everybody.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   healthy consumers' events        one queue      per consumer
   -------------------------        ---------      ------------
   worst wait before delivery         1314 ms          152 ms
   average wait                        736 ms           81 ms
   whole batch finished in            1672 ms         4105 ms</code></pre>

  <p>Four workers, and one consumer's deliveries occupy them. Each held a worker for 400 ms, so with ten
  of them in a 60-event queue there was almost always one in flight — and every healthy consumer's event
  sat behind them.</p>

  <p>Note the two rows that got <em>worse</em>. The slow consumer's own worst wait went from 1,267 ms to
  3,690 ms and the whole batch took longer, because with one queue each it now gets one worker instead of
  helping itself to four. <strong>The cost has been moved onto the consumer that caused it</strong>,
  which is exactly where it belongs.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>    public async Task DrainAsync()
    {
        // DECISION 3: one queue and one worker per consumer, so a slow or
        // broken endpoint costs only its own customer.
        var byConsumer = outbox.GroupBy(e =&gt; e.Consumer).ToArray();

        await Task.WhenAll(byConsumer.Select(group =&gt; Task.Run(async () =&gt;
        {
            Endpoint endpoint = Endpoints.First(e =&gt; e.Consumer == group.Key);
            endpoint.Url = $"{baseAddress}/hooks/{group.Key}";

            foreach (Event pending in group)
            {
                await DeliverAsync(pending, endpoint);
            }
        })));
    }</code></pre>

  <div class="callout callout--note">
    <h4>Total throughput is the wrong thing to optimise here</h4>
    <p>If a consumer needs more parallelism, give each one a small allowance — two or four in flight —
    rather than one pool shared by everybody. A per-consumer limit is a bulkhead; a shared pool is
    not.</p>
  </div>

  <h3>The delivery log</h3>

  <p class="define"><span class="define__term">Delivery log</span> A record of every attempt: which
  event, which endpoint, attempt number, response status, duration. The first thing support asks for and
  the only way a consumer can be shown what happened.</p>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   event         consumer   attempt   status                    took   signature
   -----         --------   -------   ------                    ----   ---------
   evt_b4078c32  c1               1   200 OK                   246 ms   v1=8c8343150f6...
   evt_29dc9025  c2               1   503 ServiceUnavailable   246 ms   v1=5e3700d34bf...
   evt_29dc9025  c2               2   503 ServiceUnavailable     2 ms   v1=5e3700d34bf...
   evt_29dc9025  c2               3   200 OK                     1 ms   v1=5e3700d34bf...
   evt_034f509d  c3               1   500 InternalServerError   246 ms   v1=47c8f14623e...
   evt_7006f850  c4               3   timed out                502 ms   v1=fa1ad5be001...</code></pre>

  <div class="callout callout--gotcha">
    <h4>c2's three attempts share one signature</h4>
    <p>They landed inside the same second, and the timestamp has one-second resolution, so the signed
    material was identical. <strong>The signature tracks the clock, not the attempt</strong> — which is
    fine, and worth knowing before somebody uses it as a delivery identifier. The event id is the
    identifier; the signature is only a proof.</p>
  </div>

  <p>A consumer that has failed every attempt gets disabled, with the reason recorded, rather than
  retried forever — every attempt at a dead endpoint costs a worker and a connection. Not silently:
  emailed, shown a broken badge in their dashboard, and given a way to replay.</p>
</section>

<section id="security">
  <h2>The URL is attacker-controlled</h2>

  <p class="define"><span class="define__term">SSRF</span> Server-side request forgery: persuading a
  server to make a request on your behalf, to somewhere you could not reach yourself. A webhook sender is
  the ideal vehicle — the customer supplies the URL, you make the request from inside your network, and
  you do it repeatedly and on a schedule.</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   the URL the customer configured                  what happened
   -------------------------------                  -------------
   an internal address, directly                    200 OK
   a public URL that 307s to an internal one        200 OK
   internal endpoints actually reached              2

   with a guarded sender:
   an internal address, directly                    refused before sending
   a public URL that 307s to an internal one        refused before sending
   internal endpoints actually reached              0</code></pre>

  <div class="callout callout--warn">
    <h4>The second row is the one people miss</h4>
    <p>Validating the URL at registration is not enough, because a public host can answer a redirect to a
    private one — and <code>HttpClient</code> follows redirects by default. <strong>The address that was
    checked is not the address that was called.</strong></p>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="Redirects off, and the resolved address checked every time"><code>var handler = new SocketsHttpHandler
{
    // A webhook has no reason to follow a redirect, and following one
    // defeats any check made on the configured URL.
    AllowAutoRedirect = false,
    ConnectTimeout = TimeSpan.FromSeconds(2),
    PooledConnectionLifetime = TimeSpan.FromMinutes(2)
};

static bool IsAllowed(Uri uri)
{
    if (uri.Scheme != "https")
    {
        return false;
    }

    // The RESOLVED address, not the string. A hostname can point anywhere,
    // and it can point somewhere different tomorrow.
    foreach (IPAddress address in Dns.GetHostAddresses(uri.Host))
    {
        if (IPAddress.IsLoopback(address) || IsPrivateOrLinkLocal(address))
        {
            return false;
        }
    }

    return true;
}</code></pre>

  <p>Four things are needed, and the first two are not optional: turn off automatic redirects; resolve
  the host and check the resolved address against loopback, link-local
  (<code>169.254.169.254</code> is the cloud metadata service and it holds credentials) and every private
  range; require HTTPS and a public port; and send from somewhere that cannot reach anything interesting
  in the first place.</p>

  <div class="callout callout--why">
    <h4>An egress proxy beats a validation function</h4>
    <p>A network policy makes the whole class of bug unreachable rather than merely guarded against —
    which is the only version that survives somebody refactoring the check. And note that the signature
    did not help at all here: it authenticates you to the consumer, and says nothing about whether you
    should be calling this address.</p>
  </div>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   consumer   outcome                                attempts   last status
   --------   -------                                --------   -----------
   c1         delivered                                   1   200 OK
   c2         delivered on attempt 3                      3   200 OK
   c3         disabled after every attempt failed         4   500 InternalServerError
   c4         disabled after every attempt failed         4   timed out

   events announced for a rolled-back change   0
   delivery log entries                        12
   endpoints disabled                          2</code></pre>

  <p class="define"><span class="define__term">Outbox</span> A table the event is written to <em>in the
  same transaction</em> as the state change, and a separate worker that reads committed rows and delivers
  them. It exists so that nothing is announced before it is true.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// DECISION 1: the event is written in the same transaction as the state
// change. Nothing is sent from inside the transaction, so nothing is ever
// announced that then rolls back.
using (var transaction = sender.BeginTransaction())
{
    transaction.Apply("PAY-001", "captured");
    transaction.Enqueue("c1", "payment.captured", "PAY-001", "captured", version: 1);
    transaction.Enqueue("c2", "payment.captured", "PAY-001", "captured", version: 1);
    transaction.Enqueue("c3", "payment.captured", "PAY-001", "captured", version: 1);
    transaction.Enqueue("c4", "payment.captured", "PAY-001", "captured", version: 1);

    transaction.Commit();
}

// A transaction that fails after enqueuing. Nothing must reach anybody.
using (var rolledBack = sender.BeginTransaction())
{
    rolledBack.Apply("PAY-002", "captured");
    rolledBack.Enqueue("c1", "payment.captured", "PAY-002", "captured", version: 1);

    // No Commit(). The disposal discards both the state change and the event.
}</code></pre>

  <p>The rolled-back change announced nothing, which is the whole point. A webhook sent from inside a
  transaction is a promise made before it is true, and there is no event that un-says it.</p>

  <p>And the delivery itself: serialised once, signed with the current timestamp on every attempt,
  bounded by a token:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>        // DECISION 5: serialised ONCE. These bytes are what is signed and
        // what is sent, on every attempt.
        string body = JsonSerializer.Serialize(new
        {
            id = pending.Id,
            type = pending.Type,
            version = pending.Version,
            data = new { paymentId = pending.PaymentId, status = pending.Status }
        });

        for (int attempt = 1; attempt &lt;= BackoffMs.Length + 1; attempt++)
        {
            endpoint.Attempts = attempt;

            // DECISION 6: the timestamp and signature are regenerated now,
            // because the consumer's replay window is measured from now.
            long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            string signature = Sign(Secret, timestamp, body);

            var message = new HttpRequestMessage(HttpMethod.Post, endpoint.Url)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };

            message.Headers.Add("x-ledger-event-id", pending.Id);
            message.Headers.Add("x-ledger-timestamp", timestamp.ToString());
            message.Headers.Add("x-ledger-signature", signature);

            var clock = Stopwatch.StartNew();
            string status;

            try</code></pre>

  <div class="callout callout--why">
    <h4>What it still does not decide</h4>
    <p><strong>What is in the payload.</strong> Sending the whole object is convenient and means every
    consumer's logs now hold your customers' data; sending an id and making them fetch it is safer and
    doubles their integration work. That is a privacy decision before it is a design one.</p>
    <p><strong>How long the log is kept, and who can see it</strong> — it contains request bodies.</p>
    <p><strong>And whether to build this at all.</strong> The outbox, the queues, the log, the replay UI,
    the signature rotation: it is a product in its own right, and there are companies that sell it.
    Building it is a reasonable choice; building it <em>by accident</em>, one requirement at a time, is
    how most webhook systems come to exist.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Sending from inside the transaction</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - announces a payment that may not exist"><code>using var transaction = await connection.BeginTransactionAsync();

await payments.CaptureAsync(paymentId, transaction);

// The consumer can call back before this commits and get a 404. Worse: if
// the commit fails, a customer has been told about a payment that never
// existed, and there is no event that takes it back.
await webhooks.SendAsync("payment.captured", paymentId);

await transaction.CommitAsync();</code></pre>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   when the event is sent                     consumer's read-back
   ----------------------                     --------------------
   inside the handler, before the commit      read-back:404
   by a worker, after the commit              read-back:200</code></pre>

  <h3>Resending a stored request verbatim</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the stored signature expires"><code>// A delivery record holding a fully-built request is a record with an expiry
// date on it. Every retry after the consumer's tolerance window fails
// verification - which is precisely when retries matter.
HttpRequestMessage stored = delivery.Request;

await http.SendAsync(stored);</code></pre>

  <h3>One queue for everybody</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - every consumer is now a dependency of every other one"><code>// Four workers, one queue, all consumers. One customer's badly-hosted
// endpoint is now an availability problem for customers who have never
// heard of them.
await Parallel.ForEachAsync(allPendingDeliveries,
    new ParallelOptions { MaxDegreeOfParallelism = 4 },
    (delivery, token) =&gt; DeliverAsync(delivery, token));</code></pre>

  <h3>An unbounded delivery</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - one consumer can occupy the whole pool"><code>// No token, and HttpClient.Timeout defaults to 100 seconds. A consumer that
// accepts the connection and then says nothing holds this worker for a minute
// and a half, and there are only four of them.
HttpResponseMessage response = await http.SendAsync(message);</code></pre>

  <pre data-lang="csharp" data-net="10" data-title="Right - the delivery is bounded and the failure is recorded"><code>using var budget = new CancellationTokenSource(TimeSpan.FromSeconds(5));

try
{
    HttpResponseMessage response = await http.SendAsync(message, budget.Token);

    Record(pending, endpoint, attempt, $"{(int)response.StatusCode}");
}
catch (TaskCanceledException)
{
    // A timeout is a delivery outcome like any other, and it belongs in the
    // log - a consumer asking "did you try?" needs to see this row.
    Record(pending, endpoint, attempt, "timed out");
}</code></pre>

  <h3>Signing a re-serialised body</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the bytes signed are not the bytes sent"><code>var payload = new { id = eventId, type, data };

// Serialised once here, to sign.
string signature = Sign(secret, timestamp, JsonSerializer.Serialize(payload));

// And again here, to send. Two calls, two chances to differ - a changed
// option, a different naming policy, a number formatted another way - and the
// consumer rejects everything the moment they do.
var message = new HttpRequestMessage(HttpMethod.Post, url)
{
    Content = JsonContent.Create(payload)
};

message.Headers.Add("x-ledger-signature", signature);</code></pre>

  <p>Build the bytes once, sign those bytes, send those bytes. Any pipeline stage that re-serialises
  between signing and sending breaks the signature intermittently — and "intermittently" here means
  "whenever the payload happens to contain something the two paths encode differently", which is not a
  case anybody's tests contain.</p>

  <h3>Treating the consumer's 200 as proof</h3>

  <p>It means the request was accepted, not that it was processed correctly, and a consumer that returns
  200 and then fails internally will never tell you. That is their bug, and your replay tooling is what
  makes it fixable.</p>

  <h3>No way to replay</h3>

  <p>A consumer that was broken for six hours needs its events again. Without stored events and a replay
  path, the answer is "they are gone" — and for a payments notification that is a support case per
  affected transaction.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>"Everyone's webhooks are late" with a green success rate means a shared queue.</strong>
    Look at delivery <em>latency per consumer</em>, and look for one consumer whose endpoint got slow
    rather than one that broke.</li>
    <li><strong>For a consumer reporting 401s, ask what bytes they verified.</strong> A bound model or a
    re-serialised body is the answer nine times in ten, and it will have been working until you changed
    something innocuous in the payload.</li>
    <li><strong>For 401s only on retries, check the timestamp.</strong> A stored request that is resent
    verbatim fails the replay window, and only after the backoff exceeds the tolerance.</li>
    <li><strong>For a consumer complaining of duplicates, check they key on the event id</strong> — and
    check you are not changing the id between attempts, which makes their deduplication impossible.</li>
    <li><strong>For "the state is wrong and both events succeeded", suspect ordering.</strong> Compare
    the delivery timestamps against the event versions; if the earlier version arrived later, you have
    found it.</li>
    <li><strong>Keep the raw request body in the delivery log.</strong> Every signature dispute is
    settled by re-computing the HMAC over the exact bytes sent, and without them the conversation is two
    parties guessing.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>Queue age per consumer</strong> — how old is the oldest undelivered event. This is the
      metric that would have caught the incident, and it rises before anybody complains.</li>
      <li><strong>Delivery latency per consumer</strong>, not overall. An average across all consumers
      hides the one that is failing.</li>
      <li><strong>Consecutive failures per endpoint</strong>, which is what drives disabling and is the
      number to alert a customer on.</li>
      <li><strong>Attempts per successful delivery.</strong> Rising means consumers are struggling and
      your retry volume is quietly multiplying.</li>
    </ul>
  </div>

  <p>And the review question: <strong>if this consumer's endpoint took ten seconds to answer, who else
  would notice?</strong> If the answer is anybody at all, the queue is shared.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"HTTPS means we do not need a signature"</h4>
    <p>TLS proves the consumer is talking to <em>a</em> server and encrypts the channel. It says nothing
    about who sent the request arriving at their public URL.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A shared secret in a header is the same thing"</h4>
    <p>A bearer token in a header authenticates the sender and authenticates nothing about the body.
    Anybody who captures one request can send any payload they like with the same header.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"The signature covers the request"</h4>
    <p>It covers exactly the bytes you fed to the HMAC. A timestamp outside it is editable, and a body
    that gets re-serialised is a different message.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"We deliver exactly once"</h4>
    <p>Nobody does. A timeout cannot tell you whether the work happened, so the choice is between
    at-least-once and losing events.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Events arrive in order"</h4>
    <p>Fifteen out-of-order pairs in eight parallel deliveries, before any retry. A retry after six hours
    arrives after six hours of later events.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Retries make delivery reliable"</h4>
    <p>Without jitter they synchronise a herd; without a budget they multiply load on a consumer that is
    already struggling; and without an end they occupy a worker forever on an endpoint that was deleted
    last year.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"The customer's URL is the customer's problem"</h4>
    <p>You are the one making the request, from inside your network, on a schedule. Two internal
    endpoints were reached in the measurement above, one of them through a redirect from a URL that
    passed validation.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A 200 means they processed it"</h4>
    <p>It means they accepted it. Many consumers acknowledge and then queue, so a 200 is the beginning of
    their processing, not the end.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>A webhook system is a distributed system you built for other people</h4>
    <p>The incident was one customer's endpoint getting slower. It produced late webhooks for customers
    who had never heard of them, on a dashboard that stayed green, with a metric — delivery success rate
    — that was accurate and useless. Every property that makes distributed systems hard is present, and
    the consequences land on people who cannot see any of it.</p>
  </div>

  <p>The second reason is that the failures are quiet and permanent. A wrong API response gets a
  complaint within minutes. A refund applied in the wrong order sits in a consumer's database until a
  human notices a discrepancy, and no further event is coming to correct it — so the cost of getting the
  payload design wrong is not measured in errors, it is measured in reconciliations.</p>

  <p>The third is that almost everything here is a decision you cannot revisit. The signature scheme, the
  event id, whether the payload carries state or a transition, whether there is a version field: every
  consumer has written code against those, and changing one means every consumer changes. <strong>A
  webhook contract is harder to change than an API</strong>, because you cannot version it per-caller and
  you cannot see who is still on the old shape.</p>

  <p>And the fourth is that the outbox in this module is the same outbox as the queued-jobs module and
  the same problem as any dual write. Two systems changed with no transaction across them will
  eventually disagree; the only question is whether you notice.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>A consumer's endpoint was down for twenty minutes. It came back, and every retry sent to it was
    rejected with 401 — including events it had accepted happily the day before. The signature code has
    not changed.</p>
    <p>What is wrong?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   how the retry was sent                    consumer said
   ----------------------                    -------------
   the original request, resent verbatim     401 Unauthorized
   the same event, re-signed on this attempt 200 OK</code></pre>
        <p>The signature is over a timestamp, and the timestamp expired. The consumer enforces a
        five-minute window — correctly, because that is what stops a captured delivery being replayed
        forever. A retry twenty minutes later is outside it.</p>
        <p>So <strong>a retry is a new request, not a replay of an old one.</strong> The event id and the
        body stay identical — that is what makes the consumer's idempotency work — and the timestamp and
        signature are regenerated at each attempt.</p>
        <p>The bug comes from storing the wrong thing. A delivery record that holds a fully-built HTTP
        request is a record with an expiry date on it. Store the event and the destination; build the
        request each time.</p>
        <p>And it only appears after a long outage, which is exactly when the retry machinery matters
        most. Early retries are inside the window and pass, so the bug is invisible until the day it is
        load-bearing.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>Customers configure their own webhook URL. One of them entered an address on your own network.</p>
    <p>What can they reach, and what stops them?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   the URL the customer configured                  what happened
   -------------------------------                  -------------
   an internal address, directly                    200 OK
   a public URL that 307s to an internal one        200 OK
   internal endpoints actually reached              2

   with a guarded sender:
   internal endpoints actually reached              0</code></pre>
        <p>Anything the sender can reach. This is server-side request forgery, and a webhook sender is
        the ideal vehicle for it: the customer supplies the URL, you make the request from inside the
        network, and you do it repeatedly and on a schedule.</p>
        <p>The second row is the one people miss. Validating the URL at registration is not enough,
        because a public host can answer a redirect to a private one — and <code>HttpClient</code>
        follows redirects by default. <strong>The address that was checked is not the address that was
        called.</strong></p>
        <p>Four things are needed. Turn off automatic redirects. Resolve the host and check the
        <em>resolved</em> address — not the string — against loopback, link-local
        (<code>169.254.169.254</code> is the cloud metadata service, and it holds credentials) and every
        private range. Require HTTPS and a public port. And send from somewhere that cannot reach
        anything interesting, so the class of bug is unreachable rather than merely guarded against.</p>
        <p>Note that the signature did not help at all. It authenticates you to the consumer; it says
        nothing about whether you should be calling this address.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>A payment was captured, then refunded four seconds later. The consumer shows it as "captured".
    Both webhooks were delivered and both returned 200.</p>
    <p>What happened, and what makes it impossible?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   consumer                       final state
   --------                       -----------
   applies what it is told        captured (version 1)
   checks the version             refunded (version 2)</code></pre>
        <p>The events arrived in the wrong order and the consumer applied them in the order they arrived.
        "captured" was retried after a blip; "refunded" was delivered first time. Both succeeded, so
        nothing anywhere records a problem — and the wrong state is permanent, because no further event
        is coming.</p>
        <p>The fix is in the payload, and it is the producer's job. Every event carries a monotonic
        version for its subject, and the consumer discards anything not newer than what it holds. One
        integer and one comparison.</p>
        <p>Notice what it is not: it is not ordering. The events still arrived backwards. <strong>It made
        order stop mattering</strong>, which is far cheaper than guaranteeing order and does not collapse
        when one delivery is retried for six hours.</p>
        <p>And it pushes the design the right way. An event carrying the current state plus a version is
        safe to apply out of order and safe to apply twice; an event carrying a transition — "add 5 to
        the balance" — is safe to do neither. That choice is made once, before anything is built, and it
        decides how hard every consumer's life is.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>Consumers occasionally call your API on receiving <code>payment.captured</code> and get a 404 for
    the payment you have only this moment told them about. It happens to maybe one delivery in five hundred, and never in
    staging.</p>
    <p>Where is the race?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   when the event is sent                     consumer's read-back
   ----------------------                     --------------------
   inside the handler, before the commit      read-back:404
   by a worker, after the commit              read-back:200</code></pre>
        <p>The event was sent before the transaction committed. The consumer received it, called back
        within a few milliseconds, and read a database that did not yet contain the row.</p>
        <p>It is rare and it is not random. The window is the gap between the send and the commit —
        normally microseconds, occasionally much longer when a commit waits on a lock or a replica.
        Staging never shows it because staging consumers are slower to call back than production
        ones.</p>
        <p>And there is a worse version of the same bug: <strong>if the transaction rolls back, the
        webhook has already gone.</strong> You have told a customer about a payment that does not exist
        and never will, and there is no event to correct it with.</p>
        <p>The fix is the outbox, and it is the same pattern as a queued job. The event is inserted in
        the same transaction as the state change, so it commits or rolls back with it; a separate worker
        reads committed rows and delivers them — by construction, after the commit.</p>
        <p>The cost is latency, and it is small: the worker polls, so the webhook goes out milliseconds
        later than it would have. The price of not paying it is a dual write — two systems changed with
        no transaction across them — and every dual write eventually disagrees.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>What does a webhook signature prove, and what does it not?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>That the request came from someone holding the secret, and that
        those exact bytes were not altered. It proves nothing about freshness — which is what the
        timestamp inside the signed material is for.</p></div>
      </details></li>

    <li><p>Why must the consumer verify against the raw request body?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>HMAC is a function of bytes. A re-serialised body is a different
        message — measured: a typed round trip and a pretty-print both failed, while a
        <code>JsonElement</code> round trip happened to pass, which is why the bug ships.</p></div>
      </details></li>

    <li><p>Why must the timestamp be inside the signature rather than beside it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A timestamp header that is not signed is a header the attacker
        edits. Inside the signature, changing it invalidates the request.</p></div>
      </details></li>

    <li><p>Why must a retry be re-signed?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The consumer's replay window is measured from the signed timestamp.
        A stored request resent after the backoff exceeds the tolerance is rejected — measured at 401
        against 200 for the re-signed version.</p></div>
      </details></li>

    <li><p>What delivery guarantee can a retrying sender offer, and what does it force on the
      consumer?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>At-least-once. A timeout cannot say whether the work happened, so
        the consumer must key on a stable event id — 3 applications against 1 in the
        measurement.</p></div>
      </details></li>

    <li><p>Why does a retry schedule need jitter?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Consumers that failed together retry together. Without jitter, 100
        of 100 retries landed in one 50 ms window; with it, 9 spread across 20.</p></div>
      </details></li>

    <li><p>How can a consumer be safe against out-of-order delivery?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Every event carries a monotonic version for its subject and the
        consumer discards anything not newer. That does not restore order; it makes order stop
        mattering.</p></div>
      </details></li>

    <li><p>Why is an event carrying current state better than one carrying a transition?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>State plus a version is safe to apply out of order and safe to apply
        twice. A transition — "add 5" — is safe to do neither, and both of those will happen.</p></div>
      </details></li>

    <li><p>What did a shared delivery queue cost the healthy consumers?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>1,314 ms worst wait against 152 ms once queues were separated, with
        a 100% delivery success rate throughout. The slowest consumer sets the pace for
        everybody.</p></div>
      </details></li>

    <li><p>Which metric would have caught that incident?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Queue age per consumer — how old the oldest undelivered event is. It
        rises before anybody complains, and it describes the backlog rather than the traffic.</p></div>
      </details></li>

    <li><p>Why is validating a customer's webhook URL at registration insufficient?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A public host can redirect to a private one, and
        <code>HttpClient</code> follows redirects by default. Turn them off and check the resolved
        address on every send.</p></div>
      </details></li>

    <li><p>Why must the event be written in the same transaction as the state change?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Otherwise a consumer can call back before the commit and get a 404 —
        and if the transaction rolls back, a customer has been told about something that never happened,
        with no event that takes it back.</p></div>
      </details></li>
  </ol>
</section>
`
});
