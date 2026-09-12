CSPREP.module({
  id: "t3-27-webhooks-inbound",
  minutes: 60,
  updated: "2026-09-09",
  summary: "Our partner said our endpoint was failing, our logs said every request returned 200, and we had processed 60 events for the 20 they sent. Measured: a request body that reads as 94 bytes once and 0 bytes the second time; a bound parameter that consumes it before the handler's first line; a UTF-8 BOM that breaks verification for one partner and nobody else; a replay inside the window accepted three times out of three; and a claim marked on arrival that loses an event permanently when the worker dies holding it.",
  terms: ["webhook receiver", "raw request body", "EnableBuffering", "replay window", "idempotency key",
    "constant-time comparison", "claim", "at-least-once", "fast acknowledgement", "202 Accepted",
    "durable write", "sweep", "quarantine", "head-of-line", "load-balanced state"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>The previous module sent webhooks. This one receives them, and almost nothing carries over. You
  are the server, the caller is a system you do not control, and the request arrives at a public URL
  with no session and no login behind it.</p>

  <p>At 09:15 a partner reported that Ledger's webhook endpoint was failing. At 09:20 our logs showed
  every request returning 200. At 09:40 a customer reported being charged three times. At 09:55 we had
  processed 60 events. They had sent 20.</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   deliveries the receiver saw            60
   deliveries the sender recorded failed  20 of 20
   charges applied                        60
   events actually sent                   20
   took                                   1576 ms</code></pre>

  <p>The same twenty events, with one thing changed in the handler:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   deliveries the receiver saw            20
   deliveries the sender recorded failed  0 of 20
   charges applied                        20
   events actually sent                   20
   took                                     9 ms</code></pre>

  <div class="callout callout--note">
    <h4>Both sides were telling the truth</h4>
    <p>Every request we received, we processed and answered 200. Every delivery they made, they gave up
    on before the answer arrived. Nobody was lying, and nobody was looking at the same event.</p>
  </div>
</section>

<section id="what-changes">
  <h2>What changes when you are the receiver</h2>

  <p class="define"><span class="define__term">Webhook receiver</span> An endpoint you publish so that
  another system can tell you something happened. It is a public, unauthenticated URL that performs
  privileged work.</p>

  <p>Four things are different from an ordinary API, and each is a section below.</p>

  <p class="define"><span class="define__term">HMAC</span> A keyed hash. Given a secret and a message it
  produces a fixed-length value nobody without the secret can produce, and which changes completely if
  any byte of the message changes.</p>

  <p class="define"><span class="define__term">Signature</span> The HMAC of the timestamp and the request
  body, sent in a header. It is the sender proving both who they are and that these exact bytes are what
  they sent.</p>

  <p><strong>The signature is the only authentication there is.</strong> There is no session, no bearer
  token issued to a user, no mutual TLS by default. Anybody who finds the URL can post to it, so every
  line of the handler before the verification runs for strangers.</p>

  <p><strong>You are on somebody else's clock.</strong> The sender has a timeout, you do not get to see
  it, and exceeding it does not produce an error — it produces a retry. <strong>Slow does not degrade
  into slow here; it degrades into duplicate.</strong></p>

  <p><strong>Duplicates are normal, not exceptional.</strong> The sender cannot know whether a timed-out
  delivery was handled, so it must assume it was not. Every correct sender in the world will send you
  some events twice.</p>

  <p><strong>And nobody will tell you when you drop one.</strong> Once you have answered 200, the
  sender's retries are gone. Anything that goes wrong after that moment is yours to detect, and the
  measurements below show two ways it goes wrong silently.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>Receiving a webhook is signing for a parcel. You check the sender is who they say, you sign, and
  from that moment the delivery company's job is done and the parcel is your responsibility.</p>

  <p>Where it stops is that a parcel is a physical object — once it is in your hall, it is there. A
  webhook you have signed for exists only where you put it, so <strong>signing for it and then losing
  it is not merely possible, it is the default</strong> if you acknowledged before writing it down.</p>
</section>

<section id="reading-the-body">
  <h2>Holding on to the bytes that arrived</h2>

  <p>The signature is over the bytes the sender hashed. Getting hold of exactly those bytes is harder in
  ASP.NET Core than it looks, in three separate ways.</p>

  <h3>The body can only be read once</h3>

  <pre data-lang="console" data-title="01-reading-the-body.cs output"><code>   handler                       first read   second read
   -------                       ----------   -----------
   reads it twice                        94             0
   EnableBuffering, then rewinds          94            94</code></pre>

  <p class="define"><span class="define__term">Raw request body</span> The bytes as they arrived, before
  any decoding or parsing. On the server this is <code>HttpRequest.Body</code>, a forward-only network
  stream.</p>

  <p class="define"><span class="define__term">EnableBuffering</span> A call that swaps in a rewindable
  stream, spilling to disk past a threshold, so the body can be read more than once. It must be called
  before anything reads, and the position reset afterwards.</p>

  <div class="callout callout--gotcha">
    <h4>The second read returned nothing, and did not throw</h4>
    <p>An empty string is not an error condition. A verifier that reads second computes the signature of
    an empty body and rejects everything — or, far worse, accepts everything, if the sender also happens
    to sign an empty body.</p>
  </div>

  <h3>A bound parameter reads it first</h3>

  <pre data-lang="console" data-title="01-reading-the-body.cs output"><code>   the model bound successfully to           evt_01HQ8
   bytes left in the body for the handler    0
   bytes that actually arrived              94</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - binding consumed the body before line one"><code>app.MapPost("/hooks/ledger", async (WebhookEvent bound, HttpRequest request) =&gt;
{
    // Model binding has already read the stream. This is zero bytes, and
    // nothing anywhere says so.
    using var reader = new StreamReader(request.Body);

    string body = await reader.ReadToEndAsync();

    return Verify(Secret, timestamp, body, signature) ? Results.Ok() : Results.Unauthorized();
});</code></pre>

  <p>The fix is not <code>EnableBuffering</code>. It is to stop binding: take <code>HttpRequest</code>,
  read the bytes, verify, and parse those same bytes yourself. Binding first and re-serialising the model
  is the other well-known way to get this wrong, because the bytes it produces are not the bytes that
  were signed.</p>

  <h3>Decoding and re-encoding is not always a round trip</h3>

  <pre data-lang="console" data-title="01-reading-the-body.cs output"><code>   body                                  bytes sent   verified as   signature
   ----                                  ----------   -----------   ---------
   plain ASCII JSON                              94            94   ok     read as bytes
                                                 94            94   ok     decoded to a string
   JSON containing a pound sign                  94            94   ok     read as bytes
                                                 94            94   ok     decoded to a string
   the same JSON with a UTF-8 BOM                97            97   ok     read as bytes
                                                 97            94   FAILS  decoded to a string</code></pre>

  <p>The first two bodies survive the round trip. Valid UTF-8 decoded to a string and re-encoded as UTF-8
  gives back the same bytes, pound sign and all — which is exactly why this code passes review and passes
  tests.</p>

  <p class="define"><span class="define__term">Byte-order mark</span> Three bytes
  (<code>EF BB BF</code>) some tools put at the start of a UTF-8 file or payload. It carries no content;
  it declares the encoding, and text APIs strip it on the way in.</p>

  <p>The BOM is the one that breaks it. <code>StreamReader</code> treats a leading byte-order mark as an
  encoding declaration and strips it, so three bytes that were signed are not three bytes that were
  verified. Nothing is corrupt and nothing throws; the signature is over a different message.</p>

  <div class="callout callout--why">
    <h4>Which arrives as the worst kind of ticket</h4>
    <p>A BOM on a JSON post is unusual and entirely legal, and some senders emit one because their
    serialiser defaults to it. So this presents as <strong>"our integration works with everyone except
    one partner"</strong> — and the general rule is simpler than the exception: the signature is over
    bytes, so verify bytes. If you never decode, you never have to know what the edge cases are.</p>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="Right - the bytes, and nothing but the bytes"><code>using var buffer = new MemoryStream();

await request.Body.CopyToAsync(buffer);

byte[] body = buffer.ToArray();</code></pre>
</section>

<section id="verifying">
  <h2>Verifying, in the right order</h2>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   what arrived                              receiver said
   ------------                              -------------
   a properly signed event                   200  accepted
   the same signature, body edited           400  bad signature
   signed with somebody else's secret        400  bad signature
   correctly signed, 20 minutes old          400  stale or missing timestamp
   no signature header                       400  bad signature</code></pre>

  <p class="define"><span class="define__term">Replay window</span> A tolerance between the signed
  timestamp and your own clock, outside which a correctly signed request is refused. Five minutes is the
  usual choice.</p>

  <p class="define"><span class="define__term">Constant-time comparison</span> A comparison that examines
  every byte regardless of where the first difference is, so how long it took reveals nothing about how
  much of a guess was right. <code>CryptographicOperations.FixedTimeEquals</code>.</p>

  <h3>Freshness is checked before authorship</h3>

  <div class="callout callout--why">
    <h4>Because a replay has a perfectly valid signature</h4>
    <p>That is what makes it a replay rather than a forgery — it is byte-for-byte a real delivery. No
    cryptography can separate the two. Freshness and authorship are different questions and neither one
    answers the other.</p>
  </div>

  <h3>And nothing is parsed until the signature verifies</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   payload size                                 23,731 bytes

   order of operations           200 unsigned requests cost
   ------------------           --------------------------
   parse and log, then verify                    435 ms
   verify, then parse                             15 ms
   ratio                                        29.9x</code></pre>

  <p>Everything that happens before the signature check is work an anonymous caller gets for free.
  Parsing is the expensive one, and it is the one that reads most naturally at the top of a handler,
  because the parsed object is what everything below it wants.</p>

  <p>So the order is <strong>length limit, timestamp, signature, and only then parse</strong>. The length
  limit comes first because the HMAC itself is linear in body size, so a 500 MB body is still work you
  are doing for a stranger. Kestrel's default <code>MaxRequestBodySize</code> of 30 MB is a backstop, not
  a webhook limit — a real event is kilobytes.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>// DECISION 1: HttpRequest, not a bound model. Binding would consume the body
// before the handler runs, and the signature is over the body.
app.MapPost("/hooks/ledger", async (HttpRequest request) =&gt;
{
    // DECISION 2: a size limit before any work at all. The HMAC is linear in
    // the body size, so an unbounded body is unbounded work for a stranger.
    if (request.ContentLength &gt; MaxBodyBytes)
    {
        return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    byte[] body = await ReadBoundedAsync(request.Body, MaxBodyBytes);

    if (body.Length == 0)
    {
        return Results.BadRequest();
    }

    // DECISION 3: freshness before authorship. A replay carries a perfectly
    // valid signature - checking it proves nothing about how old it is.
    if (!long.TryParse(request.Headers["x-ledger-timestamp"], out long timestamp)
        || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp) &gt; ToleranceSeconds)
    {
        return Results.BadRequest();
    }

    // DECISION 4: constant-time comparison, and every candidate signature
    // tried, so the sender can rotate its secret without an outage.
    string presented = request.Headers["x-ledger-signature"].ToString();

    if (!Verify(Secret, timestamp, body, presented))
    {
        return Results.Unauthorized();
    }

    // Only now is the request trusted enough to look inside.</code></pre>

  <p>And the limit has to bound the <em>read</em>, not trust the header — a missing or lying
  <code>Content-Length</code> is not a reason to read forever:</p>

  <pre data-lang="csharp" data-net="10" data-title="A read that cannot be made to run away"><code>static async Task&lt;byte[]&gt; ReadBoundedAsync(Stream body, int limit)
{
    using var buffer = new MemoryStream();

    byte[] chunk = new byte[8192];
    int read;

    while ((read = await body.ReadAsync(chunk)) &gt; 0)
    {
        if (buffer.Length + read &gt; limit)
        {
            // Stop reading. Returning empty means the caller answers 413
            // without ever hashing a byte of it.
            return [];
        }

        buffer.Write(chunk, 0, read);
    }

    return buffer.ToArray();
}</code></pre>

  <div class="callout callout--warn">
    <h4>Logging the body is part of the problem, not the diagnosis</h4>
    <p>An unverified payload written to a log is an anonymous caller filling your disk and putting their
    text in front of your operators. Log after verification, or log a hash.</p>
  </div>

  <h3>Accepting more than one signature</h3>

  <p>A sender rotating its secret sends both signatures in one comma-separated header. A receiver that
  splits and tries each one lets that rotation happen without an outage — and the same mechanism carries
  a future algorithm change, which is what the <code>v1=</code> prefix is for.</p>

  <pre data-lang="csharp" data-net="10" data-title="Try every candidate, in constant time"><code>static bool Verify(string secret, long timestamp, byte[] body, string presented)
{
    foreach (string candidate in presented.Split(','))
    {
        if (CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(candidate),
                Encoding.UTF8.GetBytes(Sign(secret, timestamp, body))))
        {
            return true;
        }
    }

    return false;
}</code></pre>
</section>

<section id="replay-and-idempotency">
  <h2>The window is not replay protection</h2>

  <pre data-lang="console" data-title="02-replay-and-idempotency.cs output"><code>   what the receiver checks           times it applied a 3x replay
   ------------------------           ----------------------------
   signature and timestamp window                                3
   ...and whether it has seen the id                             1</code></pre>

  <p class="define"><span class="define__term">Idempotency key</span> A stable identifier the sender
  promises not to change between attempts — the event id. The receiver records it and uses it to
  recognise a repeat.</p>

  <p class="define"><span class="define__term">Claim</span> The row you write to say this event id is
  yours to process. Whether it records <em>arrival</em> or <em>completion</em> is the difference between
  an event that is lost and one that is recovered.</p>

  <p class="define"><span class="define__term">Unique constraint</span> A database rule that a column's
  values cannot repeat. Inserting a duplicate fails, which turns "have I seen this?" from two operations
  into one atomic one.</p>

  <p>The window bounds how <em>old</em> a request may be. It says nothing about how many times that
  request may arrive, and the two checks answer different questions: the window stops a delivery captured
  last week; the id check stops the same delivery arriving twice in the next second.</p>

  <p>The id check is also what handles the sender's own honest retries — which are not an attack and are
  guaranteed to happen. And the window is what makes the id store affordable: ids only have to be
  remembered for as long as a delivery could still be accepted.</p>

  <h3>The check has to be atomic</h3>

  <pre data-lang="console" data-title="02-replay-and-idempotency.cs output"><code>   check, then add     20 events, 2 deliveries each  -&gt;  applied 22 times
   TryAdd              20 events, 2 deliveries each  -&gt;  applied 20 times</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - two operations with a gap between them"><code>// A duplicate can arrive between the check and the write. The gap is small,
// which is exactly why this survives testing and fails under load.
if (!store.ContainsKey(eventId))
{
    store[eventId] = "seen";

    await ApplyAsync(received);
}</code></pre>

  <p>In a real receiver the atomic operation is the database's: an <code>INSERT</code> of the event id
  against a unique constraint, where the duplicate-key violation <em>is</em> the answer. That works
  across instances, which a dictionary does not — and exercise 2 measures what happens when it does
  not.</p>

  <h3>Where the claim sits decides what a crash costs</h3>

  <pre data-lang="console" data-title="02-replay-and-idempotency.cs output"><code>   order of operations              charges applied   after redelivery
   ------------------              ---------------   ----------------
   claim-then-work                               0                  0
   work-then-claim                               1                  2
   one-transaction                               0                  1</code></pre>

  <div class="callout callout--gotcha">
    <h4>Claim-then-work is the worst row, and it looks the most careful</h4>
    <p>The claim committed, the work did not, and the redelivery is <em>correctly</em> identified as a
    duplicate and skipped. The customer is never charged, nothing is logged as a failure, and the
    sender's delivery log says "delivered".</p>
  </div>

  <p>Work-then-claim charges twice, which is at least visible — a customer with two charges tells you
  about it. <strong>One transaction is the only correct answer</strong>: the claim and the work commit
  together or not at all, so a crash leaves nothing behind and the redelivery does the whole thing
  exactly once.</p>

  <p>That is a constraint on the design rather than a detail of it. The dedupe store has to live in the
  <em>same</em> database as the work — a Redis <code>SETNX</code> beside a SQL transaction is the
  claim-then-work row with a network partition instead of a crash.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>    public void Quarantine(string eventId, byte[] body) =&gt; QuarantinedBodies[eventId] = body;

    public ClaimResult TryClaim(string eventId, Event received)
    {
        if (Claims.TryGetValue(eventId, out (Event Event, string State) existing))
        {
            return existing.State == "done" ? ClaimResult.AlreadyDone : ClaimResult.InProgress;
        }

        // Pending, not seen. The difference is the whole of exercise 4.
        Claims[eventId] = (received, "pending");

        return ClaimResult.Claimed;
    }</code></pre>

  <p>Against a real database that is one transaction and one insert, with the unique constraint doing
  the work a dictionary cannot do across instances:</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - the claim and the work commit together"><code>await using var transaction = await connection.BeginTransactionAsync(token);

try
{
    // The unique index on event_id is what makes this atomic. A duplicate
    // raises instead of returning, and that raise IS the answer.
    await connection.ExecuteAsync(
        "insert into processed_events (event_id, state) values (@id, 'pending')",
        new { id = eventId }, transaction);
}
catch (DbException exception) when (IsUniqueViolation(exception))
{
    await transaction.RollbackAsync(token);

    // We already have it. That is not an error and must not be answered as
    // one, or the sender will keep retrying something we finished.
    return Results.Ok();
}

await ApplyAsync(received, connection, transaction, token);

await connection.ExecuteAsync(
    "update processed_events set state = 'done' where event_id = @id",
    new { id = eventId }, transaction);

// One commit. A crash anywhere above leaves nothing behind, so the sender's
// redelivery does the whole thing exactly once.
await transaction.CommitAsync(token);</code></pre>
</section>

<section id="fast-ack">
  <h2>Acknowledge, then work</h2>

  <p class="define"><span class="define__term">Fast acknowledgement</span> Verifying, recording the event
  durably, and answering immediately — doing the actual work afterwards, on your own schedule.</p>

  <p>The incident at the top of this module is what happens without it: 900 ms of perfectly reasonable
  work inside a handler, against a sender timeout nobody published, turning twenty events into sixty
  deliveries and sixty charges.</p>

  <div class="callout callout--why">
    <h4>The work still takes 900 ms</h4>
    <p>Nothing was optimised. The handler stopped holding the sender's connection open while it
    ran. A webhook handler's job is to take custody of the event, not to finish it.</p>
  </div>

  <h3>"Durable" is the load-bearing word</h3>

  <pre data-lang="console" data-title="03-production.cs output"><code>   a deploy restarts the receiver mid-queue:

     events acknowledged with 202        12
     events processed before the restart 4
     events still in the in-memory queue 8
     events that survive the restart     0
     events the sender will retry        0  (it has a 202 for all 12)</code></pre>

  <p>Eight events gone, and nothing anywhere records a problem. We told the sender we had them, so it
  will never send them again; we lost them, so they were never processed.</p>

  <p>The order is the entire point: <strong>write it down, then acknowledge.</strong> A row in the same
  database the work will use, a durable queue, anything that survives the process. An in-memory queue, a
  fire-and-forget <code>Task</code>, or state inside an <code>IHostedService</code> are all the same bug
  wearing different clothes — and it is a routine deploy that exposes it, not a crash.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the 202 is a promise this cannot keep"><code>app.MapPost("/hooks/ledger", async (HttpRequest request) =&gt;
{
    byte[] body = await ReadBoundedAsync(request.Body, MaxBodyBytes);

    if (!Verify(Secret, timestamp, body, signature))
    {
        return Results.Unauthorized();
    }

    // Nothing here survives the process. The acknowledgement below is a
    // promise made against memory.
    _ = Task.Run(() =&gt; ApplyAsync(JsonSerializer.Deserialize&lt;Event&gt;(body)!));

    return Results.Accepted();
});</code></pre>

  <h3>And the claim needs a state, not a bit</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   claim records                  events   completed   lost   redelivery
   -------------                  ------   ---------   ----   ----------
   seen / not seen                    10           7      3   never - it has a 200
   pending -&gt; done, swept             10           7      3   swept locally, 3 recovered</code></pre>

  <p class="define"><span class="define__term">Sweep</span> A periodic pass that finds claims left
  pending for longer than the work should take, and retries them. It is the only thing that can recover a
  stalled event once the sender has been told 200.</p>

  <pre data-lang="csharp" data-net="10" data-title="The sweep, which nothing else can do for you"><code>public sealed class StalledClaimSweeper(IServiceScopeFactory scopes)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));

        while (await timer.WaitForNextTickAsync(stopping))
        {
            using IServiceScope scope = scopes.CreateScope();

            var claims = scope.ServiceProvider.GetRequiredService&lt;ClaimStore&gt;();

            // Longer than the slowest legitimate run, or this races a worker
            // that is merely slow and undoes the transaction's guarantee.
            foreach (string id in await claims.PendingOlderThanAsync(
                TimeSpan.FromMinutes(15), stopping))
            {
                await claims.RetryAsync(id, stopping);
            }
        }
    }
}</code></pre>

  <div class="callout callout--warn">
    <h4>A fast acknowledgement is a transfer of liability</h4>
    <p>From the instant you send it, the sender's retries are gone and every remaining failure is yours
    to detect. That is a good trade — it is the difference between 60 charges and 20 — but it is a trade,
    and the sweep is the price.</p>
  </div>
