/* ============================================================================
   Track 1, Module 1 — What a Program Actually Is
   Status: written. See STYLE-CONTRACT.md before changing anything here.

   Every C# snippet, command, and number in this module was compiled, run, and
   measured on .NET 10.0.400 (runtime 10.0.11), Windows 11 x64.
   The runnable sources are in verification/t1-01-what-a-program-is/.
   ========================================================================= */

CSPREP.module({
  id: "t1-01-what-a-program-is",
  minutes: 50,
  updated: "2026-08-29",
  summary:
    "A C# program is compiled twice: once by you into an intermediate language, and once by " +
    "the runtime into machine code while the program is running. Almost every confusing thing " +
    "about deploying .NET follows from that second step.",
  terms: [
    "program", "processor", "instruction", "machine code", "source code",
    "programming language", "compiler", "compile", "build", "IL", "assembly",
    "metadata", "runtime", "CLR", "managed code", "JIT", "tiered compilation",
    "on-stack replacement", "ReadyToRun", "Native AOT", "SDK", "framework-dependent",
    "self-contained", "runtime identifier", "debug symbols", "trimming", "exception"
  ],

  html: `

<section id="the-problem">
  <h2>The problem this exists to solve</h2>

  <p>You have shipped a change to a payments service. The deployment finishes, and for about
  fifteen seconds the first users through the door get responses that take two or three seconds
  instead of the usual forty milliseconds. Then, without anyone touching anything, it settles
  down and behaves perfectly.</p>

  <p>You ask a colleague. They say "that's the JIT warming up". You nod, because that is what
  people do, but you could not have said whether that answer is right, what it would take to
  confirm it, or what you would change if it were true.</p>

  <p>The same week, three more things happen that you also cannot explain.</p>

  <ul>
    <li>The service will not start on a new server. The error says something about a framework
    version, even though the code is identical to the code running fine elsewhere.</li>
    <li>A security reviewer asks whether the API key that a previous developer typed directly
    into the source is "safe now that it's compiled".</li>
    <li>Someone proposes turning on a build setting to make startup faster, and nobody in the
    room can say what it actually changes or what it might break.</li>
  </ul>

  <p>Every one of these is the same missing piece of knowledge: <strong>what actually happens
  between the code you write and the work the machine does</strong>. Not a slogan about it — the
  real sequence, and where each step can fail.</p>

  <p>This is the first module of the curriculum, so it assumes nothing whatsoever. It starts at
  what a computer physically does with a number, and finishes with you able to argue about
  deployment strategy.</p>
</section>

<section id="what-a-computer-runs">
  <h2>What a computer can actually run</h2>

  <p>Every term below is defined before it is used again. That is a rule for this whole
  curriculum, and it starts here.</p>

  <p class="define"><span class="define__term">Processor (CPU)</span> The chip that does the
  work. It is a machine that repeats one loop forever: fetch the next instruction, do what it
  says, move on. It is extremely fast and extremely literal. It has no concept of a customer, an
  invoice, or a web request.</p>

  <p class="define"><span class="define__term">Instruction</span> One thing the processor knows
  how to do, at the smallest scale: add these two numbers, copy this number from memory into
  that slot, if this value is zero skip ahead. Each instruction is itself stored as a number.</p>

  <p class="define"><span class="define__term">Machine code</span> A sequence of those
  instruction-numbers, laid out in memory, that the processor can execute directly. It is
  specific to a family of processor: machine code for an Intel or AMD desktop chip (called
  <strong>x64</strong>) is meaningless to the chip in a modern Mac or a Raspberry Pi (called
  <strong>Arm64</strong>), the way a plug is meaningless to the wrong socket.</p>

  <p class="define"><span class="define__term">Memory</span> The working space the program uses
  while running. Physically it is RAM: a very long row of numbered slots, each holding a tiny
  amount of data. Everything the program is doing right now lives there.</p>

  <p class="define"><span class="define__term">Program</span> A stored sequence of instructions
  plus the data it needs. "Running a program" means loading it into memory and pointing the
  processor at its first instruction.</p>

  <p>So the only thing a processor can run is machine code. Nothing else. Every programming
  language that has ever existed is a scheme for producing machine code without a human having
  to write it by hand.</p>

  <div class="callout callout--note">
    <h4>The analogy, and where it breaks</h4>
    <p>Think of the processor as a <strong>cook who follows instructions perfectly and
    understands nothing</strong>. Give it "heat pan to 180, add 30g butter, wait 90 seconds" and
    it does exactly that, faster than any human. Give it "make it taste nicer" and it stops dead,
    because that is not an instruction it knows.</p>
    <p>Where the analogy breaks: a cook can ask what you meant. A processor cannot. If you hand
    it a number that is not a valid instruction, it does not pause for clarification — it either
    does something meaningless or the whole program is killed. There is no judgement anywhere in
    the system. Every piece of sense-checking you have ever seen from a computer was written by
    a person, in advance.</p>
  </div>
</section>

<section id="source-and-compilers">
  <h2>Why nobody writes machine code</h2>

  <p>Machine code is writable by hand. It was, for years. It is also unbearable: a single line of
  ordinary C# can be dozens of machine instructions, the instructions differ per processor
  family, and a single misplaced number produces a program that fails in a way that tells you
  nothing.</p>

  <p class="define"><span class="define__term">Source code</span> The text a programmer writes.
  It is meant for humans to read and is designed to be translated into machine code by another
  program. This entire curriculum is about writing source code.</p>

  <p class="define"><span class="define__term">Programming language</span> A precisely defined
  set of rules for writing source code: which words mean what, and which arrangements of them are
  legal. <strong>C#</strong> is one such language. The rules are strict because the translation
  has to be unambiguous — there is no room for "you know what I meant".</p>

  <p class="define"><span class="define__term">Compiler</span> A program that reads source code
  and produces something the machine is closer to being able to run. <strong>To compile</strong>
  is to perform that translation. C#'s compiler is called <strong>Roslyn</strong>, and you almost
  never invoke it by name — the <code>dotnet</code> command runs it for you.</p>

  <p>Compiling is not only translation. The compiler also refuses to translate code it can prove
  is nonsense — adding a date to a customer, calling a method that does not exist, using a name
  you never declared. This is the first and cheapest place bugs get caught, and it is why the
  strictness of the language is a feature rather than an inconvenience.</p>

  <p class="define"><span class="define__term">Build</span> The whole process of turning your
  source files into runnable output: compiling them, and gathering up everything else the result
  needs. In .NET the command is <code>dotnet build</code>.</p>
</section>

<section id="minimal-example">
  <h2>The smallest program that does something</h2>

  <p>This is a complete C# program. Not an excerpt — the entire file.</p>

<pre data-lang="csharp" data-net="10" data-title="01-hello.cs"><code>Console.WriteLine("Ledger is running.");</code></pre>

  <p>Run it from a terminal:</p>

<pre data-lang="bash" data-title="terminal"><code>dotnet run 01-hello.cs</code></pre>

<pre data-lang="console" data-title="Output"><code>Ledger is running.</code></pre>

  <p>Three things in that one line are worth naming now, because they recur constantly.</p>

  <ul>
    <li><code>Console</code> is a piece of code somebody else already wrote, which comes with
    .NET. You are calling it, not writing it.</li>
    <li><code>WriteLine</code> is the specific action being asked for. The dot means "the
    <code>WriteLine</code> that belongs to <code>Console</code>".</li>
    <li>The semicolon ends the statement. C# needs it; the compiler will refuse the file without
    it. That refusal is the compiler doing its job.</li>
  </ul>

  <p>Four words in that description are used throughout the rest of this module, so they are
  worth pinning down now. Each gets a full treatment of its own later in Track 1; these are
  working definitions, enough to read on with.</p>

  <p class="define"><span class="define__term">Statement</span> One complete instruction in your
  source code, ending in a semicolon. A program is a list of them, run top to bottom.</p>

  <p class="define"><span class="define__term">Method</span> A named block of code you can run by
  name, from anywhere that can see it. <code>WriteLine</code> is one. Covered in
  <a href="#/m/t1-05-methods-and-parameters">Methods, Arguments, and Parameters</a>.</p>

  <p class="define"><span class="define__term">Parameter</span> A value a method accepts when you
  call it, written between the brackets. <code>WriteLine</code> takes one: the text to
  print.</p>

  <p class="define"><span class="define__term">String</span> A piece of text, written between
  double quotes. A value written directly in the source like this — text, or a number such as
  <code>42</code> — is called a <strong>literal</strong>. Strings get a whole module of their own
  in <a href="#/m/t1-07-strings-and-interning">Strings, Immutability, and Interning</a>.</p>

  <div class="callout callout--note">
    <h4>Version note</h4>
    <p>Running a single <code>.cs</code> file directly with <code>dotnet run file.cs</code> —
    with no project file — is a <strong>.NET 10</strong> feature, called a file-based app. On
    .NET 8 or 9 you must first create a project with <code>dotnet new console</code> and put the
    code in <code>Program.cs</code>. Every snippet in this curriculum works either way; the
    single-file form is used here because it keeps examples to exactly the code being taught.</p>
  </div>

  <p class="define"><span class="define__term">SDK</span> The Software Development Kit: the
  toolbox you need to <em>build</em> .NET code — the compiler, the <code>dotnet</code> command,
  the build system. Distinct from the <strong>runtime</strong>, defined shortly, which is what
  you need to <em>run</em> already-built code. Your development machine has both. A production
  server usually has only the runtime, and that distinction causes a specific failure covered
  later in this module.</p>
</section>

<section id="the-two-step-pipeline">
  <h2>The step that makes .NET different</h2>

  <p>Here is where most people's mental model is wrong, and where every confusing deployment
  behaviour comes from.</p>

  <p>When you compile C#, <strong>you do not get machine code</strong>. You get something else,
  and it is turned into machine code later — while your program is already running.</p>

  <p class="define"><span class="define__term">Intermediate Language (IL)</span> A compact,
  processor-independent instruction set that the C# compiler produces instead of machine code.
  It is a genuine instruction set, but no physical chip executes it. Also written CIL or MSIL;
  they are the same thing.</p>

  <p class="define"><span class="define__term">Assembly</span> The file the compiler produces:
  a <code>.dll</code> or <code>.exe</code> containing the IL plus a description of everything in
  it. "Assembly" here means a bundle of compiled code. It has nothing to do with assembly
  language, which is an unrelated and unfortunately similar term.</p>

  <p class="define"><span class="define__term">Metadata</span> The description stored alongside
  the IL: every type, every method, its name, its parameters and their names, what it returns.
  This is why .NET can tell you a method name in an error message, and it is why compiled .NET
  code can be read back almost perfectly by anyone who has the file.</p>

  <p class="define"><span class="define__term">Runtime</span> The program that runs your program.
  For .NET it is the <strong>CLR</strong> (Common Language Runtime). It loads your assembly,
  turns IL into machine code, manages memory for you, and handles errors. Your code never runs
  alone; it always runs inside this.</p>

  <p class="define"><span class="define__term">Managed code</span> Code that runs under the
  CLR's supervision, which is all normal C#. "Managed" refers to memory being managed for you.
  Code running outside that supervision — an operating system call, a C library — is
  <strong>unmanaged</strong>.</p>

  <p class="define"><span class="define__term">JIT (Just-In-Time compiler)</span> The part of
  the CLR that converts IL into real machine code, <strong>one method at a time, at the moment
  that method is first called</strong>. Not at build time, and not all at once at startup.</p>

  <p>So the full path from your text to the processor doing work:</p>

<pre class="diagram"><code>  BUILD TIME  (on your machine, or in CI)

    +----------------+   Roslyn     +------------------------------+
    |  Program.cs    | -----------&gt; |  MyApp.dll                   |
    |  source text   |  compiler    |    - IL (not machine code)   |
    +----------------+              |    - metadata (names, types) |
                                    +------------------------------+
                                                  |
                                         ships to the server
                                                  v
  RUN TIME  (on the server, every single time the process starts)

                                    +------------------------------+
                                    |  CLR loads the assembly      |
                                    +------------------------------+
                                                  |
                                   first call to a method arrives
                                                  v
                                    +------------------------------+
                                    |  JIT compiles THAT method    |
                                    |  IL  ---&gt;  x64 / Arm64 code  |
                                    +------------------------------+
                                                  |
                                                  v
                                    +------------------------------+
                                    |  processor executes it       |
                                    |  (cached for next time)      |
                                    +------------------------------+</code></pre>

  <p>Two consequences follow immediately, and they explain most of this module:</p>

  <ol>
    <li><strong>One build runs everywhere.</strong> The IL does not care whether the server has
    an Intel chip or an Arm chip. The JIT on that machine produces the right machine code. This
    is why a .NET application can be built once and run on Windows, Linux, and macOS.</li>
    <li><strong>Compilation cost moves into production.</strong> Every method pays a one-off
    translation cost the first time it is called, in the live process, while a real user is
    waiting. That is the "warming up" your colleague mentioned, and it is measurable.</li>
  </ol>
</section>

<section id="seeing-it-yourself">
  <h2>Seeing the IL and the metadata yourself</h2>

  <p>This is claimed so often, and demonstrated so rarely, that it is worth proving. The
  following program asks the runtime for the IL of a method and prints it — no special tools
  needed.</p>

<pre data-lang="csharp" data-net="10" data-title="02-reading-il.cs"><code>using System.Reflection;

MethodInfo add = typeof(Maths).GetMethod(nameof(Maths.Add))!;
MethodBody body = add.GetMethodBody()!;
byte[] il = body.GetILAsByteArray()!;

Console.WriteLine($"Maths.Add compiles to {il.Length} bytes of IL:");
Console.WriteLine($"  {Convert.ToHexString(il)}");
Console.WriteLine();

Console.WriteLine("Those bytes decode as:");
foreach (byte opcode in il)
{
    Console.WriteLine($"  0x{opcode:X2}  {Describe(opcode)}");
}
Console.WriteLine();

Console.WriteLine("Metadata the runtime can still read at run time:");
Console.WriteLine($"  declaring type : {add.DeclaringType!.FullName}");
Console.WriteLine($"  method name    : {add.Name}");
Console.WriteLine($"  returns        : {add.ReturnType.Name}");
foreach (ParameterInfo p in add.GetParameters())
{
    Console.WriteLine($"  parameter      : {p.ParameterType.Name} {p.Name}");
}

static string Describe(byte opcode) =&gt; opcode switch
{
    0x02 =&gt; "ldarg.0   push argument 0 onto the stack",
    0x03 =&gt; "ldarg.1   push argument 1 onto the stack",
    0x58 =&gt; "add       pop two, add them, push the result",
    0x2A =&gt; "ret       return the value on top of the stack",
    _ =&gt; "(not decoded by this demo)"
};

static class Maths
{
    public static int Add(int a, int b) =&gt; a + b;
}</code></pre>

<pre data-lang="console" data-title="Output"><code>Maths.Add compiles to 4 bytes of IL:
  0203582A

Those bytes decode as:
  0x02  ldarg.0   push argument 0 onto the stack
  0x03  ldarg.1   push argument 1 onto the stack
  0x58  add       pop two, add them, push the result
  0x2A  ret       return the value on top of the stack

Metadata the runtime can still read at run time:
  declaring type : Maths
  method name    : Add
  returns        : Int32
  parameter      : Int32 a
  parameter      : Int32 b</code></pre>

  <p>Read what that output actually proves.</p>

  <p><code>a + b</code> became <strong>four bytes</strong>: <code>02 03 58 2A</code>. Those are
  not x64 instructions. There is no register in them, no memory address, nothing
  processor-specific. They describe the operation abstractly — push, push, add, return — leaving
  the choice of actual registers and instructions to the JIT on whatever machine ends up running
  it.</p>

  <p>And the metadata survived compilation completely. The parameter is still called
  <code>a</code>. Nothing stripped it. That is the same mechanism that lets a crash report name
  the method that failed, and — as the next section shows — it is also why a compiled .NET
  assembly hides almost nothing from someone who has the file.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha</h4>
    <p>Building that program prints a warning, and it is a real one worth reading now rather
    than being surprised by later:</p>
<pre data-lang="console" data-title="Build warning"><code>warning IL2026: Using member 'System.Reflection.MethodBase.GetMethodBody()' which has
'RequiresUnreferencedCodeAttribute' can break functionality when trimming application code.</code></pre>
    <p>Asking about code at run time, the way this demo does, is called
    <strong>reflection</strong>. It works because the metadata is present. Some publishing modes
    covered later in this module <em>delete</em> unused metadata to make the output smaller, and
    reflection then fails at run time rather than at build time. The compiler is warning you in
    advance. This is the single most common way a program that works locally breaks after being
    published with size optimisations on.</p>
  </div>

  <h3>The same mechanism, seen from a security angle</h3>

  <p>If names and types survive compilation, so does everything else you wrote — including text
  you may have assumed was hidden. This program searches its own compiled file for a hard-coded
  key and finds it.</p>

<pre data-lang="csharp" data-net="10" data-title="03-strings-in-the-binary.cs (abridged to the essential part)"><code>using System.Reflection;
using System.Text;

// Pretend someone thought this was safe because "it gets compiled".
const string ApiKey = "sk_live_LEDGER_51H8xQ2vB";

string assemblyName = Assembly.GetExecutingAssembly().GetName().Name!;
string assemblyPath = Path.Combine(AppContext.BaseDirectory, assemblyName + ".dll");

byte[] fileBytes = File.ReadAllBytes(assemblyPath);

// .NET stores string literals as UTF-16 inside the assembly.
byte[] needle = Encoding.Unicode.GetBytes(ApiKey);
int at = IndexOf(fileBytes, needle);

Console.WriteLine($"size on disk : {fileBytes.Length:N0} bytes");
Console.WriteLine($"found the API key at byte offset {at}");
Console.WriteLine($"recovered    : {Encoding.Unicode.GetString(fileBytes, at, needle.Length)}");

static int IndexOf(byte[] haystack, byte[] needle)
{
    for (int i = 0; i + needle.Length &lt;= haystack.Length; i++)
    {
        bool match = true;
        for (int j = 0; j &lt; needle.Length; j++)
        {
            if (haystack[i + j] != needle[j])
            {
                match = false;
                break;
            }
        }
        if (match)
        {
            return i;
        }
    }
    return -1;
}</code></pre>

<pre data-lang="console" data-title="Output"><code>size on disk : 8,704 bytes
found the API key at byte offset 5112
recovered    : sk_live_LEDGER_51H8xQ2vB</code></pre>

  <div class="callout callout--warn">
    <h4>Warning</h4>
    <p>"It is compiled" is not a security property. It took a twenty-line byte search to recover
    that key, and freely available decompilers reconstruct near-original C# source from a .NET
    assembly in a couple of clicks, complete with your variable names.</p>
    <p><strong>Anything in your source is in your binary.</strong> Connection strings, API keys,
    tokens, internal URLs, the comment where someone explained the workaround. Treat a compiled
    assembly as public the moment it leaves your build server. Secrets belong in configuration
    supplied at run time, which is the subject of
    <a href="#/m/t3-14-secrets">Environments and Secret Handling</a>.</p>
  </div>
</section>

<section id="production-example">
  <h2>What you actually ship</h2>

  <p>Building is what you do while developing. Shipping is a different command with different
  output, and the choice you make here is a real production decision with real trade-offs.</p>

  <p>Here is a small Ledger service, complete. First the project file, which tells the build
  system what to produce.</p>

<pre data-lang="xml" data-title="LedgerPublishDemo.csproj"><code>&lt;Project Sdk="Microsoft.NET.Sdk"&gt;

  &lt;PropertyGroup&gt;
    &lt;OutputType&gt;Exe&lt;/OutputType&gt;
    &lt;TargetFramework&gt;net10.0&lt;/TargetFramework&gt;
    &lt;Nullable&gt;enable&lt;/Nullable&gt;
    &lt;ImplicitUsings&gt;enable&lt;/ImplicitUsings&gt;
    &lt;AssemblyName&gt;LedgerPublishDemo&lt;/AssemblyName&gt;
    &lt;RootNamespace&gt;LedgerPublishDemo&lt;/RootNamespace&gt;
    &lt;InvariantGlobalization&gt;true&lt;/InvariantGlobalization&gt;
  &lt;/PropertyGroup&gt;

&lt;/Project&gt;</code></pre>

<pre data-lang="csharp" data-net="10" data-title="Program.cs"><code>Console.WriteLine($"Ledger says hello from .NET {Environment.Version}.");
Console.WriteLine($"running on: {System.Runtime.InteropServices.RuntimeInformation.OSDescription.Trim()}");
Console.WriteLine($"architecture: {System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture}");</code></pre>

  <p class="define"><span class="define__term">Framework-dependent</span> Publishing only your own
  code, and requiring the correct .NET runtime to already be installed on the target machine.
  The default.</p>

  <p class="define"><span class="define__term">Self-contained</span> Publishing your code
  <em>together with an entire copy of the .NET runtime</em>, so the target machine needs nothing
  pre-installed.</p>

  <p class="define"><span class="define__term">Runtime identifier (RID)</span> A short code for
  the operating system and processor you are targeting: <code>win-x64</code>,
  <code>linux-x64</code>, <code>linux-arm64</code>, <code>osx-arm64</code>. A self-contained
  build must name one, because it is bundling machine-specific runtime files.</p>

<pre data-lang="bash" data-title="terminal"><code># 1. framework-dependent: needs .NET 10 installed on the server
dotnet publish -c Release -o out/framework-dependent

# 2. self-contained: brings its own runtime, needs nothing installed
dotnet publish -c Release -r win-x64 --self-contained true -o out/self-contained

# 3. self-contained, precompiled to native code, as one file
dotnet publish -c Release -r win-x64 --self-contained true \\
    -p:PublishReadyToRun=true -p:PublishSingleFile=true -o out/r2r-singlefile</code></pre>

  <p>Measured output of those three commands for the identical three-line program:</p>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Mode</th><th>Total size</th><th>Files</th><th>Needs .NET installed?</th></tr>
      </thead>
      <tbody>
        <tr><td>Framework-dependent</td><td>1 MB</td><td>5</td><td>Yes — the matching major version</td></tr>
        <tr><td>Self-contained</td><td>78 MB</td><td>192</td><td>No</td></tr>
        <tr><td>Self-contained + ReadyToRun + single file</td><td>80 MB</td><td>2</td><td>No</td></tr>
      </tbody>
    </table>
  </div>

  <p>The entire framework-dependent output is five files:</p>

<pre data-lang="console" data-title="ls out/framework-dependent"><code>       445  LedgerPublishDemo.deps.json
      5120  LedgerPublishDemo.dll          &lt;-- your code. 5 KB.
    162304  LedgerPublishDemo.exe          &lt;-- a launcher stub, not your code
     10944  LedgerPublishDemo.pdb          &lt;-- debug symbols
       449  LedgerPublishDemo.runtimeconfig.json</code></pre>

  <p><strong>Your program is 5,120 bytes.</strong> The 78 MB in the self-contained build is
  almost entirely the runtime and class library you are choosing to carry with you. That single
  fact explains the whole trade-off: you are deciding who is responsible for having a runtime,
  and paying in image size for taking that responsibility yourself.</p>

  <p class="define"><span class="define__term">Debug symbols (PDB)</span> A separate file mapping
  compiled code back to source file names and line numbers. It is what turns an unreadable crash
  address into "line 18 of Program.cs". It is not needed to run, and it is the reason your stack
  traces are useful — you will see one shortly.</p>

  <p>The <code>runtimeconfig.json</code> is small, plain text, and decides which runtime the app
  demands. It is worth being able to read, because it is the first thing to check when an app
  refuses to start:</p>

<pre data-lang="json" data-title="LedgerPublishDemo.runtimeconfig.json"><code>{
  "runtimeOptions": {
    "tfm": "net10.0",
    "framework": {
      "name": "Microsoft.NETCore.App",
      "version": "10.0.0"
    },
    "configProperties": {
      "System.Globalization.Invariant": true,
      "System.Globalization.PredefinedCulturesOnly": true
    }
  }
}</code></pre>

  <p class="define"><span class="define__term">ReadyToRun (R2R)</span> A publishing option that
  runs the JIT ahead of time at build time and stores the resulting machine code in the assembly
  <em>alongside</em> the IL. At startup the runtime uses the precompiled code instead of
  compiling, which cuts startup cost. The IL is kept, so the JIT can still re-optimise hot
  methods later. It makes files bigger and is processor-specific.</p>

  <p class="define"><span class="define__term">Native AOT</span> Compiling everything to machine
  code ahead of time and shipping <em>no</em> IL and no JIT at all. Startup is close to instant
  and memory use is much lower, but reflection, run-time code generation, and any library that
  relies on them stop working, and you must build separately per target platform.</p>
</section>

<section id="jit-in-practice">
  <h2>Measuring the JIT instead of believing in it</h2>

  <p>Back to the opening scenario. Is "the JIT warming up" a real explanation? It is measurable,
  so measure it. .NET exposes the JIT's own accounting through
  <code>System.Runtime.JitInfo</code>.</p>

<pre data-lang="csharp" data-net="10" data-title="04-jit-warmup.cs" data-highlight="17,23"><code>using System.Diagnostics;
using System.Runtime;

Console.WriteLine($"methods JIT-compiled before this line : {JitInfo.GetCompiledMethodCount():N0}");
Console.WriteLine($"time already spent inside the JIT     : {JitInfo.GetCompilationTime().TotalMilliseconds:F1} ms");
Console.WriteLine();

int[] data = new int[20_000];
for (int i = 0; i &lt; data.Length; i++)
{
    data[i] = i;
}

long before = JitInfo.GetCompiledMethodCount();
long start = Stopwatch.GetTimestamp();
long result = Checksum(data);
TimeSpan firstCall = Stopwatch.GetElapsedTime(start);
long compiled = JitInfo.GetCompiledMethodCount() - before;

start = Stopwatch.GetTimestamp();
result += Checksum(data);
TimeSpan secondCall = Stopwatch.GetElapsedTime(start);

Console.WriteLine($"1st call : {firstCall.TotalMicroseconds,8:N1} us  (compiled {compiled} method(s) on the way)");
Console.WriteLine($"2nd call : {secondCall.TotalMicroseconds,8:N1} us  (already compiled)");
Console.WriteLine($"the first call cost {firstCall.TotalMicroseconds / secondCall.TotalMicroseconds:F0}x the second");
Console.WriteLine();

Console.WriteLine($"methods JIT-compiled in total         : {JitInfo.GetCompiledMethodCount():N0}");
Console.WriteLine($"total time spent inside the JIT       : {JitInfo.GetCompilationTime().TotalMilliseconds:F1} ms");

Console.WriteLine($"(checksum {result})");

static long Checksum(int[] values)
{
    long total = 0;
    for (int i = 0; i &lt; values.Length; i++)
    {
        total += values[i] * 31L;
    }
    return total;
}</code></pre>

<pre data-lang="console" data-title="dotnet run -c Release 04-jit-warmup.cs"><code>methods JIT-compiled before this line : 2
time already spent inside the JIT     : 3.4 ms

1st call :    392.4 us  (compiled 2 method(s) on the way)
2nd call :     22.1 us  (already compiled)
the first call cost 18x the second

methods JIT-compiled in total         : 9
total time spent inside the JIT       : 24.3 ms
(checksum 1258537070000)</code></pre>

  <p>The colleague was right, and now it is a number rather than a belief. The first call to that
  method cost <strong>15 to 19 times</strong> the second across four runs, and the difference is
  compilation. The exact multiple moves with machine load; that it is more than an order of
  magnitude does not.</p>

  <p>Note the last two lines. A program consisting of one loop and one method still spent
  <strong>24 milliseconds inside the JIT</strong> and compiled nine methods, most of them
  belonging to the class library rather than to this file. Scale that to a web service with
  hundreds of types, a dependency injection container, an ORM, and a JSON serialiser, and the
  fifteen seconds of slow responses after deployment stops being mysterious.</p>

  <p class="define"><span class="define__term">Tiered compilation</span> The runtime's strategy of
  compiling a method quickly and badly the first time (tier 0), then recompiling it slowly and
  well (tier 1) in the background once it has been called enough times to be worth optimising.
  It gets the process started sooner without giving up steady-state speed.</p>

  <p class="define"><span class="define__term">On-stack replacement (OSR)</span> The mechanism
  that lets the runtime swap a method from tier-0 to tier-1 code <em>while that method is still
  running</em>. It exists for long loops, which would otherwise be stuck in unoptimised code for
  the whole execution.</p>

  <div class="callout callout--gotcha">
    <h4>Gotcha: why the obvious follow-up experiment shows nothing</h4>
    <p>The natural next step is to call <code>Checksum</code> a few hundred more times and expect
    another speed-up as it reaches tier 1. It does not happen, and the measurement stays flat.</p>
    <p>The reason is OSR. <code>Checksum</code> contains a 20,000-iteration loop, so the runtime
    promoted it to optimised code <em>during the first call</em>, partway through that loop. By
    the second call it is already fully optimised. There is nothing left to gain.</p>
    <p>This generalises: <strong>tier-0 versus tier-1 is very hard to observe from inside a
    microbenchmark</strong>, because promotion happens within the first few dozen calls. The
    honest way to measure the cost of tiering is at the level of the whole process, which is what
    the next section does. Being unable to reproduce an effect in a microbenchmark is a normal
    result, and reporting it is more useful than inventing a number.</p>
  </div>
</section>

<section id="what-goes-wrong">
  <h2>What goes wrong</h2>

  <h3>1. It runs here and not there</h3>

  <p>A framework-dependent build needs a matching runtime on the target machine. When it is
  missing, the failure is at startup, before any of your code runs. This is the exact output,
  produced by deploying an app that asks for a runtime version the machine does not have:</p>

<pre data-lang="console" data-title="Real output" data-bad="true"><code>You must install or update .NET to run this application.

App: /srv/ledger/LedgerPublishDemo
Architecture: x64
Framework: 'Microsoft.NETCore.App', version '99.0.0' (x64)
.NET location: /usr/share/dotnet/

The following frameworks were found:
  6.0.36 at [/usr/share/dotnet/shared/Microsoft.NETCore.App]
  8.0.29 at [/usr/share/dotnet/shared/Microsoft.NETCore.App]
  9.0.18 at [/usr/share/dotnet/shared/Microsoft.NETCore.App]
  10.0.11 at [/usr/share/dotnet/shared/Microsoft.NETCore.App]</code></pre>

  <p>This message is unusually good: it states exactly what was wanted and exactly what exists.
  Read it and the fix is immediate — install the runtime, retarget the app, or publish
  self-contained. The mistake people make is skimming past it because it looks like a wall of
  text.</p>

  <p>The related trap is the <strong>architecture</strong> line. Building <code>win-x64</code>
  and deploying to an Arm64 container produces a similar refusal. It is a common surprise when
  a laptop moves to Apple silicon while the build pipeline still targets x64.</p>

  <h3>2. Confusing an error the compiler can catch with one it cannot</h3>

  <p>Both bugs below are in the same file. Only one stops the build, and knowing which is which
  is what lets you predict where a class of bug will surface.</p>

<pre data-lang="csharp" data-net="10" data-title="06-compile-vs-runtime-errors.cs" data-bad="true"><code>string[] currencies = { "GBP", "USD", "EUR" };

// (A) A compile-time error: the compiler knows a string cannot become an int.
int wrong = currencies[0];

// (B) A run-time error: the type is correct and the index is an int.
//     Whether index 7 exists is not knowable until it runs.
int index = int.Parse(Environment.GetEnvironmentVariable("CURRENCY_INDEX") ?? "7");
Console.WriteLine($"the currency is {currencies[index]}");</code></pre>

  <p>With line (A) present, nothing runs at all:</p>

<pre data-lang="console" data-title="Compiler output"><code>06-compile-vs-runtime-errors.cs(11,13): error CS0029: Cannot implicitly convert type 'string' to 'int'</code></pre>

  <p>Remove line (A) and the program builds cleanly, starts, prints, and then dies:</p>

<pre data-lang="console" data-title="Run-time output"><code>asking for currency at index 7 of 3
Unhandled exception. System.IndexOutOfRangeException: Index was outside the bounds of the array.
   at Program.&lt;Main&gt;$(String[] args) in 06-compile-vs-runtime-errors.cs:line 18</code></pre>

  <p class="define"><span class="define__term">Exception</span> The runtime's way of reporting
  that something has gone wrong in a way the code did not handle. Unhandled, it stops the
  program and prints where it happened.</p>

  <p>Notice <code>in 06-compile-vs-runtime-errors.cs:line 18</code>. That file name and line
  number came from the PDB. Delete the PDB from your deployment and that line disappears,
  leaving you a crash with no location. This is why PDBs are worth shipping or archiving even
  though they are not required to run.</p>

  <p>The general rule: <strong>the compiler catches contradictions in the code's shape; it cannot
  catch claims about data it has never seen.</strong> Anything that depends on a file's contents,
  a network response, an environment variable, or a user's input is necessarily a run-time
  concern. Set the environment variable and the same binary behaves perfectly:</p>

<pre data-lang="bash" data-title="terminal"><code>CURRENCY_INDEX=1 dotnet run 06-compile-vs-runtime-errors.cs</code></pre>

<pre data-lang="console" data-title="Output"><code>asking for currency at index 1 of 3
the currency is USD</code></pre>

  <h3>3. Assuming Debug and Release are the same program</h3>

  <p>They are not, and the differences bite exactly when you are under pressure.</p>

  <div class="table-wrap">
    <table>
      <thead><tr><th></th><th>Debug</th><th>Release</th></tr></thead>
      <tbody>
        <tr><td>Optimisations</td><td>Off</td><td>On</td></tr>
        <tr><td>Small methods folded into callers (inlining)</td><td>Rare</td><td>Common</td></tr>
        <tr><td>Stack traces</td><td>Match your source exactly</td><td>May omit inlined frames</td></tr>
        <tr><td>Variables visible in a debugger</td><td>All</td><td>Some optimised away</td></tr>
        <tr><td>Speed</td><td>Slower, sometimes greatly</td><td>Representative</td></tr>
      </tbody>
    </table>
  </div>

  <p>Two practical consequences. <strong>Never quote a performance number from a Debug
  build</strong> — it is not measuring your program. And when a Release stack trace looks like it
  skipped a method, it very likely did: the method was inlined into its caller and no longer
  exists as a separate frame.</p>

  <h3>4. Turning on size optimisations and breaking reflection</h3>

  <p class="define"><span class="define__term">Trimming</span> A publishing option that removes
  code and metadata the build believes is unused, to shrink the output. It decides by following
  method calls from your entry point.</p>

  <p>Reflection defeats that analysis. Looking a type up by name at run time is invisible to a
  build-time scan, so the trimmer removes the type and the lookup fails in production with a
  message about a type that plainly does exist in the source. This is what the <code>IL2026</code> warning
  earlier in this module was about, and it is why those warnings should never be suppressed
  without understanding them.</p>

<pre data-lang="csharp" data-net="10" data-bad="true" data-title="Fine locally, fails when trimmed or AOT-compiled"><code>// The trimmer cannot see this dependency, because the type is named in a
// string that only exists at run time.
Type? handler = Type.GetType($"Ledger.Handlers.{handlerName}Handler");
object? instance = Activator.CreateInstance(handler!);</code></pre>

  <p>The fix is not to abandon trimming. It is to make the dependency visible at build time — by
  referencing types directly, or by using a source generator that produces real, traceable code.
  Native AOT has the same constraint in a stricter form.</p>
</section>

<section id="how-to-debug">
  <h2>How to debug it</h2>

  <div class="callout callout--debug">
    <h4>Symptom: the app will not start on the server</h4>
    <ol>
      <li><strong>Read the whole error.</strong> The host prints what it wanted and what it
      found. That is usually the entire diagnosis.</li>
      <li><strong>Ask the machine what it has:</strong>
<pre data-lang="bash" data-title="terminal"><code>dotnet --list-runtimes
dotnet --info</code></pre>
      <code>--list-runtimes</code> prints one line per installed runtime. Compare the major
      version against the app's requirement.</li>
      <li><strong>Ask the app what it wants.</strong> Open
      <code>YourApp.runtimeconfig.json</code> next to the DLL and read the
      <code>framework.version</code> field. No tooling needed; it is plain text.</li>
      <li><strong>Check the architecture too</strong>, not only the version. An x64 build will
      not run on an Arm64 host.</li>
      <li><strong>Fix</strong> by installing the runtime, retargeting the app, or publishing
      self-contained so the question cannot arise.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: the first requests after every deployment are slow</h4>
    <ol>
      <li><strong>Confirm it is compilation</strong> rather than a cold cache or a connection
      pool filling up. Watch the JIT counters against the live process:
<pre data-lang="bash" data-title="terminal"><code>dotnet-counters monitor --process-id 1234 --counters System.Runtime</code></pre>
      If the slow period lines up with JIT activity and settles as it stops, it is compilation.
      If the process is quiet and you are still slow, look elsewhere — a cold database cache and
      a cold JIT look identical from the outside.</li>
      <li><strong>Quantify it from inside the app.</strong> <code>JitInfo.GetCompilationTime()</code>
      and <code>JitInfo.GetCompiledMethodCount()</code> can be logged at startup and after the
      first minute. This converts an argument into two numbers.</li>
      <li><strong>Reduce it</strong> in this order: publish with
      <code>PublishReadyToRun=true</code> so the common paths ship precompiled; send warm-up
      requests before adding the instance to the load balancer; and only then consider Native
      AOT, which removes the JIT entirely at a significant cost in flexibility.</li>
      <li><strong>Do not reach for <code>DOTNET_TieredCompilation=0</code> reflexively.</strong>
      It makes every method compile optimised on first call, which usually makes startup
      <em>worse</em>, not better. Measure before and after; the section below shows how little
      it helped in a case where people often assume it would.</li>
    </ol>
  </div>

  <div class="callout callout--debug">
    <h4>Symptom: a stack trace points at a method that should not be involved</h4>
    <p>Check whether you are looking at a Release build. Inlining removes frames, so the reported
    method may be the one your failing method was folded into. Reproduce in Debug, or set
    <code>&lt;DebugType&gt;portable&lt;/DebugType&gt;</code> and ensure the PDB is deployed
    alongside the assembly, before concluding the trace is impossible.</p>
  </div>
</section>

<section id="why-this-matters">
  <h2>Why this matters in a real system</h2>

  <div class="callout callout--why">
    <h4>Why this matters in a real system</h4>
    <p>Ledger runs its payments API as 20 containers behind a load balancer, deployed by a
    rolling update that replaces containers a few at a time. Steady-state p99 latency is 40 ms.
    During every deployment, p99 spikes to roughly 2.5 seconds for about 15 seconds per batch,
    and the on-call alert threshold is 1 second. Deployments happen several times a day, so the
    team had been routinely acknowledging and dismissing an alert that was, each time, real.</p>
    <p>The cause is the one measured earlier in this module. Each fresh container starts with an
    empty JIT cache. The first request through each code path pays compilation cost — measured
    here at <strong>15 to 19 times the steady-state cost</strong> for a single trivial method,
    and the request path through a real API touches hundreds.</p>
    <p>Three fixes, in increasing order of cost:</p>
    <ul>
      <li><strong>Warm-up before routing.</strong> Have the container issue a handful of requests
      against itself, and only report healthy afterwards. Costs a few seconds of deployment
      time and nothing else. This alone removed the alert.</li>
      <li><strong>ReadyToRun.</strong> Publishing with <code>PublishReadyToRun=true</code> ships
      precompiled machine code alongside the IL. The measurement below shows what the runtime's
      own precompiled code is worth.</li>
      <li><strong>Native AOT</strong> for the small, reflection-free internal services, where
      near-instant start matters and the constraints are acceptable.</li>
    </ul>
    <p>To show that precompilation genuinely is the lever, here is the same fixed workload run 13
    times per configuration, measuring total process wall-clock — runtime startup, JIT, and work
    together, which is what a cold container start actually costs:</p>
<pre data-lang="console" data-title="bash run-tiering-comparison.sh"><code>total process wall-clock, median of 13 runs each:
  default                          median  196 ms
  DOTNET_TieredCompilation=0       median  187 ms
  DOTNET_TieredPGO=0               median  217 ms
  DOTNET_ReadyToRun=0              median  297 ms</code></pre>
    <p>The result that matters is the last line. Turning ReadyToRun <em>off</em> — forcing the
    JIT to compile the framework's own code instead of loading Microsoft's precompiled version —
    made a trivial program <strong>about 1.5x slower to start</strong>. Across separate sessions
    the ratio ranged from 1.3x to 1.9x; the magnitude is noisy on a desktop machine but the
    direction never changed. Precompiled code is doing substantial work for you before your
    program prints a single character, which is exactly the effect
    <code>PublishReadyToRun=true</code> extends to your own code.</p>
    <p>Note also what did <em>not</em> help: <code>DOTNET_TieredCompilation=0</code>, the setting
    most often suggested for this problem, was within noise of the default. That is the practical
    lesson — the mechanism tells you which lever to reach for, and the measurement tells you
    whether you were right.</p>
  </div>
</section>

<section id="misconceptions">
  <h2>Misconceptions and anti-patterns</h2>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"C# is compiled, so it works like C or C++."</strong></p>
    <p>Only the first half of the pipeline matches. A C++ compiler produces machine code for one
    specific processor family, finished at build time. The C# compiler produces IL, and machine
    code is generated on the target machine while the program runs. That is why one .NET build
    runs on x64 and Arm64 alike, and why .NET has startup behaviour that C++ does not.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"C# is interpreted, like a script."</strong></p>
    <p>Also wrong, in the other direction. An interpreter re-reads and re-decides on every
    execution. The JIT compiles each method to real machine code <em>once</em>, and every
    subsequent call runs that machine code at full speed. The cost is paid once per method per
    process, not once per call — which is precisely why the first call measured over ten times
    the second, and the second matched every call after it.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"IL is machine code, or close to it."</strong></p>
    <p>IL is considerably higher-level than machine code. It has no registers and no memory
    addresses; it works on an abstract stack. <code>a + b</code> was four bytes of IL. The
    machine code the JIT produces from it is a different length, in a different instruction set,
    and different again on Arm64. Being high-level is exactly what makes IL portable — and
    exactly what makes it easy to decompile back into readable C#.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"The JIT makes .NET slow."</strong></p>
    <p>The JIT costs startup time and buys steady-state speed. Because it compiles on the actual
    machine, it can use instructions that machine supports, and because it can recompile a hot
    method with knowledge of how the program is really behaving, it can produce code an
    ahead-of-time compiler could not. The honest statement is: <strong>.NET trades startup
    latency for run-time optimisation</strong>. That trade is bad for a command-line tool that
    runs for 50 ms and good for a service that runs for weeks.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Misconception</h4>
    <p><strong>"Compiled code hides my secrets."</strong></p>
    <p>Demonstrated false earlier in this module: a hard-coded key was recovered from the
    compiled assembly by a twenty-line byte search. Metadata preserves your type and parameter
    names, and decompilers reconstruct near-original source. Obfuscators raise the effort
    slightly and change nothing fundamental.</p>
  </div>

  <div class="callout callout--myth">
    <h4>Anti-pattern</h4>
    <p><strong>Copying build settings from a blog post to "make it faster".</strong></p>
    <p><code>DOTNET_TieredCompilation=0</code>, aggressive trimming, and Native AOT all appear in
    articles as straightforward wins. Each has a real cost: the first usually makes startup
    worse, and the other two can break reflection at run time rather than at build time. The
    measurement above showed the popular setting doing nothing and an unglamorous one worth
    1.5x. Change one setting, measure, keep it or revert it.</p>
  </div>
</section>

<section id="choosing">
  <h2>Choosing how to ship, in practice</h2>

  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Situation</th><th>Ship it as</th><th>Because</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>A container image you build and control</td>
          <td>Framework-dependent on a runtime base image</td>
          <td>The base image supplies the runtime and is shared between layers, so images stay small.</td>
        </tr>
        <tr>
          <td>A tool given to people whose machines you do not control</td>
          <td>Self-contained, single file</td>
          <td>Nothing to install, nothing to explain, no version support burden.</td>
        </tr>
        <tr>
          <td>A long-running API where deploy-time latency spikes matter</td>
          <td>Add <code>PublishReadyToRun=true</code></td>
          <td>Ships precompiled code, cutting the startup JIT cost; the JIT still re-optimises hot paths.</td>
        </tr>
        <tr>
          <td>A short-lived function or CLI, no reflection</td>
          <td>Native AOT</td>
          <td>Near-instant start and low memory; the JIT's steady-state advantage never pays off in a 50 ms process.</td>
        </tr>
        <tr>
          <td>Anything using reflection-heavy libraries</td>
          <td>Avoid trimming and AOT until tested</td>
          <td>Failures appear at run time in production, not at build time.</td>
        </tr>
        <tr>
          <td>You are not sure</td>
          <td>Framework-dependent, Release, PDBs archived</td>
          <td>The default is correct for most services; optimise when a measurement asks you to.</td>
        </tr>
      </tbody>
    </table>
  </div>
</section>

<section id="exercises">
  <h2>Exercises</h2>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 1</span>
      <span class="pill pill--easy">Easy</span>
    </div>
    <p>For each of the five problems below, say whether it is caught when you
    <strong>compile</strong> or only when you <strong>run</strong>, and give the reason in one
    sentence.</p>
    <ol>
      <li>A method name is misspelled: <code>Console.WritLine("hi");</code></li>
      <li>A configuration file the program opens at startup does not exist on the server.</li>
      <li>A method that promises to return a number has a path that returns nothing.</li>
      <li>Two numbers are divided, and the second one happens to be zero.</li>
      <li>The server has .NET 8 installed and the app targets .NET 10.</li>
    </ol>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <ol>
          <li><strong>Compile time.</strong> The metadata for <code>Console</code> lists its
          methods, and <code>WritLine</code> is not among them. The compiler checks every name
          against a known set before producing any IL.</li>
          <li><strong>Run time.</strong> The compiler never looks at the server's filesystem. The
          code is well-formed; whether the file exists is a fact about the world at the moment of
          execution.</li>
          <li><strong>Compile time.</strong> The compiler traces every path through the method
          and proves that one of them reaches the end without returning. This needs no knowledge
          of data — it is a contradiction in the code's own shape.</li>
          <li><strong>Run time.</strong> The compiler knows both operands are numbers, which is
          all it is checking. It cannot know the value. (One narrow exception: dividing by the
          literal <code>0</code> is caught at compile time, because then the value <em>is</em>
          part of the code.)</li>
          <li><strong>Neither — startup time, before your code runs at all.</strong> It compiles
          on your machine and the file is valid. The host process reads
          <code>runtimeconfig.json</code>, fails to find a matching runtime, and refuses to start.
          This third category is worth keeping separate in your head: build, host startup, then
          your code.</li>
        </ol>
        <p>The pattern: the compiler reasons about the <em>shape</em> of the code and nothing
        about the world. Anything involving files, networks, environment variables, user input,
        or the target machine's configuration is necessarily later.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 2</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>A colleague reports: "Our API's first few requests after each deploy take about 3 seconds,
    then it's fine. I've added <code>DOTNET_TieredCompilation=0</code> to the container to fix
    it." Startup got slightly worse.</p>
    <p>Explain why that setting did not help, describe how you would confirm the cause is the
    JIT rather than something else, and give the change you would make instead.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why the setting backfired.</strong> Tiered compilation exists to make startup
        <em>faster</em>: it compiles each method quickly and unoptimised on first call, and only
        pays for full optimisation later, in the background, for methods that turn out to be hot.
        Setting it to 0 disables that, so every method is fully optimised the first time it is
        called — the most expensive possible compilation, all of it on the critical path, for
        methods that may run once. Startup gets worse. The measurement in this module showed the
        setting sitting within noise of the default even on a tiny program, and it is worse on a
        large one.</p>

        <p><strong>Confirming the cause.</strong> A cold JIT and a cold database connection pool
        look identical from outside the process, so distinguish them:</p>
        <ul>
          <li>Log <code>JitInfo.GetCompilationTime()</code> and
          <code>JitInfo.GetCompiledMethodCount()</code> at startup and again after 60 seconds. If
          several hundred milliseconds of JIT time accumulate during exactly the slow window, the
          cause is compilation.</li>
          <li>Attach <code>dotnet-counters monitor --counters System.Runtime</code> and watch
          whether the slow period coincides with JIT activity.</li>
          <li>Confirm the effect disappears on the second request to the same endpoint but
          reappears for a different endpoint — that is the signature of per-method compilation,
          not of a shared resource warming up.</li>
        </ul>

        <p><strong>What to do instead</strong>, cheapest first:</p>
        <ol>
          <li><strong>Warm up before taking traffic.</strong> Have the container call its own main
          endpoints during startup and only report healthy afterwards. The JIT cost is then paid
          against synthetic requests instead of real users. This usually removes the symptom
          entirely and risks nothing.</li>
          <li><strong>Publish with <code>PublishReadyToRun=true</code></strong> so your own
          assemblies ship with precompiled machine code, as the framework already does. Costs
          image size, changes no behaviour.</li>
          <li><strong>Consider Native AOT</strong> only if the service is small and free of
          reflection, accepting that it must be built per target platform and that some libraries
          will not work.</li>
        </ol>
        <p>And revert <code>DOTNET_TieredCompilation=0</code>, having measured that it did not
        help.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 3</span>
      <span class="pill pill--medium">Medium</span>
    </div>
    <p>You inherit a service with this at the top of a file. A code reviewer says it is fine
    because "the published artifact is a compiled binary, not source". Show concretely that they
    are wrong, then describe what should replace it and why that is genuinely different rather
    than merely moving the problem.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public static class LedgerConfig
{
    public const string StripeSecretKey = "sk_live_51H8xQ2vBqRtYuIoP";
    public const string DatabasePassword = "Pa55w0rd-prod-2026";
}</code></pre>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Showing it concretely.</strong> Publish the app and search the assembly for the
        literal. String literals are stored as UTF-16, so a plain text search may miss them while
        a UTF-16 search finds them immediately:</p>
<pre data-lang="bash" data-title="terminal"><code># On Linux or macOS. -e l selects 16-bit little-endian strings.
strings -e l Ledger.dll | grep sk_live</code></pre>
        <p>The demo earlier in this module does the same thing in twenty lines of C# and found its
        key at byte offset 5,112 of an 8,704-byte assembly. Any decompiler goes further and shows
        the reviewer the original class, field names intact.</p>

        <p>There is a second problem specific to <code>const</code> that is worth knowing.
        A <code>const</code> is <strong>copied into every assembly that uses it at compile
        time</strong>. If another project referenced <code>LedgerConfig.StripeSecretKey</code>,
        the key is now baked into that assembly too, and rebuilding only this project will not
        remove it.</p>

        <p><strong>What replaces it.</strong> The value must arrive at run time, from outside the
        artifact:</p>
<pre data-lang="csharp" data-net="10" data-title="The shape of the fix"><code>public sealed class LedgerOptions
{
    public required string StripeSecretKey { get; init; }
    public required string DatabasePassword { get; init; }
}</code></pre>
        <p>populated from environment variables, a mounted secret file, or a secret manager, and
        supplied to the code that needs it. The mechanics are the subject of
        <a href="#/m/t3-13-options-pattern">The Options Pattern</a> and
        <a href="#/m/t3-14-secrets">Environments and Secret Handling</a>.</p>

        <p><strong>Why that is genuinely different.</strong> It is a fair challenge — the secret
        still exists somewhere. Three things change, and they matter:</p>
        <ul>
          <li><strong>The blast radius of the artifact shrinks.</strong> The build output can be
          copied to a laptop, pushed to a public registry, or attached to a support ticket
          without leaking anything.</li>
          <li><strong>Rotation stops requiring a rebuild.</strong> A leaked key becomes a
          configuration change and a restart, not a code change, a review, a build, and a
          deployment.</li>
          <li><strong>Access becomes auditable and separable.</strong> Every developer with
          repository access no longer automatically has production credentials.</li>
        </ul>
        <p>And the immediate action: the key in the repository history must be treated as
        compromised and rotated. Deleting the line does not remove it from git history or from
        any artifact already built.</p>
      </div>
    </details>
  </div>

  <div class="exercise">
    <div class="exercise__head">
      <span class="exercise__num">Exercise 4</span>
      <span class="pill pill--hard">Hard</span>
    </div>
    <p>A service loads plug-in handlers by name at startup. It works locally and in CI. The team
    enables Native AOT to cut cold-start time, the build succeeds with warnings that nobody
    reads, and in production every request fails with a message saying the handler type could not
    be found.</p>
<pre data-lang="csharp" data-net="10" data-bad="true"><code>public IPaymentHandler Resolve(string handlerName)
{
    Type? type = Type.GetType($"Ledger.Handlers.{handlerName}Handler");
    if (type is null)
    {
        throw new InvalidOperationException($"No handler for {handlerName}.");
    }
    return (IPaymentHandler)Activator.CreateInstance(type)!;
}</code></pre>
    <p>Explain precisely why AOT broke this when the JIT did not, why the failure appeared in
    production rather than at build time, and rewrite it so it survives AOT.</p>
    <details class="reveal">
      <summary>Show worked solution</summary>
      <div class="reveal__body">
        <p><strong>Why it worked under the JIT.</strong> A normal .NET deployment ships the full
        IL and metadata for every type. <code>Type.GetType</code> asks the runtime to look up a
        type by name in that metadata, and it is there, so the lookup succeeds. The name being
        built from a string at run time is not a problem, because the search happens at run time
        against a complete catalogue.</p>

        <p><strong>Why AOT broke it.</strong> Native AOT compiles ahead of time and ships no JIT.
        To do that it must decide, at build time, which types and methods can possibly be reached,
        and it discovers that by following references from the entry point. A type named only
        inside an interpolated string is invisible to that analysis — there is no reference to
        follow. The handler types are judged unreachable and removed. At run time
        <code>Type.GetType</code> returns <code>null</code> for a type that no longer exists, and
        the <code>InvalidOperationException</code> that was written for "unknown handler name"
        fires for every handler.</p>

        <p><strong>Why it surfaced in production.</strong> Two reasons compounding:</p>
        <ul>
          <li>The build <em>did</em> warn — <code>IL2057</code> and related trim-analysis
          warnings are emitted for exactly this pattern — and the warnings were not read. These
          warnings are the build-time signal, and treating them as noise converts a build failure
          into a production incident.</li>
          <li>Local development and CI do not use AOT. The team tested a different artifact from
          the one they shipped. Any build mode that changes what ends up in the output must be
          exercised before release.</li>
        </ul>

        <p><strong>The rewrite.</strong> Make the dependency something the build can see — a real
        reference to a real type. A dictionary of factory delegates does this and is also faster,
        clearer, and testable:</p>
<pre data-lang="csharp" data-net="10" data-title="AOT-safe"><code>public sealed class PaymentHandlerFactory
{
    // Every handler type is referenced directly here, so the build can see
    // that each one is reachable and must be kept.
    private static readonly Dictionary&lt;string, Func&lt;IPaymentHandler&gt;&gt; Handlers =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["card"] = static () =&gt; new CardHandler(),
            ["bank"] = static () =&gt; new BankTransferHandler(),
            ["wallet"] = static () =&gt; new WalletHandler()
        };

    public IPaymentHandler Resolve(string handlerName)
    {
        if (!Handlers.TryGetValue(handlerName, out Func&lt;IPaymentHandler&gt;? factory))
        {
            throw new InvalidOperationException($"No handler for {handlerName}.");
        }
        return factory();
    }
}</code></pre>
        <p>Four things improved at once. The build can prove the types are reachable, so trimming
        and AOT keep them. The lookup is a dictionary hit rather than a reflection search, which
        is far faster. An unknown name now genuinely means an unknown name, rather than possibly
        meaning "removed by the trimmer". And adding a handler becomes a compile-time change that
        fails the build if the type is wrong.</p>

        <p><strong>The process fix,</strong> which matters more than the code fix: build with
        <code>&lt;TreatWarningsAsErrors&gt;true&lt;/TreatWarningsAsErrors&gt;</code> or at minimum
        promote the <code>IL2xxx</code> trim-analysis warnings to errors, and run the AOT build in
        CI. The compiler had already found this bug; nobody was listening.</p>
      </div>
    </details>
  </div>
</section>

<section id="recall">
  <h2>Recall check</h2>

  <ol class="recall">
    <li>
      <p>What does the C# compiler produce, and why is it not machine code?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It produces an <strong>assembly</strong> — a <code>.dll</code> or <code>.exe</code>
        containing <strong>IL</strong> plus <strong>metadata</strong>. IL is processor-independent,
        so one build can run on x64 and Arm64 alike; the machine code is generated later, on the
        machine that actually runs it.</p>
      </div></details>
    </li>
    <li>
      <p>When does the JIT run, and how often does a given method get compiled?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>At run time, method by method, the first time each method is called. Each method is
        compiled once per process (possibly twice under tiered compilation: a quick tier-0
        version, then an optimised tier-1 version if it turns out to be hot). Subsequent calls run
        the cached machine code, which is why the first call measured 15-19x the second and every
        later call matched the second.</p>
      </div></details>
    </li>
    <li>
      <p>Name the three distinct moments at which a .NET application can fail to work, and give an
      example of each.</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p><strong>Build time</strong> — the compiler refuses, for example assigning a string to
        an <code>int</code> (CS0029). <strong>Host startup</strong> — the runtime is missing or the
        architecture is wrong, and the process never reaches your code.
        <strong>Run time</strong> — your code executes and something about the world is wrong, for
        example an index outside an array or a missing configuration file.</p>
      </div></details>
    </li>
    <li>
      <p>What is the practical difference between framework-dependent and self-contained
      publishing?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Framework-dependent ships only your code and requires the matching .NET runtime on the
        target machine — measured at 1 MB across 5 files. Self-contained bundles an entire copy of
        the runtime so nothing needs installing — measured at 78 MB across 192 files for the same
        three-line program. You are choosing who is responsible for having a runtime, and paying
        in size for taking that responsibility yourself.</p>
      </div></details>
    </li>
    <li>
      <p>Is a hard-coded secret protected by being compiled?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>No. String literals are stored in the assembly as UTF-16 and can be recovered with a
        byte search — demonstrated in this module at byte offset 5,112 of an 8,704-byte file.
        Metadata preserves type and member names, and decompilers reconstruct near-original C#.
        Secrets must be supplied at run time from outside the artifact.</p>
      </div></details>
    </li>
    <li>
      <p>Why can trimming and Native AOT break code that works perfectly under a normal build?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>Both decide at build time which code is reachable, by following references from the
        entry point, and delete the rest. Reflection names types and members in strings that only
        exist at run time, so those references are invisible to the analysis and the targets get
        removed. The failure then appears at run time. The build emits <code>IL2xxx</code>
        warnings about exactly this, which is why they should be treated as errors.</p>
      </div></details>
    </li>
    <li>
      <p>Someone proposes <code>DOTNET_TieredCompilation=0</code> to speed up a slow start. What
      is your response?</p>
      <details class="reveal"><summary>Show answer</summary><div class="reveal__body">
        <p>It usually makes startup worse, because it forces full optimisation of every method on
        first call instead of the quick tier-0 compile that tiering exists to provide. Measured
        here, it was within noise of the default. Reach for warm-up requests before taking
        traffic, and <code>PublishReadyToRun=true</code>, both of which target the actual cost —
        and measure before and after rather than accepting either recommendation on faith.</p>
      </div></details>
    </li>
  </ol>

  <div class="callout callout--note">
    <h4>Where this leads</h4>
    <p>The next module, <a href="#/m/t1-02-variables-and-types">Variables and Types</a>, moves
    from how code runs to what it operates on.
    <a href="#/m/t1-03-value-vs-reference">Value Types vs Reference Types</a> then explains where
    that data physically lives, which is the foundation of everything in
    <a href="#/m/t2-16-gc-fundamentals">Garbage Collection Fundamentals</a>.
    <a href="#/m/t1-31-reflection-and-attributes">Reflection and Attributes</a> returns to the
    metadata seen here and to the trimming constraints it creates, and
    <a href="#/m/t5-41-docker">Docker for .NET</a> takes the publishing decisions in this module
    all the way to a deployable image.</p>
  </div>
</section>

`
});
