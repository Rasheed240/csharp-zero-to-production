CSPREP.module({
  id: "t3-17-file-upload",
  minutes: 55,
  updated: "2026-09-06",
  summary: "A receipts API filled its disk with 480,000 abandoned partial files over six weeks while every dashboard stayed flat, because a size limit reached clients as a closed connection rather than a status code and their retry policies read that as transient. Buffered against streamed uploads measured to the millisecond, the two limits that live in different places, why Path.GetFileName is not the sanitiser it is sold as - '..' goes straight through it - and the constraint that shapes every polite refusal: the body-size limit cannot be changed once you have started reading.",
  terms: ["multipart/form-data", "boundary", "IFormFile", "MultipartReader", "buffering", "streaming",
    "spooling", "MaxRequestBodySize", "MultipartBodyLengthLimit", "MemoryBufferThreshold",
    "file signature", "magic bytes", "content sniffing", "path traversal", "Content-Disposition",
    "chunked transfer encoding", "Expect: 100-continue", "pre-signed URL"],
  html: `<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>A receipts API accepts a photograph from a mobile app. The endpoint is four lines and it is the
  endpoint everybody writes:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and it ran in production for eight months"><code>app.MapPost("/v1/receipts", async (IFormFile file) =&gt;
{
    string path = Path.Combine(storage, file.FileName);

    await using FileStream target = File.Create(path);
    await file.CopyToAsync(target);

    return Results.Ok();
});</code></pre>

  <p>At 02:14 on a Saturday the service began failing readiness checks. By 02:31 every endpoint in the
  application was returning 500, including the ones that touch nothing but memory. The database was
  healthy. The volume holding uploads was at 100%, with 480,000 files on it named with a GUID and the
  extension <code>.partial</code>.</p>

  <p>At 09:00 the upload graph was normal. Requests per second was normal. The 4xx rate was normal.
  Nothing on any dashboard had moved, during or before.</p>

  <p>Four separate decisions in those four lines produced that, and not one of them was made
  deliberately:</p>

  <pre data-lang="console" data-title="00-smallest.cs output"><code>   ordinary upload   200  {"fileName":"receipt.jpg","contentType":"image/jpeg","length":24,...}

   Four things that endpoint has already decided, none of them deliberately:

   a filename with a path   200  {"fileName":"../../escaped.txt",...}
   a program called .jpg    200  {"fileName":"harmless.jpg","contentType":"image/jpeg",...}
   a 40 MB file             the request failed: HttpRequestException

   what the SERVER answered   200, 200, 200, 413</code></pre>

  <p>The client's filename became part of a path. The client's content type was believed. A size limit
  nobody chose was enforced at a layer nobody had looked at, and it reached the client as a network
  error rather than as the 413 the server actually sent. And the whole file was read off the socket
  before the handler ran at all, which is why none of the other three could be caught early.</p>

  <div class="callout callout--note">
    <h4>None of this is a bug in ASP.NET Core</h4>
    <p>Every one of those four is a decision the framework cannot make for you. It has no way to know
    whether you want the client's filename, which formats you accept, how large an upload should be,
    or whether you would rather have the bytes as they arrive. Each is defaulted to whatever costs
    least to implement, and each default is wrong for something.</p>
  </div>

  <p>This module is about making all four deliberately, and about a fifth thing that only shows up
  once you try: a refusal is worth nothing if the client cannot hear it.</p>
</section>

<section id="what-an-upload-is">
  <h2>What an upload actually is</h2>

  <p class="define"><span class="define__term">multipart/form-data</span> A request body format that
  packs several named values, some of them files, into one body. Each value is a <em>part</em>,
  separated from the next by a delimiter string.</p>

  <p class="define"><span class="define__term">Boundary</span> The delimiter string separating parts.
  It is chosen by the client and announced in the <code>Content-Type</code> header, so that the server
  knows where each part ends without being told a length.</p>

  <p class="define"><span class="define__term">Content-Disposition</span> A header on each part
  carrying the field name and, for a file, the filename the client claims. This is where
  <code>file.FileName</code> comes from: it is a string in a header, typed by whoever wrote the
  client.</p>

  <p class="define"><span class="define__term">Buffering</span> Reading something to its end before
  doing anything with it. A buffered upload exists in full - in memory or in a temporary file - before
  your code sees it.</p>

  <p class="define"><span class="define__term">Streaming</span> Processing something as it arrives.
  A streamed upload reaches you in pieces, while the rest of it is still on the wire.</p>

  <p class="define"><span class="define__term">Spooling</span> Moving buffered data to a temporary file
  once it exceeds a memory threshold. ASP.NET Core spools any part larger than 64 KB by default.</p>

  <p>A multipart body is a plain-text envelope. Written out, an upload of one photograph and one form
  field looks like this:</p>

  <pre data-lang="text" data-title="One multipart body, on the wire"><code>POST /v1/receipts HTTP/1.1
Content-Type: multipart/form-data; boundary=----Boundary7MA4YWx
Content-Length: 24601

------Boundary7MA4YWx
Content-Disposition: form-data; name="date"

2026-09-06
------Boundary7MA4YWx
Content-Disposition: form-data; name="file"; filename="receipt.jpg"
Content-Type: image/jpeg

&lt;the bytes of the file&gt;
------Boundary7MA4YWx--</code></pre>

  <p>Three things in that envelope are worth naming, because all three are claims:</p>

  <ul>
    <li><code>filename="receipt.jpg"</code> is a string the client wrote. It is not checked against
    anything and it need not be a filename at all.</li>
    <li><code>Content-Type: image/jpeg</code> is also a string the client wrote. It describes what the
    client believes it is sending.</li>
    <li><code>Content-Length</code> is the client's declaration of how big the whole body is. A client
    that is streaming a file it has not finished reading may omit it entirely - which turns out to
    matter a great deal.</li>
  </ul>

  <p>The bytes between the boundaries are the only part of the request that is not a claim, and
  everything in this module follows from that.</p>

  <h3>An analogy, and where it stops working</h3>

  <p>A multipart body is a parcel with several items inside, each wrapped in a label. The label says
  what the item is called and what the sender thinks it is. Customs opens the parcel, reads the labels,
  and puts the items on the shelf under the names on the labels.</p>

  <p>The analogy holds for the shape and fails on the important point: a real customs officer would
  <em>look inside</em>. The default handler does not. It reads the label, files the item under that
  name, and never opens it. Every failure in this module is a version of trusting the label.</p>
</section>

<section id="where-the-file-is">
  <h2>Where the file is by the time you see it</h2>

  <p>The single most consequential thing about <code>IFormFile</code> is not in its API. It is
  <em>when</em> your handler runs. Sending an upload slowly and recording the moment each handler gets
  control answers it directly:</p>

  <pre data-lang="console" data-title="01-buffered-vs-streamed.cs output"><code>   endpoint    upload sent over   handler got control after   status
   --------    ----------------   -------------------------   ------
   /buffered             614 ms                      589 ms   200
   /streamed             488 ms                        3 ms   200</code></pre>

  <p>Both endpoints received the same 16 MB, sent in 32 chunks with a pause between them. The buffered
  handler began after the last chunk arrived. The streamed one had the first bytes three milliseconds
  in, with the rest of the file still in flight.</p>

  <p class="define"><span class="define__term">IFormFile</span> A file that has already been received
  in full. Binding a handler parameter to it instructs the framework to read the entire request body,
  spool anything over 64 KB to a temporary file, and only then invoke your code.</p>

  <p>Three consequences follow from that timing, and they are the reason this matters:</p>

  <ul>
    <li><strong>A rejected file was still received in full.</strong> You cannot refuse a 200 MB video
    after reading eight bytes of it, because there is no point at which you are asked.</li>
    <li><strong>The request held a connection for the whole upload</strong> before any validation ran.
    A slow client is a held connection, and a hundred slow clients are a hundred of them.</li>
    <li><strong>The bytes went somewhere.</strong> Anything over 64 KB is on your disk, in a temporary
    file the framework owns, for the duration of the request.</li>
  </ul>

  <p>Reading the body yourself removes all three. <code>MultipartReader</code> hands you each part as a
  stream and nothing is buffered on your behalf:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>app.MapPost("/v1/receipts", async (HttpContext context) =&gt;
{
    // DECISION 1: this endpoint enforces its own limit, and it must say so
    // BEFORE the first read - the framework's limit cannot be changed once
    // reading has begun, so there is no recovering from it later.
    context.Features.Get&lt;IHttpMaxRequestBodySizeFeature&gt;()!.MaxRequestBodySize = null;

    if (!context.Request.HasFormContentType
        || !MediaTypeHeaderValue.TryParse(context.Request.ContentType, out MediaTypeHeaderValue? media)
        || string.IsNullOrEmpty(HeaderUtilities.RemoveQuotes(media.Boundary).Value))
    {
        return Problem(StatusCodes.Status415UnsupportedMediaType,
            "Unsupported content type",
            "Send the receipt as multipart/form-data with a single file part.");
    }

    string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value!;
    var reader = new MultipartReader(boundary, context.Request.Body);</code></pre>

  <pre data-lang="console" data-title="01-buffered-vs-streamed.cs output"><code>   upload size     status   bytes written   framework temp files used
   -----------     ------   -------------   -------------------------
          8 MB     200             8.0 MB   0
         32 MB     200            32.0 MB   0
         64 MB     200            64.0 MB   0</code></pre>

  <p>The file went from the socket to its destination through an 8 KB buffer, once. It was never a
  <code>byte[]</code> and never a temporary file that the framework created and then deleted.</p>

  <div class="callout callout--note">
    <h4>The real prize is not the memory</h4>
    <p>The allocation saving is real, and it is the smaller half. What streaming actually buys is
    that <em>you are in the loop while the bytes arrive</em>, which is the only position from which
    you can refuse a file cheaply, check its contents before writing any of it, or stop at a size
    limit of your own choosing. Every technique in the rest of this module requires being there.</p>
  </div>

  <p>None of which makes <code>IFormFile</code> wrong. It makes it a choice with a size attached. For a
  50 KB CSV on an internal admin page, buffering is free and the code is four lines shorter. For
  anything user-facing, unbounded, or large, it is the wrong end of a trade you did not know you were
  making.</p>
</section>

<section id="the-two-limits">
  <h2>The two limits, which live in different places</h2>

  <p class="define"><span class="define__term">MaxRequestBodySize</span> Kestrel's limit on the entire
  request body, 30 MB by default. It is enforced by the server, below your application.</p>

  <p class="define"><span class="define__term">MultipartBodyLengthLimit</span> A limit on one multipart
  part, 128 MB by default, enforced by the form-reading code when you bind to
  <code>IFormFile</code>.</p>

  <p>They are configured in different places, produce different errors, and setting one without the
  other moves the failure rather than removing it:</p>

  <pre data-lang="console" data-title="01-buffered-vs-streamed.cs output"><code>   configuration                         12 MB upload   what happened
   -----                                 ------------   -------------
   both defaults                          200
   Kestrel 10 MB                          connection     BadHttpRequestException
   Kestrel 100 MB, multipart 10 MB        400            InvalidDataException
   Kestrel 100 MB, multipart 100 MB       200            </code></pre>

  <p>Note the second and third rows carefully. Both are the same policy - "10 MB is too big" - and they
  fail completely differently. Kestrel's limit closes the connection; the multipart limit throws inside
  your application and produces a 400.</p>

  <pre data-lang="csharp" data-net="10" data-title="Setting both, which is what a real limit takes"><code>builder.WebHost.ConfigureKestrel(o =&gt;
    o.Limits.MaxRequestBodySize = 8L * 1024 * 1024);

builder.Services.Configure&lt;FormOptions&gt;(o =&gt;
{
    o.MultipartBodyLengthLimit = 8L * 1024 * 1024;

    // Anything larger than this goes to a temporary file rather than
    // staying in memory. The default is 64 KB.
    o.MemoryBufferThreshold = 64 * 1024;
});</code></pre>

  <div class="callout callout--gotcha">
    <h4>There is usually a third limit you do not control</h4>
    <p>A reverse proxy in front of the application has its own body limit -
    <code>client_max_body_size</code> in nginx, defaulting to 1 MB. An upload can be refused before it
    ever reaches your server, with an error page you did not write. When a limit's behaviour does not
    match anything in your configuration, the limit is not in your configuration.</p>
  </div>
</section>

<section id="what-the-bytes-say">
  <h2>What the client claims and what the bytes say</h2>

  <p class="define"><span class="define__term">File signature</span> The leading bytes that identify a
  file format. A JPEG starts <code>FF D8 FF</code>; a PNG starts with an eight-byte sequence; a PDF
  starts with the ASCII <code>%PDF</code>. Also called <em>magic bytes</em>.</p>

  <p>An upload arrives with three descriptions of itself, two of which the client wrote. Here is what
  happens when they disagree:</p>

  <pre data-lang="console" data-title="02-what-the-bytes-say.cs output"><code>   filename        content type              bytes say   extension agrees
   --------        ------------              ---------   ----------------
   receipt.jpg     image/jpeg                jpeg        yes
   receipt.jpg     image/jpeg                exe         NO
   invoice.pdf     application/pdf           pdf         yes
   photo.png       image/png                 pdf         NO
   archive.zip     application/zip           zip         yes
   scan.jpg        application/octet-stream  jpeg        yes
   notes.txt       text/plain                unknown     -
   logo.png        image/png                 png         yes</code></pre>

  <p>Three rows disagree and they disagree in different ways. <code>receipt.jpg</code> is an executable
  whose two client-supplied fields both say image. <code>photo.png</code> is a PDF, which is nothing
  more sinister than a user picking the wrong file. And <code>scan.jpg</code> is a genuine image whose
  content type is the generic default - so a service that validates on content type refuses the real
  image and accepts the executable, which is exactly backwards.</p>

  <p>Which makes the usual check the wrong one:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - validates a string the client typed"><code>if (file.ContentType != "image/jpeg" &amp;&amp; file.ContentType != "image/png")
{
    return Results.BadRequest("Images only.");
}</code></pre>

  <p>The check itself is short enough to read in full:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>}

// ---------------------------------------------------------------------------
static string Sniff(ReadOnlySpan&lt;byte&gt; head)
{
    if (head.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }))
    {
        return "jpeg";
    }

    if (head.StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
    {
        return "png";
    }

    if (head.StartsWith("%PDF"u8))
    {
        return "pdf";
    }

    return "unknown";
}</code></pre>

  <div class="callout callout--warn">
    <h4>What a signature check is not</h4>
    <p>It is a cheap way to catch a mismatch between what a file claims and what it is, from the first
    few bytes, before you have read the rest. It is <em>not</em> proof the file is safe. A file can
    begin with a valid JPEG signature and still be malformed, enormous, or crafted to break whatever
    decodes it later. Signature detection answers "is this plausibly the format claimed", which is a
    much smaller question than "is this safe".</p>
    <p>And plain text, CSV, JSON and XML have no signature at all. A policy of "reject what I cannot
    identify" rejects every text file you accept.</p>
  </div>

  <h3>Checking before you have the whole file</h3>

  <p>Both a signature check and a size limit can run while the upload is arriving, which means both can
  refuse early instead of after:</p>

  <pre data-lang="console" data-title="02-what-the-bytes-say.cs output"><code>   upload                          verdict            bytes read before deciding
   ------                          -------            --------------------------
   a real image, under the limit   accepted           2.0 MB
   an executable named .jpg        rejected: type     4 bytes
   a real image, over the limit    rejected: size     8.0 MB</code></pre>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the count is checked after the read finishes"><code>while ((read = await section.Body.ReadAsync(buffer)) &gt; 0)
{
    total += read;
    await target.WriteAsync(buffer.AsMemory(0, read));
}

// Reached only once the entire upload has been received and written.
if (total &gt; limit)
{
    return Results.StatusCode(413);
}</code></pre>

  <p>The executable was refused after four bytes. The oversized file was refused at the limit rather
  than at the end, because the count is checked <em>inside</em> the read loop. Moving that check below
  the loop compiles, passes the same test, and reads the entire upload before rejecting it - which is
  the failure the limit existed to prevent.</p>

  <p>Order the checks by cost: the declared length first, since a claim of 4 GB is a refusal you can
  issue before reading anything; then the signature, from the first bytes; then the running count,
  every iteration. Anything needing the whole file - a virus scan, decoding the image, parsing the
  PDF - goes last, and ideally not in the request at all.</p>
</section>

<section id="names-and-paths">
  <h2>Names, paths, and one piece of advice that is wrong</h2>

  <p class="define"><span class="define__term">Path traversal</span> Using <code>..</code> segments in
  a client-supplied name to reach a directory the application did not intend to write to.</p>

  <p>The standard advice is to pass the client's filename through <code>Path.GetFileName</code> and use
  the result:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - and it is the advice you will be given in review"><code>string safe = Path.GetFileName(file.FileName);
string path = Path.Combine(uploadRoot, safe);

await using FileStream target = File.Create(path);
await file.CopyToAsync(target);</code></pre>

  <p>Here is what that call actually returns, and what happens when you build a path from the
  result:</p>

  <pre data-lang="console" data-title="02-what-the-bytes-say.cs output"><code>   client filename                GetFileName gives        combined path escapes
   ---------------                -----------------        ---------------------
   'receipt.jpg'                  'receipt.jpg'            no
   '../../escaped.txt'            'escaped.txt'            no
   '..\..\escaped.txt'            'escaped.txt'            no
   'C:\Windows\Temp\evil.txt'     'evil.txt'               no
   '/etc/passwd'                  'passwd'                 no
   '..%2F..%2Fescaped.txt'        '..%2F..%2Fescaped.txt'  no
   'CON'                          'CON'                    no
   'report.txt.'                  'report.txt.'            no
   'report .txt'                  'report .txt'            no
   ''                             ''                       YES
   '..'                           '..'                     YES
   'abbbbbbbbbbbbbbbbbbbbbbbb...' 'abbbbbbbbbbbbbbbbbbbb...' no</code></pre>

  <p>The traversal rows do collapse, so on that count the advice is correct. Look at the two rows
  that say <strong>YES</strong>.</p>

  <p><code>Path.GetFileName("..")</code> returns <code>".."</code>. It is a leaf, not a directory part,
  so there is nothing to strip - and combining it with the root puts you in the parent directory. The
  advice is offered as an answer to "does the path escape", and there is a two-character input for
  which it answers that question incorrectly.</p>

  <p>It also decodes nothing. <code>'..%2F..%2Fescaped.txt'</code> comes back unchanged, which is
  correct as far as it goes - that is a filename containing percent signs, not a traversal. It becomes
  one the moment something downstream URL-decodes it, which a web server handing the file back may
  well do. A name is only safe with respect to the layer that handles it next.</p>

  <p>The empty string escapes in a quieter way: <code>Path.Combine(root, "")</code> is the root itself,
  a directory rather than a file inside it, so every subsequent write throws.</p>

  <div class="callout callout--gotcha">
    <h4>And the result is platform-dependent</h4>
    <p>On Windows both <code>/</code> and <code>\</code> are separators, so both traversal rows above
    collapse. On Linux, backslash is an ordinary filename character:
    <code>Path.GetFileName(@"..\..\escaped.txt")</code> returns the whole string, backslashes
    included. That does not escape on Linux - but code that passes it on to something Windows-side
    (an SMB share, a zip entry, a client that re-saves it) hands a traversal to a system that reads
    it as one.</p>
  </div>

  <p>The survivors break other things. Windows silently strips a trailing dot, so a file written as
  <code>report.txt.</code> is stored as <code>report.txt</code>; a database row keyed on the name the
  client sent will never find it again. That is a data bug rather than a security bug, and it is the
  more likely of the two to reach production.</p>

  <pre data-lang="console" data-title="02-what-the-bytes-say.cs output"><code>   'CON'            written, and listed under that name
   'report.txt.'    WRITTEN UNDER A DIFFERENT NAME
   'report .txt'    written, and listed under that name
   '..'             UnauthorizedAccessException
   'ordinary.txt'   written, and listed under that name</code></pre>

  <p>Two of those rows are worth a moment. <code>CON</code> - a reserved Windows device name - wrote a
  real file and listed under that name, which is not what the folklore says; the lesson is not that
  reserved names are fine, but that a rule you inherited about filenames may not be true of the runtime
  you are on, and it takes four lines to find out rather than assume. And <code>..</code> threw
  <code>UnauthorizedAccessException</code>, which is the escape from the table above arriving as a
  confusing error: the write targeted a directory, and the exception names permissions instead of
  saying so.</p>

  <h3>The approach that holds</h3>

  <p>Every problem above comes from one decision: letting a client-supplied string become part of a
  path. Stop doing that and the whole class disappears, including the cases nobody has thought of
  yet.</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - the name on disk contains nothing a client typed"><code>// On disk: a name you generate.
string id = Guid.NewGuid().ToString("n");
string partial = Path.Combine(root, $"{id}.partial");

// In the row: the client's filename, as data. It is shown back to the
// user and used in Content-Disposition on download. It never builds a path.
stored.Add(new Receipt(id, claimed, format, written));</code></pre>

  <p>And a second line that costs nothing: after building the path, check it is where you think it
  is.</p>

  <pre data-lang="csharp" data-net="10" data-title="Right - verify the path even when you generated it"><code>string full = Path.GetFullPath(candidate);

if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
{
    throw new InvalidOperationException("outside the upload root");
}</code></pre>

  <p>Two details there are load-bearing. <code>GetFullPath</code> comes first, because it resolves the
  <code>..</code> segments - comparing an unresolved path proves nothing. And the trailing separator
  matters: without it, a root of <code>/data/uploads</code> accepts
  <code>/data/uploads-public/anything</code>, because the prefix matches.</p>

  <div class="callout callout--why">
    <h4>Keep the check even when it cannot fire</h4>
    <p>If you generate the name, the path can never escape and this check is dead code. Keep it
    anyway. It is the assertion that the rule above it is still true after somebody edits this method
    next year, and it costs one comparison per upload.</p>
  </div>
</section>

<section id="production-example">
  <h2>Realistic production example</h2>

  <p>One endpoint with all seven decisions made explicitly - its own size limit, a signature check
  before anything is written, a generated name, a verified path, and cleanup on every path out:</p>

  <pre data-lang="csharp" data-net="10" data-title="05-minimal-example.cs"><code>app.MapPost("/v1/receipts", async (HttpContext context) =&gt;
{
    // DECISION 1: this endpoint enforces its own limit, and it must say so
    // BEFORE the first read - the framework's limit cannot be changed once
    // reading has begun, so there is no recovering from it later.
    context.Features.Get&lt;IHttpMaxRequestBodySizeFeature&gt;()!.MaxRequestBodySize = null;

    if (!context.Request.HasFormContentType
        || !MediaTypeHeaderValue.TryParse(context.Request.ContentType, out MediaTypeHeaderValue? media)
        || string.IsNullOrEmpty(HeaderUtilities.RemoveQuotes(media.Boundary).Value))
    {
        return Problem(StatusCodes.Status415UnsupportedMediaType,
            "Unsupported content type",
            "Send the receipt as multipart/form-data with a single file part.");
    }

    string boundary = HeaderUtilities.RemoveQuotes(media.Boundary).Value!;
    var reader = new MultipartReader(boundary, context.Request.Body);

    // DECISION 2: the name on disk is generated. Nothing a client typed is
    // ever part of a path.
    string id = Guid.NewGuid().ToString("n");
    string partial = Path.Combine(root, $"{id}.partial");

    try
    {
        while (await reader.ReadNextSectionAsync() is { } section)
        {
            if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition,
                    out ContentDispositionHeaderValue? disposition)
                || !disposition.IsFileDisposition())
            {
                continue;
            }

            // The client's filename, kept as DATA. It is shown back to the
            // user and never used to build anything.
            string claimed = HeaderUtilities.RemoveQuotes(disposition.FileName).Value ?? "receipt";

            // DECISION 3: the first bytes decide the format, before the rest
            // of the file has arrived and before anything is written.
            byte[] head = new byte[8];
            int headRead = await ReadAtLeast(section.Body, head);
            string format = Sniff(head.AsSpan(0, headRead));

            if (format is not ("jpeg" or "png" or "pdf"))
            {
                return Problem(StatusCodes.Status415UnsupportedMediaType,
                    "Unsupported file type",
                    "Receipts must be a JPEG, PNG or PDF. The file's contents are none of those.");
            }

            // DECISION 4: the path is verified even though it was generated,
            // so that the rule above it stays true after somebody edits this.
            if (!Path.GetFullPath(partial).StartsWith(root + Path.DirectorySeparatorChar,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Storage path escaped the receipts root.");
            }

            long written;

            await using (FileStream target = File.Create(partial))
            {
                await target.WriteAsync(head.AsMemory(0, headRead));
                written = headRead;

                byte[] buffer = new byte[8192];
                int read;
                bool tooBig = false;

                while ((read = await section.Body.ReadAsync(buffer)) &gt; 0)
                {
                    written += read;

                    // DECISION 5: past the cap, keep READING and stop
                    // WRITING. Reading is what lets the client finish and
                    // hear the answer; writing is what would cost disk.
                    if (written &gt; MaxBytes)
                    {
                        tooBig = true;

                        continue;
                    }

                    await target.WriteAsync(buffer.AsMemory(0, read));
                }

                if (tooBig)
                {
                    return Problem(StatusCodes.Status413PayloadTooLarge,
                        "Receipt too large",
                        $"Receipts must be {MaxBytes / 1024 / 1024} MB or smaller.");
                }
            }

            // DECISION 6: the file becomes visible under its real name only
            // once it is complete. Until the move, nothing can find it.
            string final = Path.Combine(root, $"{id}.{ExtensionFor(format)}");
            File.Move(partial, final);

            stored.Add(new Receipt(id, claimed, format, written));

            return Results.Created($"/v1/receipts/{id}", new
            {
                id,
                originalFilename = claimed,
                format,
                bytes = written
            });
        }

        return Problem(StatusCodes.Status400BadRequest,
            "No file",
            "The request contained no file part.");
    }
    finally
    {
        // DECISION 7: the incomplete file is removed on every path out of
        // this method, including the ones that throw.
        if (File.Exists(partial))
        {
            File.Delete(partial);
        }
    }
}).DisableAntiforgery();</code></pre>

  <pre data-lang="console" data-title="05-minimal-example.cs output"><code>   what was sent                        response
   -------------                        --------
   a real JPEG                          201  created
   the same JPEG named '../../hack.sh'  201  created
   an executable named 'photo.jpg'      415  Unsupported file type
   a 6 MB JPEG, over the 4 MB cap       413  Receipt too large
   a text file                          415  Unsupported file type
   a form with no file part             400  No file

   ON DISK

     08b730baf71c4d39af4b1662fb390cae.jpg        65,540 bytes
     2c9ea1a046584fe891f8599d8ff7d0f5.jpg        65,540 bytes

   IN THE DATABASE

     id                                 original filename  format
     ---------------------------------- ------------------ ------
     2c9ea1a046584fe891f8599d8ff7d0f5   receipt.jpg        jpeg
     08b730baf71c4d39af4b1662fb390cae   ../../hack.sh      jpeg</code></pre>

  <p>Read those two blocks together, because the separation between them is the design. The upload
  called <code>../../hack.sh</code> was <em>accepted</em> - its bytes are a real JPEG and its name was
  never going to be used for anything. A hostile filename is not a reason to refuse a file; it is a
  reason not to use the filename. Meanwhile the client's string survived as data, and comes back in
  the <code>Content-Disposition</code> header on download, so the user never notices that it was not
  what the file was called.</p>

  <p>Every refusal is a status code rather than a closed connection, which takes the next section to
  explain.</p>

  <h3>Not receiving the file at all</h3>

  <p class="define"><span class="define__term">Pre-signed URL</span> A time-limited, single-purpose URL
  issued by an object store that lets a client upload directly to it, without the bytes passing through
  your application.</p>

  <p class="define"><span class="define__term">Sweeper</span> A background job that deletes temporary
  state left behind by work that did not finish - here, partial files older than some age.</p>

  <p>Everything above assumes the upload comes through your service. For large files it usually should
  not. The alternative is three steps: the client asks your API for permission, your API returns a
  pre-signed URL from the object store, and the client uploads there directly.</p>

  <pre data-lang="csharp" data-net="10" data-title="The shape of it - the API never touches the bytes"><code>app.MapPost("/v1/receipts/upload-url", (ClaimsPrincipal user) =&gt;
{
    string id = Guid.NewGuid().ToString("n");

    // Your authorisation, your naming, your limits - decided here, before
    // a single byte moves. The store enforces the rest.
    string url = objectStore.CreateUploadUrl(
        key: $"receipts/{id}",
        expires: TimeSpan.FromMinutes(5),
        maxBytes: 8L * 1024 * 1024);

    return Results.Ok(new { id, url });
});</code></pre>

  <p>What that buys is the whole of this module's failure surface: no connection held for the
  duration, no disk on your servers, no partial files, no limit reaching a client as a closed socket.
  What it costs is that <em>the file arrives without you seeing it</em>. Validation has to move to a
  notification the store sends after the upload completes, which means the receipt is unusable until
  that arrives, and the code that handles it is a background job rather than a handler.</p>

  <p>The signature check does not disappear - it moves. So does the decision about what happens to a
  file that fails it, which is now a stored object you must delete rather than a request you can
  refuse.</p>

  <div class="callout callout--note">
    <h4>What is deliberately absent</h4>
    <p>No virus scan: it needs the whole file and takes seconds, so it belongs in a background job with
    the receipt marked unavailable until it clears. No image decoding: decoding an image is running a
    parser on hostile input, and if you need dimensions or a thumbnail it should happen in a process
    that can be killed without taking the API with it. And no sweeper, because a sweeper cannot live
    in an endpoint - see the incident.</p>
  </div>
</section>

<section id="the-refusal">
  <h2>Getting a refusal to the client at all</h2>

  <p class="define"><span class="define__term">Chunked transfer encoding</span> Sending a body in
  self-describing pieces with no <code>Content-Length</code> header, used when the sender does not know
  the total size in advance.</p>

  <p class="define"><span class="define__term">Expect: 100-continue</span> A request header meaning
  "here are my headers; tell me whether to send the body". The server replies <code>100 Continue</code>
  to accept or a final status to refuse, before any of the body is sent.</p>

  <p>The incident in the next section turns on a fact that takes one line to state and that most
  people disbelieve: a size limit usually reaches the client as a broken connection rather than a
  status code. The obvious fix - check the size and return 413 before reading anything - does not
  work either. Measured three ways:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   server behaviour        client sends Expect: 100-continue   client saw
   ----------------        ---------------------------------   ----------
   /refuse-now             no                                  HttpRequestException
   /refuse-now             yes                                 413 RequestEntityTooLarge
   /refuse-after-draining  no                                  413 RequestEntityTooLarge
   /refuse-after-draining  yes                                 413 RequestEntityTooLarge</code></pre>

  <ul>
    <li><strong>Refusing immediately is the fastest and the client does not get it.</strong> You wrote
    a response while 12 MB was still arriving, and the connection is torn down before the client is in
    a position to read it. The handler was correct, the response was correct, and the client saw a
    network error. This is the fix most people write first, and it changes the server logs without
    changing the client's behaviour.</li>
    <li><strong>Draining the body first always delivers the 413.</strong> You read and discard the
    whole upload so the exchange completes normally, then answer. It costs the entire transfer to
    refuse it, and that is often the right price - a client that stops retrying is worth more than the
    bandwidth of one refusal.</li>
    <li><strong>Expect: 100-continue makes the problem disappear.</strong> Refusing costs nothing,
    arrives cleanly, and the body is never sent. The catch is that the client must opt in; you cannot
    make it happen from the server, and most HTTP clients do not do it by default.</li>
  </ul>

  <pre data-lang="csharp" data-net="10" data-title="One line, on the client, worth more than most of this module"><code>var request = new HttpRequestMessage(HttpMethod.Post, "/v1/receipts") { Content = content };
request.Headers.ExpectContinue = true;</code></pre>

  <div class="callout callout--warn">
    <h4>The decision has to be made before the first read</h4>
    <p>Catching the failure and draining afterwards does not work, and the exception says why:</p>
    <pre data-lang="console" data-title="03-production.cs output"><code>   files left on disk   0
   what the client saw  HttpRequestException
   what the drain did   InvalidOperationException: The maximum request body size
                        cannot be modified after the app has already started
                        reading from the request body.</code></pre>
    <p>By the time you know the upload is too big, it is too late to give yourself permission to
    finish reading it. An endpoint that intends to answer politely has to arrange that in advance -
    which is why the example above lifts the limit on its <em>first</em> line and counts bytes
    itself.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>The disk that filled while every graph stayed flat</h3>

  <p>The receipts API from the opening. Phones got better cameras, photos crossed the 8 MB limit, and a
  slice of users entered a retry loop nobody could see. Two measurements explain the whole incident.
  First, what the client saw and what the application recorded:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   upload size   handler ran   pipeline recorded   what the CLIENT saw
   -----------   -----------   -----------------   -------------------
          4 MB   True          200                 200 OK
         12 MB   True          nothing             HttpRequestException</code></pre>

  <p>The client's retry policy - the sensible, off-the-shelf one - treats a broken connection as
  transient and a 4xx as permanent. It retried, because it was told the network had failed.</p>

  <p>And the middle column is why the dashboards were flat. The handler <em>did</em> run, so this is
  not a request that Kestrel turned away before the application saw it. But the metrics middleware
  recorded nothing, because it is written the way almost all request instrumentation is written - call
  <code>next</code>, then record - and the failed read threw straight past the line that records.</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - counts only the requests that did not fail"><code>app.Use(async (context, next) =&gt;
{
    await next(context);

    // An exception from further down never reaches this line.
    metrics.Record(context.Request.Path, context.Response.StatusCode);
});</code></pre>

  <div class="callout callout--gotcha">
    <h4>This one is not about uploads</h4>
    <p>Any middleware that records after <code>await next(context)</code> records only the requests
    that did not throw. It is a metric that goes quiet precisely when things are going wrong, and it
    looks identical to a metric telling you everything is fine. The fix is a <code>try/finally</code>,
    and the reason to remember it is that the failure is invisible by construction.</p>
  </div>

  <p>Second, which attempts left a file behind - because only some of them did, and that is why it took
  six weeks:</p>

  <pre data-lang="console" data-title="03-production.cs output"><code>   how the client sent it        got as far as     files left   bytes on disk
   ----------------------        -------------     ----------   -------------
   with Content-Length           reading headers            0          0.0 MB
   chunked, no length header     opening the file           1          7.7 MB</code></pre>

  <p>With a <code>Content-Length</code>, Kestrel knows the body is too big before reading any of it, so
  the first read throws and the handler never reaches <code>File.Create</code>. Chunked, there is no
  declared length to check - Kestrel can only count, so the body streams in and the limit trips
  somewhere in the middle, by which point the handler has created its file and copied most of 8 MB into
  it.</p>

  <p>The handler that produced those 480,000 files is worth reading, because almost nothing about it
  is careless:</p>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - correct on the happy path, and only on the happy path"><code>string partial = Path.Combine(storage, $"{Guid.NewGuid():n}.partial");

while (await reader.ReadNextSectionAsync() is { } section)
{
    await using FileStream target = File.Create(partial);
    await section.Body.CopyToAsync(target);
}

// Never reached if the read above throws, and the file stays.
File.Move(partial, Path.ChangeExtension(partial, ".jpg"));</code></pre>

  <p>It streams rather than buffering. It writes to a temporary name and renames on success, so no
  half-written file is ever visible as a real receipt. Both are the recommended patterns. The bug is
  the absent <code>finally</code> - the path that ends without reaching the rename, which is the path
  nobody writes a test for.</p>

  <p>A client that loads the photo into memory first sends a length and leaks nothing. A client that
  streams it from the camera roll cannot know the length, sends it chunked, and leaks 8 MB per attempt.
  One app release changed how the file was read, and the leak began with no change on the server at
  all.</p>

  <div class="callout callout--why">
    <h4>The general form, which outlives the specific bug</h4>
    <p>A limit enforced on a <em>declared</em> value fails early and cheaply. The same limit enforced by
    <em>counting</em> fails late and halfway through whatever you were doing. Everything you do before
    that count is reached, you must be prepared to undo.</p>
  </div>

  <h3>Binding to IFormFile and validating afterwards</h3>

  <p>The check is written first in the method and runs last in reality:</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   endpoint            status   bytes the handler took delivery of
   --------            ------   ----------------------------------
   /import-buffered    400            20.0 MB
   /import-streamed    400             0.0 MB</code></pre>

  <p>Both returned 400. One of them read twenty megabytes, wrote a twenty-megabyte temporary file and
  deleted it, and held a connection throughout, to say no. A check is only cheap if it runs before the
  expensive thing.</p>

  <h3>Building a path from the client's filename</h3>

  <p>Covered above. The specific failure is less interesting than the general one: "it cannot escape
  the directory" and "it is safe to use as an identifier" are different claims, and
  <code>Path.GetFileName</code> establishes only the first - imperfectly.</p>

  <h3>Believing Content-Type</h3>

  <p>It is a string the client typed. Validating on it refuses honest clients that send
  <code>application/octet-stream</code> and accepts hostile ones that send whatever you asked for.</p>

  <h3>Trusting the extension you store</h3>

  <pre data-lang="csharp" data-net="10" data-bad="true" data-title="Wrong - the client chose what your server will serve this as"><code>string stored = $"{Guid.NewGuid():n}{Path.GetExtension(file.FileName)}";</code></pre>

  <p>The generated name is right and the extension undoes it. A file saved as <code>.html</code>
  because the client said so will be served as HTML by a static file handler, from your origin,
  containing whatever the uploader put in it. Derive the extension from the detected format, not from
  the claim.</p>

  <h3>No cleanup on the failure path</h3>

  <p>The incident. A handler that writes to a temporary name and renames on success is correct on the
  happy path and leaks on every other one. The <code>finally</code> handles the failures you thought
  of; a sweeper that deletes stale partial files handles the process killed between the write and the
  rename, which no <code>finally</code> can.</p>

  <h3>Doing expensive work in the request</h3>

  <p>Virus scanning, image decoding, PDF parsing and thumbnail generation all need the whole file and
  all run parsers over hostile input. In the request they turn one upload into a held connection and a
  crash surface. Store the file as unavailable, do the work in a background job, mark it available when
  it clears.</p>

  <h3>Forgetting the response side</h3>

  <p>The same buffering trap points outward. An export that builds the whole file in memory before
  returning it starts the client's clock only when the last row is formatted:</p>

  <pre data-lang="console" data-title="04-exercises.cs output"><code>   endpoint            server memory for the export   first byte to client
   --------            ----------------------------   --------------------
   /export-buffered                      35 MB                  81 ms
   /export-streamed                      18 MB                   2 ms</code></pre>

  <p>One mental model covers both directions: work that is buffered is work that has to finish before
  anything else can begin.</p>
</section>

<section id="debugging">
  <h2>How to debug it</h2>

  <p>Upload failures are unusually hard to diagnose because the most common ones happen <em>above</em>
  your code, where none of your logging is. A short decision procedure:</p>

  <ol>
    <li><strong>Did your handler run at all?</strong> Log the first line of the handler. Silence is
    evidence, not an absence of evidence - it locates the failure above the handler, which for an
    <code>IFormFile</code> parameter means during the body read.</li>
    <li><strong>What did the client see - a status code or a transport error?</strong> A transport
    error points at a limit being enforced by the server or a proxy mid-body. A status code means your
    application produced it and you can find it by reading code.</li>
    <li><strong>Does the size at which it fails match a default?</strong> 1 MB is nginx. 30 MB is
    Kestrel. 128 MB is <code>MultipartBodyLengthLimit</code>. A limit that matches a default is a limit
    nobody set.</li>
    <li><strong>Does it depend on how the client sends?</strong> Try the same file with and without a
    <code>Content-Length</code>. If the two behave differently, you are looking at the difference
    between a declared limit and a counted one, and the counted path is where partial state gets
    left.</li>
    <li><strong>What is on the disk?</strong> Count files and bytes in the upload directory before and
    after a failed attempt. A non-zero difference is a leak, and it is the only way to find one before
    it becomes an outage.</li>
  </ol>

  <div class="callout callout--debug">
    <h4>Four things to watch, learned the expensive way</h4>
    <ul>
      <li><strong>Free space and inode count on every writable volume</strong> - not only the
      database's. This incident was six weeks of a straight line on a graph nobody had.</li>
      <li><strong>The count and age of incomplete uploads.</strong> Under healthy operation it is near
      zero and seconds old.</li>
      <li><strong>Responses the client never received.</strong> Kestrel counts aborted connections;
      your request metrics do not. Where the two disagree are requests your service believes it
      answered and the caller believes failed.</li>
      <li><strong>The size distribution of accepted uploads, not the average.</strong> A percentile
      pressed against a hard limit is the shape of traffic being silently refused.</li>
    </ul>
  </div>

  <p>And one review question that is cheaper than all of them: <em>for every limit, what does the
  client see when it trips?</em> If the answer is "a closed connection", you have a limit that clients
  will retry against, and a retry loop is a load generator you installed yourself.</p>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>"Path.GetFileName sanitises the filename"</h4>
    <p>It strips the directory part, which handles the traversal cases people test. It returns
    <code>".."</code> unchanged, which escapes; it returns the empty string unchanged, which is the
    root itself; and it behaves differently on Windows and Linux for backslashes. Generate the
    name.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Checking the extension is enough for an internal tool"</h4>
    <p>The extension is a string the client typed, and "internal" is a property of today's network
    diagram. The signature check is four lines and does not depend on either.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"I set MaxRequestBodySize, so the limit is set"</h4>
    <p>If you bind to <code>IFormFile</code> there is a second limit in a different place with a
    different default and a different error. Setting one moves the failure.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Returning 413 immediately is the efficient way to refuse"</h4>
    <p>Measured above: the client gets a transport error and retries. Either drain the body first or
    get the client to send <code>Expect: 100-continue</code>. Efficiency that the caller experiences
    as a network fault is not efficiency.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"Streaming is a performance optimisation"</h4>
    <p>It is a control decision. The allocation saving is a side effect; what you actually gain is the
    ability to refuse a file before you have received it, which is a correctness property, not a speed
    one.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"A GUID filename means the file is private"</h4>
    <p>It means the URL is hard to guess. If the file is served from a public path with no
    authorisation check, an unguessable URL is the only thing protecting it, and unguessable URLs get
    shared, logged, and put in referrer headers.</p>
  </div>

  <div class="callout callout--myth">
    <h4>"We validate on upload, so the stored files are safe"</h4>
    <p>You validated the bytes at the moment they arrived, against the rules you had then. The file
    will be read later by a decoder, a scanner, a browser, and code nobody has written yet. Validation
    at the door is necessary and it is not the same as the file being safe.</p>
  </div>
</section>

<section id="why-it-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Uploads are how a web service acquires resources nobody is watching</h4>
    <p>Every other resource a request consumes is returned when the request ends: memory is collected,
    connections are released, threads go back to the pool. A file is not. It persists after the
    request, after the deployment, and after the person who wrote the handler has left. An upload
    endpoint is the one place where a single malformed request leaves something behind, which is why
    an upload bug shows up as a slow accumulation and then an outage, rather than as an error.</p>
  </div>

  <p>The second reason is that uploads are where the trust boundary is most plainly misplaced.
  Everywhere else in an API, you are careful about the values a caller sends. In an upload the caller
  sends a name, a type, a size, and a payload - and the default handler believes all four. The
  discipline this module asks for is a single question, applied to each of them: <em>who wrote
  this?</em></p>

  <p>The third is that the buffered/streamed distinction is not really about files. It is the same
  question as <code>IEnumerable</code> against <code>List</code>, lazy against eager, a cursor against
  a page - the recurring choice between processing something as it arrives and waiting for all of it.
  Uploads are where the cost of choosing wrongly is most visible, in milliseconds and megabytes, which
  makes them a good place to build the instinct.</p>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 1</span>
         <span class="pill pill--easy">Easy</span></div>
    <p>An endpoint accepts document uploads. It works on every developer machine and in the integration
    tests. In production, uploads over about 30 MB fail with no useful error, and the handler's
    logging - whose first line logs the filename - prints nothing at all.</p>
    <p>Where is the limit, and why does no log line appear?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   upload size   handler ran   result
   -----------   -----------   ------
         20 MB   True          200
         40 MB   False         HttpRequestException</code></pre>
        <p>The limit is Kestrel's <code>MaxRequestBodySize</code>, 30 MB by default, and nobody on the
        team set it - which is why it cannot be found by reading the endpoint. Nothing in those four
        lines mentions a size.</p>
        <p>The handler never ran, which is why there is no log line. A handler taking
        <code>IFormFile</code> does not begin until the whole body has been read, so a body refused
        during the read is refused before your first log statement. Silence in the handler's log is
        evidence rather than an absence of it: it locates the failure above the handler.</p>
        <p>It passed everywhere else because test fixtures use small files and developers upload the
        sample document in the repository. Nobody ever tested the limit, because nobody knew there was
        one to test.</p>
        <p>Raising it takes two settings, not one: Kestrel's <code>MaxRequestBodySize</code> for the
        whole request, and <code>FormOptions.MultipartBodyLengthLimit</code> if you bind to
        <code>IFormFile</code>. Setting one and not the other moves the error rather than removing
        it.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 2</span>
         <span class="pill pill--medium">Medium</span></div>
    <p>A profile service stores avatars under the uploaded filename, in a directory per user. Support
    reports a user opening their profile and seeing a photograph of someone else. The filename is
    passed through <code>Path.GetFileName</code>, so it cannot escape the directory - and it did
    not.</p>
    <p>What happened instead?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   user        uploaded as    stored at                        overwrote
   ----        -----------    ---------                        ---------
   user-1001   IMG_0001.JPG   user-1001\IMG_0001.JPG           no
   user-1002   IMG_0001.JPG   user-1002\IMG_0001.JPG           no
   user-1001   IMG_0001.JPG   user-1001\IMG_0001.JPG           YES</code></pre>
        <p>Nothing in that table is the bug. Every file landed in the right user's directory and
        nothing was overwritten across users - phones name every photo <code>IMG_0001.JPG</code>, but
        the per-user directory keeps them apart. The only collision is a user overwriting themselves,
        which is what an avatar is supposed to do.</p>
        <p>So the photograph came from downstream of storage. The likeliest cause is a cache keyed on
        the filename: a CDN or proxy asked to cache <code>/avatars/IMG_0001.JPG</code> has one entry
        for every user who owns a photo with that name. The filename is not unique and it has been
        made the cache key. A second candidate is a guessable URL - if the avatar is served from a
        path containing the filename, one user can request another's by name.</p>
        <p>The fix is the same one that fixes the path problems: a generated, unique name on disk and
        in the URL, with the original filename kept as data. The lesson is that "it cannot escape the
        directory" and "it is safe to use as an identifier" are different claims, and passing the
        filename through <code>GetFileName</code> establishes only the first.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 3</span>
         <span class="pill pill--medium">Medium-hard</span></div>
    <p>An endpoint accepts CSV imports up to 50 MB. It checks the extension and rejects anything that
    is not <code>.csv</code>. A load test sends 200 MB of <code>.exe</code> files, every one of which
    is rejected correctly with a 400, and the service falls over.</p>
    <p>Every request returned 400. Why did rejecting them cost anything?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   endpoint            status   bytes the handler took delivery of
   --------            ------   ----------------------------------
   /import-buffered    400            20.0 MB
   /import-streamed    400             0.0 MB</code></pre>
        <p>The buffered endpoint read all 20 MB before it was asked the question. Binding to
        <code>IFormFile</code> means the framework reads the whole body, spools anything over 64 KB to
        a temporary file, and only then invokes your handler - so your validation is the last thing
        that runs, no matter where you write it in the method.</p>
        <p>The cost per rejected request is therefore a full 20 MB transfer, a 20 MB temporary file
        written and deleted, and a connection held for the duration. Multiply by the concurrency and
        it is the disk, not the CPU, that gives way.</p>
        <p>The streamed endpoint answers from the multipart section headers, which arrive ahead of the
        bytes, so the rejection costs a few hundred bytes instead of twenty megabytes.</p>
        <p>The principle generalises well beyond uploads: a check is only cheap if it runs before the
        expensive thing. Validation written after the work has happened returns the right answer at
        the wrong price, and only a load test will tell you, because functionally it is perfect.</p>
        <p>And the extension check is still the wrong check - it is the client's string. Moving it
        earlier makes it cheap; it does not make it true.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head"><span class="exercise__num">Exercise 4</span>
         <span class="pill pill--hard">Hard</span></div>
    <p>A reporting service builds a CSV export and returns it. It has run for two years. This month,
    one customer's export started timing out at sixty seconds, and while it runs the service's memory
    doubles. The database query takes four seconds.</p>
    <p>Where do the other fifty-six go, and why does memory move at all?</p>
    <details class="reveal"><summary>Show worked solution</summary>
      <div class="reveal__body">
        <pre data-lang="console" data-title="04-exercises.cs output"><code>   endpoint            server memory for the export   first byte to client
   --------            ----------------------------   --------------------
   /export-buffered                      35 MB                  81 ms
   /export-streamed                      18 MB                   2 ms</code></pre>
        <p>(That run is scaled down to milliseconds; the customer's export was hundreds of times
        larger. The ratio is the claim.)</p>
        <p>The fifty-six seconds are spent building a string nobody is waiting to see the end of. The
        handler assembles the entire CSV in memory, then hands the finished object to the framework,
        which writes it. The client receives nothing until the last row is formatted.</p>
        <p>That is the same shape as <code>IFormFile</code>, pointing the other way. On the way in,
        buffering means your code starts after the last byte arrives. On the way out, it means the
        client starts after your last byte is produced. One mental model covers both: work that is
        buffered is work that has to finish before anything else can begin.</p>
        <p>The memory is worse than the table shows, because the buffered export holds the whole file
        <em>per concurrent request</em>. Ten customers exporting at once is ten copies. It survived two
        years because exports were small and rare, and both of those are properties of your customers
        rather than of your code.</p>
        <p>Nothing changed in the service this month. One account crossed a size that pushed the build
        past sixty seconds. The failure mode was always there, waiting for a large enough customer,
        which is the defining property of a limit you did not choose.</p>
        <p>Streaming fixes the timeout as well as the memory: a streamed response sends its first
        bytes immediately, so the proxy and the client see an active connection throughout, and a
        sixty-second idle timeout never fires on a connection that has never been idle.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li><p>By the time a handler taking <code>IFormFile</code> runs, where is the file?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Entirely received. It is in memory if it is under 64 KB and in a
        temporary file the framework owns if it is larger. The whole body was read off the socket
        before your first line ran.</p></div>
      </details></li>

    <li><p>Two size limits apply to a multipart upload. Name both, say where each is configured, and
      say what the client sees when each trips.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Kestrel's <code>MaxRequestBodySize</code> (30 MB by default, set
        on the web host) covers the whole request body and reaches the client as a closed connection.
        <code>FormOptions.MultipartBodyLengthLimit</code> (128 MB by default, set in services) covers
        one part, throws <code>InvalidDataException</code> inside the application, and produces a
        400.</p></div>
      </details></li>

    <li><p>Why does returning 413 as the first line of a handler often reach the client as a network
      error, and what are the two ways to fix it?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>You wrote a response while the body was still arriving, so the
        connection is torn down before the client is in a position to read it. Either drain the body
        to its end before answering, or have the client send <code>Expect: 100-continue</code> so the
        refusal happens before any body is sent.</p></div>
      </details></li>

    <li><p>Why can the body-size limit not be raised inside a <code>catch</code> block after it has
      already tripped?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It cannot be modified once reading has started -
        <code>InvalidOperationException</code> says so directly. The decision about what to do with an
        oversized upload has to be made before the first read, not when it fails.</p></div>
      </details></li>

    <li><p>Give an input for which <code>Path.GetFileName</code> does not prevent a path escaping the
      upload directory.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p><code>".."</code>. It is a leaf, so there is nothing to strip, and
        combining it with the root lands in the parent directory. The empty string is the other one -
        it resolves to the root itself.</p></div>
      </details></li>

    <li><p>Two clients upload the same oversized file to the same endpoint. One leaves a partial file
      on disk and the other does not. What is different about them?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Whether they sent a <code>Content-Length</code>. With one, the
        server knows the body is too big before reading any of it and the handler never reaches
        <code>File.Create</code>. Sent chunked, there is nothing to check in advance, so the limit
        trips by counting - halfway through, with a file already open.</p></div>
      </details></li>

    <li><p>Why does validating on <code>Content-Type</code> reject honest clients and accept hostile
      ones?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>It is a string the client typed. An honest client that does not
        know the type sends <code>application/octet-stream</code> and is refused; a hostile one sends
        whatever you asked for and is accepted.</p></div>
      </details></li>

    <li><p>A signature check confirms a file is a JPEG. Name two things that does not tell you.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>That it is well-formed beyond the first bytes, and that it is safe
        to decode. It answers "is this plausibly the format claimed", which is much smaller than "is
        this safe". Size, structure and what a decoder will do with it are all still open.</p></div>
      </details></li>

    <li><p>Which files have no signature to check, and what does that mean for a "reject what I cannot
      identify" policy?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>Plain text, CSV, JSON and XML have no leading bytes to check. A
        policy of rejecting anything unidentified rejects every text file you meant to accept, so text
        formats need a different rule - usually parsing them rather than sniffing them.</p></div>
      </details></li>

    <li><p>Why does a metrics middleware written as <code>await next(context)</code> followed by a
      record call go quiet during an incident?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>An exception from further down throws past the recording line, so
        only the requests that did not fail are counted. The metric goes quiet exactly when things go
        wrong and looks identical to one saying all is well. A <code>try/finally</code> fixes
        it.</p></div>
      </details></li>

    <li><p>Where should the original filename be stored, and where should it never appear?</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>As data, in the row beside the generated id, and in the
        <code>Content-Disposition</code> header when serving the file back. Never in a path, a URL, or
        a cache key.</p></div>
      </details></li>

    <li><p>Name one failure a <code>finally</code> block cannot clean up, and say what does clean it
      up.</p>
      <details class="reveal"><summary>Show answer</summary>
        <div class="reveal__body"><p>The process being killed between writing the temporary file and
        renaming it. Only a sweeper - a background job deleting stale partial files - covers that,
        because a process can stop between any two instructions you write.</p></div>
      </details></li>
  </ol>
</section>
`
});