</section>

<section id="status-codes">
  <h2>What to return, and what the sender does with it</h2>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the handler returns      the sender's reaction         attempts
   ------------------------      ---------------------         --------
   200 OK                        done, never send it again            1
   202 Accepted                  done, never send it again            1
   400 Bad Request               our fault, stop retrying             1
   401 Unauthorized              our fault, stop retrying             1
   409 Conflict                  our fault, stop retrying             1
   429 Too Many Requests         back off, retry later         up to 14
   500 Internal Server Error     their fault, retry            up to 14
   503 Service Unavailable       their fault, retry            up to 14
   no response at all            their fault, retry            up to 14</code></pre>

  <p>The status code is an instruction to a retry loop, and that is the whole of it. There are only three
  things you can say:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Code</th><th>Means</th><th>Use it for</th></tr>
      </thead>
      <tbody>
        <tr><td><code>2xx</code></td><td>I have this. Stop.</td><td>Accepted, and duplicates</td></tr>
        <tr><td><code>4xx</code></td><td>This will never work. Stop, and tell a human.</td><td>Bad signature, unparseable body, unknown event type</td></tr>
        <tr><td><code>5xx</code></td><td>I am broken right now. Try again.</td><td>Your database is down; a transient failure</td></tr>
      </tbody>
    </table>
  </div>

  <pre data-lang="csharp" data-net="10" data-title="The whole decision, in one place"><code>static IResult Answer(ClaimResult claim) =&gt; claim switch
{
    // Queued, and we have written it down. The sender is finished with it.
    ClaimResult.Claimed =&gt; Results.Accepted(),

    // We already have it. The sender is asking, not complaining - a 4xx here
    // reads as permanent and can get the endpoint disabled.
    ClaimResult.InProgress or ClaimResult.AlreadyDone =&gt; Results.Ok(),

    // Our database is down. This one IS worth retrying, and 5xx is how the
    // sender is told to.
    _ =&gt; Results.StatusCode(StatusCodes.Status503ServiceUnavailable)
};</code></pre>

  <div class="callout callout--gotcha">
    <h4>A duplicate is a 200, not a 409</h4>
    <p>The sender is retrying because it is not sure you got it. You did, so tell it so. A 409 reads as a
    permanent failure in most senders' books and can get your endpoint disabled — punishing the sender
    for doing exactly the right thing.</p>
  </div>

  <p class="define"><span class="define__term">Quarantine</span> Storing the raw bytes of something you
  are about to reject, so that a permanent rejection is a record rather than a disappearance.</p>

  <p>And a 400 stops the retries and drops the event: nobody will ever send it again. So a 400 for an
  unparseable body is correct <em>only if</em> you have also stored the raw bytes for a human. Otherwise
  you have chosen silent data loss over noisy retries, which is the worse of the two.</p>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   what arrived                                status   what we did
   ------------                                ------   -----------
   a properly signed event                       202   accepted, queued
   the same event again                          200   already had it
   a second, newer event                         202   accepted, queued
   an event signed with a stale timestamp        400   rejected: stale, empty or unparseable
   an event signed with another secret           401   rejected: signature
   a body that is not JSON                       400   rejected: stale, empty or unparseable
   a 128 KB body                                 413   refused: too large

   events accepted                      2
   events completed by the worker       1
   still pending after the worker died  1
   bodies quarantined for a human       1
   recovered by the sweep               1
   events completed after the sweep     2
   times any payment was applied twice  0</code></pre>

  <p>The 128 KB body was refused without a signature check at all, because the HMAC is linear in body
  size. The unparseable body was quarantined before the 400, so the rejection is recorded rather than
  silent. And the worker died holding the second event — the sweep is the only thing in the system that
  could still find it, because the sender already has its 200.</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>    public int SweepStalled()
    {
        // Anything pending for longer than the work should take. The claim and
        // the completion are one write, so a sweep can never double-apply.
        string[] stalled = [.. Claims.Where(c =&gt; c.Value.State == "pending").Select(c =&gt; c.Key)];

        foreach (string id in stalled)
        {
            Complete(id);
        }

        return stalled.Length;
    }</code></pre>

  <div class="callout callout--why">
    <h4>What it still does not decide</h4>
    <p><strong>How long a pending claim may sit</strong> before the sweep takes it. Too short and the
    sweep races a worker that is merely slow, undoing the whole point of the transaction; too long and a
    stalled event is invisible for hours. It has to exceed the slowest legitimate run.</p>
    <p><strong>How long event ids are kept.</strong> The replay window sets the floor, but a sender that
    retries for a day needs a day, not five minutes.</p>
    <p><strong>And whether order matters to you.</strong> This receiver applies whatever it is given. If
    the payload carries a version, compare it and discard the stale one — nothing on this side can
    reconstruct an order the wire did not keep.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>Doing the work before answering</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - 900 ms of work on somebody else's timeout"><code>app.MapPost("/hooks/ledger", async (HttpRequest request) =&gt;
{
    byte[] body = await ReadBoundedAsync(request.Body, MaxBodyBytes);

    // Verified correctly, and then everything after this point runs while the
    // sender's clock is ticking. Measured: 60 deliveries for 20 events.
    await ApplyChargeAsync(JsonSerializer.Deserialize&lt;Event&gt;(body)!);

    return Results.Ok();
});</code></pre>

  <h3>Verifying against a re-serialised model</h3>

  <p>Covered above, and the receiver-side version of the sender's mistake: bind, re-serialise, hash. The
  bytes that come out of a serialiser are not the bytes that came off the wire, and the failure is
  intermittent — it works until a payload appears that the two paths encode differently.</p>

  <h3>Dedupe state that is per-instance</h3>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   where the seen-ids live       instances   events   times applied
   ---------------------       ---------   ------   -------------
   in each instance's memory           3       30              48
     of 30 events, both deliveries landed on the same instance 12 times
   in one shared store                 3       30              30</code></pre>

  <h3>Returning 500 for something that will never work</h3>

  <p>A payload you cannot parse will not parse next time either, so a 5xx buys fourteen guaranteed-futile
  retries and a page. The status code is a retry instruction, not a mood.</p>

  <h3>Trusting anything before the signature</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the expensive work happens for anyone"><code>// Parsed and logged before the caller has proved anything. Measured at 29.9x
