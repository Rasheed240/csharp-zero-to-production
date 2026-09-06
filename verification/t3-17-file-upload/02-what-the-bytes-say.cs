// 02-what-the-bytes-say.cs — Validating an upload: what the client claims, what
// the bytes are, and why Path.GetFileName is not the sanitiser people think.
//
// Run:  dotnet run 02-what-the-bytes-say.cs -c Release
//
// EXACT vs RATIO: every result here is deterministic. The path results are
// Windows results and are labelled as such - the same code answers differently
// on Linux, which is one of the findings.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text;

Console.WriteLine("What a file actually is");
Console.WriteLine();

WhatTheClientClaims();
WhatGetFileNameDoes();
TheNameYouGenerate();
ValidatingWhileStreaming();

// ---------------------------------------------------------------------------
static void WhatTheClientClaims()
{
    Console.WriteLine("1. Three descriptions of a file, two of which the client wrote");
    Console.WriteLine();
    Console.WriteLine("   An upload arrives with a filename and a content type, both typed by");
    Console.WriteLine("   whoever wrote the client. The bytes are the only part that is not a");
    Console.WriteLine("   claim. Here is what happens when they disagree.");
    Console.WriteLine();

    // Real leading bytes for each format. Everything after them is invented -
    // signature detection only ever looks at the front.
    byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, .. Encoding.UTF8.GetBytes("...jpeg body...")];
    byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. Encoding.UTF8.GetBytes("...")];
    byte[] pdf = [.. Encoding.ASCII.GetBytes("%PDF-1.7"), .. Encoding.UTF8.GetBytes(" body")];
    byte[] zip = [0x50, 0x4B, 0x03, 0x04, .. Encoding.UTF8.GetBytes("...zip body...")];
    byte[] exe = [0x4D, 0x5A, 0x90, 0x00, .. Encoding.UTF8.GetBytes("...MZ body...")];
    byte[] text = Encoding.UTF8.GetBytes("just some text, no signature at all");

    (string Name, string ContentType, byte[] Bytes, string Note)[] uploads =
    [
        ("receipt.jpg", "image/jpeg", jpeg, "honest"),
        ("receipt.jpg", "image/jpeg", exe, "a program wearing a photo's name"),
        ("invoice.pdf", "application/pdf", pdf, "honest"),
        ("photo.png", "image/png", pdf, "wrong extension, wrong type, real PDF"),
        ("archive.zip", "application/zip", zip, "honest"),
        ("scan.jpg", "application/octet-stream", jpeg, "lazy client, real image"),
        ("notes.txt", "text/plain", text, "no signature to check"),
        ("logo.png", "image/png", png, "honest")
    ];

    Console.WriteLine("   filename        content type              bytes say   extension agrees");
    Console.WriteLine("   --------        ------------              ---------   ----------------");

    foreach ((string name, string contentType, byte[] bytes, _) in uploads)
    {
        string sniffed = Sniff(bytes);
        string extension = Path.GetExtension(name).ToLowerInvariant();

        bool agrees = ExtensionsFor(sniffed).Contains(extension);

        Console.WriteLine($"   {name,-15} {contentType,-24}  {sniffed,-9}   " +
            $"{(sniffed == "unknown" ? "-" : agrees ? "yes" : "NO"),-3}");
    }

    Console.WriteLine();
    Console.WriteLine("   THREE ROWS DISAGREE, and they disagree in different ways:");
    Console.WriteLine();
    Console.WriteLine("     - receipt.jpg IS AN EXECUTABLE. Both client-supplied fields say image.");
    Console.WriteLine("       Only the first two bytes say otherwise.");
    Console.WriteLine();
    Console.WriteLine("     - photo.png IS A PDF. Nothing about it is hostile; a client picked the");
    Console.WriteLine("       wrong file. The response you give differs, but the DETECTION is the");
    Console.WriteLine("       same detection.");
    Console.WriteLine();
    Console.WriteLine("     - scan.jpg is a REAL IMAGE whose content type is the generic default.");
    Console.WriteLine("       If you validate on content type you reject this and accept the");
    Console.WriteLine("       executable, which is exactly backwards.");
    Console.WriteLine();
    Console.WriteLine("   AND notes.txt HAS NO SIGNATURE. Plain text, CSV, JSON and XML have no");
    Console.WriteLine("   leading bytes to check, so signature detection cannot confirm them - it");
    Console.WriteLine("   can only fail to recognise them. A policy of 'reject what I cannot");
    Console.WriteLine("   identify' rejects every text file you accept.");
    Console.WriteLine();
    Console.WriteLine("   WHAT SIGNATURE CHECKING IS AND IS NOT:");
    Console.WriteLine();
    Console.WriteLine("     It IS a cheap way to catch a mismatch between what a file claims and");
    Console.WriteLine("     what it is, on the first few bytes, before you have read the rest.");
    Console.WriteLine();
    Console.WriteLine("     It is NOT proof the file is safe. A file can start with a valid JPEG");
    Console.WriteLine("     signature and be malformed, enormous, or crafted to break whatever");
    Console.WriteLine("     decodes it later. Signature detection answers 'is this plausibly the");
    Console.WriteLine("     format claimed', which is a much smaller question than 'is this safe'.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhatGetFileNameDoes()
{
    Console.WriteLine("2. Path.GetFileName is not a sanitiser");
    Console.WriteLine();
    Console.WriteLine("   The usual advice is to run the client's filename through");
    Console.WriteLine("   Path.GetFileName and use the result. Here is what that actually");
    Console.WriteLine("   returns, and what happens if you then build a path from it.");
    Console.WriteLine();

    string root = Path.Combine(Path.GetTempPath(), "uploads");

    string[] candidates =
    [
        "receipt.jpg",
        "../../escaped.txt",
        @"..\..\escaped.txt",
        @"C:\Windows\Temp\evil.txt",
        "/etc/passwd",
        "..%2F..%2Fescaped.txt",
        "CON",
        "report.txt.",
        "report .txt",
        "",
        "..",
        "a" + new string('b', 300) + ".txt"
    ];

    Console.WriteLine("   client filename                GetFileName gives        combined path escapes");
    Console.WriteLine("   ---------------                -----------------        ---------------------");

    foreach (string candidate in candidates)
    {
        string leaf = Path.GetFileName(candidate);
        string shown = leaf.Length > 24 ? leaf[..21] + "..." : leaf;

        string escapes;

        try
        {
            string combined = Path.GetFullPath(Path.Combine(root, leaf));

            escapes = combined.StartsWith(root + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase) ? "no" : "YES";
        }
        catch (Exception exception)
        {
            escapes = exception.GetType().Name;
        }

        string label = candidate.Length > 28 ? candidate[..25] + "..." : candidate;

        Console.WriteLine($"   {Quote(label),-30} {Quote(shown),-24} {escapes}");
    }

    Console.WriteLine();
    Console.WriteLine("   READ THE TABLE CAREFULLY, because it is better than the advice.");
    Console.WriteLine();
    Console.WriteLine("     GetFileName DOES strip the directory part, so the traversal rows come");
    Console.WriteLine("     back as bare names and combining them no longer escapes. On this");
    Console.WriteLine("     count the advice is correct.");
    Console.WriteLine();
    Console.WriteLine("     BUT IT IS PLATFORM-DEPENDENT. On Windows both / and \\ are separators,");
    Console.WriteLine("     so both traversal rows collapse. ON LINUX, BACKSLASH IS AN ORDINARY");
    Console.WriteLine("     CHARACTER: Path.GetFileName(@\"..\\..\\escaped.txt\") returns the WHOLE");
    Console.WriteLine("     STRING, backslashes and all, because there is no separator in it. That");
    Console.WriteLine("     is a filename containing backslashes rather than a traversal, so it");
    Console.WriteLine("     does not escape - but code that PASSES IT ON to something Windows-side");
    Console.WriteLine("     (an SMB share, a zip entry, a client that re-saves it) hands that");
    Console.WriteLine("     traversal to a system that does read it as one.");
    Console.WriteLine();
    Console.WriteLine("     AND '..' GOES STRAIGHT THROUGH IT. Look at the last two rows that");
    Console.WriteLine("     say YES. Path.GetFileName(\"..\") returns '..' - it is a leaf, not a");
    Console.WriteLine("     directory part, so there is nothing for GetFileName to strip. Combine");
    Console.WriteLine("     that with the root and you are IN THE PARENT DIRECTORY. The advice");
    Console.WriteLine("     that GetFileName prevents traversal has a one-line counterexample.");
    Console.WriteLine();
    Console.WriteLine("     AND IT DOES NOT DECODE ANYTHING. '..%2F..%2Fescaped.txt' comes");
    Console.WriteLine("     back unchanged, which is correct here - it is a filename containing");
    Console.WriteLine("     percent signs, not a traversal. IT BECOMES ONE THE MOMENT SOMETHING");
    Console.WriteLine("     DOWNSTREAM URL-DECODES IT, which a web server serving the file back");
    Console.WriteLine("     may well do. A name is only safe with respect to the layer that");
    Console.WriteLine("     handles it next.");
    Console.WriteLine();
    Console.WriteLine("     THE EMPTY STRING ESCAPES TOO, in a quieter way: Path.Combine(root, \"\")");
    Console.WriteLine("     is the root ITSELF, which is a directory, not a file inside it. Every");
    Console.WriteLine("     subsequent write targets a directory and throws.");
    Console.WriteLine();
    Console.WriteLine("     AND IT LEAVES PLENTY ELSE BEHIND. A reserved Windows device name, a");
    Console.WriteLine("     trailing dot or space, and a 300-character name all survive intact.");
    Console.WriteLine("     Those do not escape; they break other things, below.");
    Console.WriteLine();
    Console.WriteLine("   SO THE ADVICE IS NOT MERELY INCOMPLETE, IT IS WRONG ON ITS OWN TERMS.");
    Console.WriteLine("   It is offered as an answer to 'does the path escape', and there is a");
    Console.WriteLine("   two-character input for which it answers that question incorrectly.");
    Console.WriteLine();

    // The reserved-name case is worth demonstrating rather than asserting,
    // because it fails at a layer people do not expect.
    Console.WriteLine("   What happens if you actually use one of the survivors:");
    Console.WriteLine();

    string sandbox = Directory.CreateTempSubdirectory("names").FullName;

    foreach (string leaf in new[] { "CON", "report.txt.", "report .txt", "..", "ordinary.txt" })
    {
        string result;

        try
        {
            string path = Path.Combine(sandbox, leaf);
            File.WriteAllText(path, "x");

            // Whether the file you can see is the file you wrote.
            bool findable = Directory.GetFiles(sandbox)
                .Any(f => Path.GetFileName(f) == leaf);

            result = findable
                ? "written, and listed under that name"
                : "WRITTEN UNDER A DIFFERENT NAME";
        }
        catch (Exception exception)
        {
            result = exception.GetType().Name;
        }

        Console.WriteLine($"   {Quote(leaf),-16} {result}");
    }

    Directory.Delete(sandbox, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   'report.txt.' IS THE INSTRUCTIVE ONE. Windows silently strips a");
    Console.WriteLine("   trailing dot from a filename, so the file you wrote is not stored under");
    Console.WriteLine("   the name you gave. Store that name in a database as the key to the file");
    Console.WriteLine("   and the lookup will miss - the row says 'report.txt.' and the disk says");
    Console.WriteLine("   'report.txt'. THAT IS A DATA BUG, NOT A SECURITY BUG, and it is the");
    Console.WriteLine("   more likely of the two to reach production. A TRAILING SPACE IS");
    Console.WriteLine("   DIFFERENT: 'report .txt' keeps its space, because the space is not");
    Console.WriteLine("   trailing - the folklore is about a space at the END of the name.");
    Console.WriteLine();
    Console.WriteLine("   'CON' WROTE A FILE AND LISTED UNDER THAT NAME, which is worth stating");
    Console.WriteLine("   because the folklore says otherwise. .NET no longer routes reserved");
    Console.WriteLine("   device names to devices on modern Windows for a path like this one.");
    Console.WriteLine("   THE LESSON IS NOT 'RESERVED NAMES ARE FINE' - it is that a rule you");
    Console.WriteLine("   inherited about filenames may not be true of the runtime and OS you are");
    Console.WriteLine("   on, and it takes four lines to find out rather than assume.");
    Console.WriteLine();
    Console.WriteLine("   '..' THREW UnauthorizedAccessException, which is the same escape from");
    Console.WriteLine("   the table arriving as a confusing error: the write targeted a DIRECTORY");
    Console.WriteLine("   (the parent), and the exception names permissions rather than saying so.");
    Console.WriteLine("   IF YOU SEE UnauthorizedAccessException FROM AN UPLOAD PATH, suspect that");
    Console.WriteLine("   the path resolved to a directory before you suspect ACLs.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheNameYouGenerate()
{
    Console.WriteLine("3. The check that holds: a name you generate, a path you verify");
    Console.WriteLine();
    Console.WriteLine("   Every problem in section 2 comes from the same decision - letting a");
    Console.WriteLine("   client-supplied string become part of a path. Stop doing that and the");
    Console.WriteLine("   whole class of problem goes away, including the ones nobody has thought");
    Console.WriteLine("   of yet.");
    Console.WriteLine();
    Console.WriteLine("   THE STORED NAME AND THE DISPLAYED NAME ARE DIFFERENT THINGS:");
    Console.WriteLine();
    Console.WriteLine("     ON DISK      a name you generate. A GUID, or an id from your");
    Console.WriteLine("                  database. It contains nothing a client typed.");
    Console.WriteLine();
    Console.WriteLine("     IN THE ROW   the original filename, stored as DATA, shown back to");
    Console.WriteLine("                  the user, used in the download's Content-Disposition,");
    Console.WriteLine("                  and never used to build a path.");
    Console.WriteLine();

    string root = Directory.CreateTempSubdirectory("stored").FullName;

    string[] hostile =
    [
        "receipt.jpg",
        "../../escaped.txt",
        @"..\..\escaped.txt",
        "CON",
        "report.txt.",
        ""
    ];

    Console.WriteLine("   client filename            stored as                              inside root");
    Console.WriteLine("   ---------------            ---------                              -----------");

    foreach (string name in hostile)
    {
        // The generated name. The client's extension is not carried over
        // either - the extension follows the DETECTED type, not the claim.
        string stored = $"{Guid.NewGuid():n}.bin";
        string path = Path.Combine(root, stored);

        File.WriteAllText(path, "contents");

        bool inside = Path.GetFullPath(path)
            .StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal);

        Console.WriteLine($"   {Quote(name),-26} {stored,-38} {inside}");
    }

    Console.WriteLine();
    Console.WriteLine($"   files in the root   {Directory.GetFiles(root).Length}");
    Console.WriteLine($"   files anywhere else 0, because no client string reached a path");

    Directory.Delete(root, recursive: true);

    Console.WriteLine();
    Console.WriteLine("   AND THE SECOND HALF, which costs one line: after building the path,");
    Console.WriteLine("   CHECK IT IS WHERE YOU THINK IT IS.");
    Console.WriteLine();
    Console.WriteLine("     string full = Path.GetFullPath(candidate);");
    Console.WriteLine();
    Console.WriteLine("     if (!full.StartsWith(root + Path.DirectorySeparatorChar,");
    Console.WriteLine("             StringComparison.Ordinal))");
    Console.WriteLine("     {");
    Console.WriteLine("         throw new InvalidOperationException(\"outside the upload root\");");
    Console.WriteLine("     }");
    Console.WriteLine();
    Console.WriteLine("   TWO DETAILS IN THAT SNIPPET ARE LOAD-BEARING:");
    Console.WriteLine();
    Console.WriteLine("     GetFullPath FIRST. It resolves the '..' segments. Comparing an");
    Console.WriteLine("     unresolved path proves nothing, because the string still contains the");
    Console.WriteLine("     escape.");
    Console.WriteLine();
    Console.WriteLine("     THE TRAILING SEPARATOR. Without it, a root of '/data/uploads' accepts");
    Console.WriteLine("     '/data/uploads-public/anything', because the prefix matches. That is a");
    Console.WriteLine("     real bypass and it is one character to fix.");
    Console.WriteLine();
    Console.WriteLine("   IT IS A BELT-AND-BRACES CHECK: if you generate the name, it can never");
    Console.WriteLine("   fire. KEEP IT ANYWAY. It is the assertion that the rule above it is");
    Console.WriteLine("   still true after somebody edits this code next year.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void ValidatingWhileStreaming()
{
    Console.WriteLine("4. Validating before you have the whole file");
    Console.WriteLine();
    Console.WriteLine("   Signature detection needs the first few bytes. A size limit needs a");
    Console.WriteLine("   running count. Neither needs the whole upload - which means both can");
    Console.WriteLine("   run WHILE it arrives, and reject early instead of after.");
    Console.WriteLine();

    (string Label, byte[] Bytes, long Limit)[] cases =
    [
        ("a real image, under the limit", MakeFile(0xFF, 0xD8, 0xFF, 0xE0, 2 * 1024 * 1024), 8 * 1024 * 1024),
        ("an executable named .jpg", MakeFile(0x4D, 0x5A, 0x90, 0x00, 2 * 1024 * 1024), 8 * 1024 * 1024),
        ("a real image, over the limit", MakeFile(0xFF, 0xD8, 0xFF, 0xE0, 16 * 1024 * 1024), 8 * 1024 * 1024)
    ];

    Console.WriteLine("   upload                          verdict            bytes read before deciding");
    Console.WriteLine("   ------                          -------            --------------------------");

    foreach ((string label, byte[] bytes, long limit) in cases)
    {
        (string verdict, long read) = StreamAndValidate(bytes, limit);

        Console.WriteLine($"   {label,-31} {verdict,-18} {Describe(read)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE MIDDLE ROW IS THE POINT. The executable was refused after four");
    Console.WriteLine("   bytes. A buffered handler would have read all two megabytes first,");
    Console.WriteLine("   written them to a temp file, and only then been asked.");
    Console.WriteLine();
    Console.WriteLine("   THE LAST ROW IS THE ONE PEOPLE GET WRONG. The oversized file was");
    Console.WriteLine("   refused at the limit, not at the end - the count is checked inside the");
    Console.WriteLine("   read loop, so the read stops there. Writing the check AFTER the loop");
    Console.WriteLine("   compiles, passes the same test, and reads the entire upload before");
    Console.WriteLine("   rejecting it, which is the failure mode the limit existed to prevent.");
    Console.WriteLine();
    Console.WriteLine("   ORDER THE CHECKS BY COST, cheapest first:");
    Console.WriteLine();
    Console.WriteLine("     1. THE DECLARED LENGTH, if the request has one. Content-Length is a");
    Console.WriteLine("        claim, but a claim of 4 GB is a refusal you can issue before");
    Console.WriteLine("        reading anything at all.");
    Console.WriteLine();
    Console.WriteLine("     2. THE SIGNATURE, from the first bytes off the wire.");
    Console.WriteLine();
    Console.WriteLine("     3. THE RUNNING COUNT, inside the loop, every iteration.");
    Console.WriteLine();
    Console.WriteLine("     4. ANYTHING NEEDING THE WHOLE FILE - a virus scan, decoding the");
    Console.WriteLine("        image, parsing the PDF - last, and ideally not in the request at");
    Console.WriteLine("        all. Store it as quarantined, scan it in the background, and mark");
    Console.WriteLine("        it available when the scan clears.");
    Console.WriteLine();
    Console.WriteLine("   AND KEEP THE SERVER LIMIT REGARDLESS. Your loop's count protects the");
    Console.WriteLine("   handler; Kestrel's MaxRequestBodySize protects everything upstream of");
    Console.WriteLine("   it, including the endpoints where somebody forgot to write the loop.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// Reads a stream the way a streaming handler does, checking the signature at
// the front and the size on every iteration. Returns how many bytes it read
// before it decided.
static (string Verdict, long BytesRead) StreamAndValidate(byte[] payload, long limit)
{
    using var source = new MemoryStream(payload);

    byte[] head = new byte[4];
    int headRead = source.Read(head);
    long total = headRead;

    if (Sniff(head.AsSpan(0, headRead).ToArray()) is not ("jpeg" or "png"))
    {
        return ("rejected: type", total);
    }

    byte[] buffer = new byte[8192];
    int read;

    while ((read = source.Read(buffer)) > 0)
    {
        total += read;

        // Inside the loop. After it, this check is decoration.
        if (total > limit)
        {
            return ("rejected: size", total);
        }
    }

    return ("accepted", total);
}

// ---------------------------------------------------------------------------
// Names a format from its leading bytes. This is the whole mechanism - there is
// no library needed for a handful of formats, and the table is the value.
static string Sniff(byte[] bytes)
{
    (string Name, byte[] Magic)[] signatures =
    [
        ("jpeg", [0xFF, 0xD8, 0xFF]),
        ("png", [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        ("gif", [0x47, 0x49, 0x46, 0x38]),
        ("pdf", [0x25, 0x50, 0x44, 0x46]),
        ("zip", [0x50, 0x4B, 0x03, 0x04]),
        ("gzip", [0x1F, 0x8B]),
        ("exe", [0x4D, 0x5A]),
        ("elf", [0x7F, 0x45, 0x4C, 0x46])
    ];

    foreach ((string name, byte[] magic) in signatures)
    {
        if (bytes.Length >= magic.Length && bytes.AsSpan(0, magic.Length).SequenceEqual(magic))
        {
            return name;
        }
    }

    return "unknown";
}

// ---------------------------------------------------------------------------
static string[] ExtensionsFor(string format) => format switch
{
    "jpeg" => [".jpg", ".jpeg"],
    "png" => [".png"],
    "gif" => [".gif"],
    "pdf" => [".pdf"],
    "zip" => [".zip"],
    "gzip" => [".gz"],
    "exe" => [".exe", ".dll"],
    "elf" => [""],
    _ => []
};

// ---------------------------------------------------------------------------
static byte[] MakeFile(byte a, byte b, byte c, byte d, int size)
{
    byte[] bytes = new byte[size];

    bytes[0] = a;
    bytes[1] = b;
    bytes[2] = c;
    bytes[3] = d;

    return bytes;
}

// ---------------------------------------------------------------------------
static string Describe(long bytes) => bytes < 1024
    ? $"{bytes} bytes"
    : $"{bytes / 1024.0 / 1024.0:0.0} MB";

// ---------------------------------------------------------------------------
static string Quote(string value) => $"'{value}'";