// the cost of rejecting first, and the log is now writable by strangers.
JsonDocument parsed = JsonDocument.Parse(body);

logger.LogInformation("Webhook received: {Body}", parsed.RootElement.ToString());

if (!Verify(Secret, timestamp, body, signature))
{
    return Results.Unauthorized();
}</code></pre>

  <h3>No limit on the body</h3>

  <p>The HMAC is linear in body size, so an unbounded body is unbounded work for an anonymous caller. A
  real event is kilobytes; the framework default is 30 MB.</p>

  <h3>A claim that records arrival rather than completion</h3>

  <p>"Seen" cannot distinguish an event that finished from one whose worker died holding it, so the
  dedupe check then does its job flawlessly and skips it forever. Pending and done are different states,
  and the difference is an event that silently never happens.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <ol>
    <li><strong>When the sender says failing and your logs say 200, compare counts, not statuses.</strong>
    Deliveries received against events sent is the number that shows a timeout-and-retry loop; both sides'
    status logs will look fine.</li>
    <li><strong>For "signature verification fails for one partner only", get the raw bytes.</strong> Not
    the parsed body, not the logged string — the bytes, with their length. A three-byte difference is a
    BOM; a length that matches but a hash that does not is a re-serialisation.</li>
    <li><strong>For "verification fails for everyone since the refactor", check what reads the body
    first.</strong> A bound parameter, a logging middleware, or a request-size filter will all have
    consumed the stream, and the symptom is hashing zero bytes.</li>
    <li><strong>For duplicates whose rate matches your instance count, look for per-instance
    state.</strong> One in three with three instances is a dictionary that should be a table.</li>
    <li><strong>For events that vanish, look at claims that are pending and old.</strong> Not the error
    rate, which is zero, and not the processed count, which looks healthy.</li>
    <li><strong>Keep the raw bytes of anything you reject.</strong> Every signature dispute is settled by
    recomputing the HMAC over the exact bytes received, and without them the conversation is two parties
    guessing.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch</h4>
    <ul>
      <li><strong>Deliveries received against events acknowledged.</strong> A ratio above one is retries,
      and retries mean you are too slow.</li>
      <li><strong>Handler duration, p99 — of the handler, not the work.</strong> This is the number the
      sender's timeout is compared against, and it should be single-digit milliseconds.</li>
      <li><strong>Age of the oldest pending claim.</strong> The mirror of queue age on the sending side,
      and the only thing that finds an event whose worker died.</li>
      <li><strong>Signature failures, as their own series.</strong> A steady trickle is somebody probing;
      a sudden cliff to 100% is a secret rotation nobody told you about.</li>
    </ul>
  </div>

  <p>And the review question: <strong>what happens to this event if the process dies immediately after we
  return 200?</strong> If the answer is "it is lost", the acknowledgement is a promise you cannot
  keep.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"HTTPS means the request is authenticated"</h4>
    <p>TLS encrypts the channel and proves your identity to the caller. It says nothing about who is
    posting to your public URL.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"The timestamp window is replay protection"</h4>
    <p>Measured: a replay inside the window was accepted three times out of three. The window bounds age;
    only the event id bounds repetition.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Checking the id before writing it is good enough"</h4>
    <p>22 applications for 20 events. Two operations with a gap is a race, and a retry storm is when many
    duplicates arrive at once.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Recording the event id before doing the work is the safe order"</h4>
    <p>It is the one that loses events silently. Measured: 0 charges applied, and the redelivery
    correctly skipped as a duplicate.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Binding the model and then verifying is equivalent"</h4>
    <p>Binding consumes the stream. The handler then verifies zero bytes, and nothing warns.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Reading the body as a string is fine — it is JSON, so it is text"</h4>
    <p>A UTF-8 BOM is stripped by <code>StreamReader</code>, so 97 bytes were signed and 94 verified. The
    signature is over bytes.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Returning 202 means we handled it"</h4>
    <p>It means you promised to. If the event is only in memory when you send it, the promise fails on
    the next deploy — measured at eight events lost with nothing recorded.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A duplicate deserves a 409"</h4>
    <p>Most senders read 4xx as permanent and may disable your endpoint. Answer 200: you do have it.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Every failure in this module is silent on at least one side</h4>
    <p>The sender's dashboard said failing while ours said 200. The lost events had a 202. The stalled
    claim had a completed-looking record and a zero error rate. <strong>There is no single view of a
    webhook</strong>, and every diagnosis in this module came from comparing two counts across an
    organisational boundary rather than from reading a log.</p>
  </div>

  <p>The second reason is that a receiver is a privileged endpoint with no authentication in front of it.
  Everything above the signature check runs for anybody who finds the URL, and parsing before verifying
  measured at nearly thirty times the cost of rejecting first. The habit of putting cheap, fixed-cost
  checks first is not a webhook idea — it is how any untrusted input should be handled — but a webhook is
  where most services first meet it.</p>

  <p>The third is that fast acknowledgement moves a responsibility permanently. It is the right trade and
  it is why the incident's fix worked, but the instant you answer 200 the sender's retries are gone. Every
  safety net after that point is one you built: the durable write, the claim state, the sweep. A receiver
  that acknowledges quickly and has none of those has not made the system faster, it has made the failures
  quieter.</p>

  <p>And the fourth is symmetry. The sending module ended on queue age — the oldest undelivered event. This
  one ends on the age of the oldest pending claim. <strong>On both sides of the wire the thing to watch is
  the work nobody has finished, and on both sides it is the number nobody has.</strong></p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>One malformed event — a field your parser cannot read — was redelivered fourteen times over
    twenty-three hours. It failed identically every time, and paged on-call twice.</p>
    <p>What did the handler return, and what should it have returned?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   what the handler returns      the sender's reaction         attempts
   ------------------------      ---------------------         --------
   200 OK                        done, never send it again            1
   400 Bad Request               our fault, stop retrying             1
   409 Conflict                  our fault, stop retrying             1
   500 Internal Server Error     their fault, retry            up to 14</code></pre>
        <p>It returned 500, and a malformed event is not a 500. A 5xx says "this failed because of us and
        might work next time". A payload you cannot parse will never work next time, so every retry is
        guaranteed waste.</p>
        <p>The status code is an instruction to a retry loop, and there are only three things you can
        say: <strong>2xx</strong> — I have this, stop; <strong>4xx</strong> — this will never work, stop
        and tell a human; <strong>5xx</strong> — I am broken right now, try again.</p>
        <p>A duplicate is a 200, not a 409. The sender is retrying because it is not sure you got it; you
        did, so tell it so. A 409 reads as permanent in most senders' books and can disable your
        endpoint.</p>
        <p>And an unparseable event still has to go somewhere. Returning 400 stops the retries and drops
        the event — nobody will ever send it again. <strong>So the 400 is correct only if you have also
        stored the raw bytes for a human</strong>, otherwise you have chosen silent data loss over noisy
        retries, which is the worse of the two.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>Your receiver deduplicates on the event id and it works perfectly in testing. In production,
    roughly one event in three is processed twice. You run three instances behind a load balancer.</p>
    <p>Why one in three?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   where the seen-ids live       instances   events   times applied
   ---------------------       ---------   ------   -------------
   in each instance's memory           3       30              48
     of 30 events, both deliveries landed on the same instance 12 times
   in one shared store                 3       30              30</code></pre>
        <p>The dedupe store is per-instance, so it only works when both deliveries of an event happen to
        land on the same instance. With three instances that is one time in three — measured as 12 of 30
        — and the other two thirds are processed twice.</p>
        <p>It works in testing because testing runs one instance. The bug is not in the logic; it is in
        an assumption the logic quietly makes, and no single-process test can see it.</p>
        <p><strong>A duplicate rate that matches your instance count is the clue that names the
        cause.</strong> It is almost always per-instance state — a cache, a rate limiter, a set of seen
        ids, an in-memory lock.</p>
        <p>And the fix is not sticky sessions. Pinning a sender to an instance makes duplicates rarer and
        keeps the bug: the instance restarts, or scales, or the pin expires between the attempt and the
        retry — which, with a six-hour backoff, it certainly will. The seen-ids set is shared state, and
        it belongs in the database the work commits to.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>Your webhook endpoint is public and correctly rejects anything without a valid signature. A load
    test from an unauthenticated address still took the service down.</p>
    <p>What work is an unauthenticated caller able to make you do?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   payload size                                 23,731 bytes

   order of operations           200 unsigned requests cost
   ------------------           --------------------------
   parse and log, then verify                    435 ms
   verify, then parse                             15 ms
   ratio                                        29.9x</code></pre>
        <p>Everything that happens before the signature check. Parsing is the expensive one, and it is
        the one that reads most naturally at the top of a handler, because the parsed object is what
        everything below it wants.</p>
        <p>The signature check is cheap and fixed — one HMAC over the bytes, regardless of what those
        bytes contain, which is exactly the property you want in the first thing an untrusted request
        touches.</p>
        <p>So the order is <strong>length limit, timestamp, signature, and only then parse</strong>. The
        length limit comes first because the HMAC is itself linear in body size, so a 500 MB body is
        still work you are doing for a stranger. Kestrel's default <code>MaxRequestBodySize</code> of
        30 MB is a backstop, not a webhook limit — a real event is kilobytes.</p>
        <p>And logging the body is part of the problem, not the diagnosis. An unverified payload written
        to a log is an anonymous caller filling your disk and putting their text in front of your
        operators.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>The receiver verifies, records the event id, returns 200, and hands the work to a background
    worker. Idempotency is solid — nothing is ever processed twice. Occasionally an event is never
    processed at all, and nothing anywhere reports it.</p>
    <p>Where does it go?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   claim records                  events   completed   lost   redelivery
   -------------                  ------   ---------   ----   ----------
   seen / not seen                    10           7      3   never - it has a 200
   pending -&gt; done, swept             10           7      3   swept locally, 3 recovered</code></pre>
        <p>The claim records arrival, not completion. "Seen" is written the moment the event lands, so an
        event whose work never finished is indistinguishable from one that finished perfectly. The dedupe
        check then does its job flawlessly and skips it forever.</p>
        <p>And the sender cannot help, because you returned 200. That was the right answer at the time
        and it moved the responsibility to you permanently. <strong>Fast acknowledgement is a transfer of
        liability</strong>: from the instant you send it, the sender's retries are gone and every
        remaining failure is yours to detect.</p>
        <p>So the claim needs a state and a clock, not a bit. Pending on arrival, done on completion, and
        a sweep that finds anything pending for longer than the work should take. A duplicate arriving
        while one is pending is answered 200 and dropped — the first one is still going.</p>
        <p>The metric that catches it is the age of the oldest pending claim. Not the failure rate, which
        is zero, and not the processed count, which looks healthy. This is the same shape as queue age on
        the sending side: <strong>the thing to watch is the work nobody has finished, and on both sides
        of the wire it is the number nobody has.</strong></p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>Why must a webhook handler take <code>HttpRequest</code> rather than a bound model?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Binding consumes the body before the handler's first line. Measured:
        94 bytes arrived, 0 bytes left for the handler, and nothing warns.</p></div>
      </details></li>

    <li><p>What does <code>EnableBuffering</code> do, and when must it be called?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It swaps in a rewindable stream so the body can be read more than
        once. It must be called before anything reads, and the position reset afterwards.</p></div>
      </details></li>

    <li><p>Why verify the raw bytes rather than a decoded string?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Decoding is a transformation with edge cases. A UTF-8 BOM is
        stripped by <code>StreamReader</code>, so 97 bytes signed became 94 bytes verified — and it fails
        for one partner and nobody else.</p></div>
      </details></li>

    <li><p>Why is the timestamp checked before the signature?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A replay carries a perfectly valid signature — that is what makes it
        a replay rather than a forgery. Freshness and authorship are different questions, and no
        cryptography separates a replay from the original.</p></div>
      </details></li>

    <li><p>Why does nothing get parsed before the signature verifies?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Everything before the check is work an anonymous caller gets free.
        Parse-then-verify measured 29.9x the cost of verify-then-parse on 200 unsigned requests.</p></div>
      </details></li>

    <li><p>Why is "check the id, then record it" wrong?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Two operations with a gap. Measured 22 applications for 20 events; an
        atomic insert against a unique constraint gave exactly 20.</p></div>
      </details></li>

    <li><p>What happens if you record the claim, then crash, then get redelivered?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The event is lost permanently and silently. The redelivery is
        correctly recognised as a duplicate and skipped — 0 charges applied, and the sender's log says
        delivered.</p></div>
      </details></li>

    <li><p>What is the only crash-safe ordering?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The claim and the work in one transaction, which means the dedupe
        store must live in the same database as the work.</p></div>
      </details></li>

    <li><p>Why did 20 events become 60 deliveries and 60 charges?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>900 ms of work inside the handler against a sender timeout of 500 ms.
        Exceeding a sender's budget does not fail, it retries — slow degrades into duplicate.</p></div>
      </details></li>

    <li><p>What makes a 202 an honest answer?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>A durable write before it. Acknowledging into an in-memory queue lost
        eight of twelve events on a routine deploy, with nothing recorded and no retry coming.</p></div>
      </details></li>

    <li><p>What should a duplicate return, and why not 409?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>200. The sender is asking whether you have it and you do. Most
        senders read 4xx as permanent and may disable the endpoint.</p></div>
      </details></li>

    <li><p>Why does a claim need a state rather than a bit?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>"Seen" cannot tell a finished event from one whose worker died
        holding it. Pending-to-done plus a sweep recovered all three stalled events; the bit lost them
        forever, because the sender already had its 200.</p></div>
      </details></li>
  </ol>
</section>
`
});
