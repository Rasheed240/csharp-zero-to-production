// 02-interpolated-handlers.cs — What $"..." actually compiles to, and how to
// write a handler that does not format at all when nobody is listening.
//
// Run:  dotnet run 02-interpolated-handlers.cs -c Release
//
// EXACT vs RATIO: allocation figures and the "formatted" counters are exact and
// deterministic. Times are ratios.

using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;

Console.WriteLine("1. What an interpolated string compiles to");
Console.WriteLine();

WhatItCompilesTo();
TheLoggingProblem();
CustomHandler();
WhenTheHandlerIsWrong();

// ---------------------------------------------------------------------------
static void WhatItCompilesTo()
{
    long id = 4_000_821;

    Console.WriteLine("   Source:");
    Console.WriteLine("     string s = $\"PAY-{id} settled\";");
    Console.WriteLine();
    Console.WriteLine("   Roughly what the compiler emits since C# 10:");
    Console.WriteLine("     var handler = new DefaultInterpolatedStringHandler(13, 1);");
    Console.WriteLine("     handler.AppendLiteral(\"PAY-\");");
    Console.WriteLine("     handler.AppendFormatted(id);");
    Console.WriteLine("     handler.AppendLiteral(\" settled\");");
    Console.WriteLine("     string s = handler.ToStringAndClear();");
    Console.WriteLine();

    // The same thing written by hand, to show it is not magic.
    var handler = new DefaultInterpolatedStringHandler(13, 1);
    handler.AppendLiteral("PAY-");
    handler.AppendFormatted(id);
    handler.AppendLiteral(" settled");
    string byHand = handler.ToStringAndClear();

    string byInterpolation = $"PAY-{id} settled";

    Console.WriteLine($"   by hand         : {byHand}");
    Console.WriteLine($"   by interpolation: {byInterpolation}");
    Console.WriteLine($"   equal           : {byHand == byInterpolation}");
    Console.WriteLine();
    Console.WriteLine("   Two things follow from this, and they are the whole module.");
    Console.WriteLine();
    Console.WriteLine("   FIRST: AppendFormatted is GENERIC. The id is not boxed, and it is");
    Console.WriteLine("   formatted straight into the handler's buffer. string.Format would");
    Console.WriteLine("   box it into an object[] first.");
    Console.WriteLine();
    Console.WriteLine("   SECOND: the handler is chosen by OVERLOAD RESOLUTION. A method can");
    Console.WriteLine("   declare its own handler type and take control of whether the");
    Console.WriteLine("   formatting happens at all.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. The problem custom handlers were invented for.
// ---------------------------------------------------------------------------
static void TheLoggingProblem()
{
    Console.WriteLine("2. The logging problem");
    Console.WriteLine();

    var logger = new PlainLogger { Enabled = false };
    const int iterations = 500_000;

    Console.WriteLine("   Logging is DISABLED for all of these. Nothing is written.");
    Console.WriteLine();
    Console.WriteLine("   approach                              allocated   formatted     time");
    Console.WriteLine("   --------                              ---------   ---------     ----");

    Measure("LogDebug($\"...\")  string parameter ", iterations, () =>
    {
        // The string is BUILT before the call, then discarded inside it.
        logger.LogDebug($"payment {logger.Counter} settled at {DateTime.UnixEpoch:O}");
        return 0;
    }, () => logger.Formatted, () => logger.Formatted = 0);

    Measure("if (IsEnabled) LogDebug($\"...\")     ", iterations, () =>
    {
        // Correct, and everybody forgets it.
        if (logger.Enabled)
        {
            logger.LogDebug($"payment {logger.Counter} settled at {DateTime.UnixEpoch:O}");
        }

        return 0;
    }, () => logger.Formatted, () => logger.Formatted = 0);

    Console.WriteLine();
    Console.WriteLine("   The first row builds a string on every call and throws it away.");
    Console.WriteLine("   The guard fixes it and is three extra lines at every call site,");
    Console.WriteLine("   which is why it is so often missing.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. A handler that skips the formatting entirely.
// ---------------------------------------------------------------------------
static void CustomHandler()
{
    Console.WriteLine("3. A custom handler removes the guard");
    Console.WriteLine();

    var logger = new HandlerLogger { Enabled = false };
    const int iterations = 500_000;

    Console.WriteLine("   approach                              allocated   formatted     time");
    Console.WriteLine("   --------                              ---------   ---------     ----");

    Measure("LogDebug($\"...\")  custom handler   ", iterations, () =>
    {
        // No guard. The handler refuses to append anything when disabled.
        logger.LogDebug($"payment {logger.Counter} settled at {DateTime.UnixEpoch:O}");
        return 0;
    }, () => logger.Formatted, () => logger.Formatted = 0);

    logger.Enabled = true;

    Measure("the same, logging ENABLED           ", iterations, () =>
    {
        logger.LogDebug($"payment {logger.Counter} settled at {DateTime.UnixEpoch:O}");
        return 0;
    }, () => logger.Formatted, () => logger.Formatted = 0);

    Console.WriteLine();
    Console.WriteLine("   Same call site, no guard, and nothing is formatted while logging");
    Console.WriteLine("   is off. The handler's constructor receives the logger, checks");
    Console.WriteLine("   IsEnabled, and reports back through an out bool that tells the");
    Console.WriteLine("   COMPILER to skip every AppendFormatted call.");
    Console.WriteLine();
    Console.WriteLine("   That out parameter is the part worth remembering: the skipping is");
    Console.WriteLine("   done by generated code, not by the handler returning early. The");
    Console.WriteLine("   arguments are never even evaluated.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. The trap: arguments with side effects are not evaluated.
// ---------------------------------------------------------------------------
static void WhenTheHandlerIsWrong()
{
    Console.WriteLine("4. The trap in conditional evaluation");
    Console.WriteLine();

    var logger = new HandlerLogger { Enabled = false };
    int callCount = 0;

    logger.LogDebug($"expensive value: {ExpensiveAndSideEffecting()}");

    Console.WriteLine($"   logging disabled, side-effecting argument ran {callCount} time(s)");

    logger.Enabled = true;
    logger.LogDebug($"expensive value: {ExpensiveAndSideEffecting()}");

    Console.WriteLine($"   logging enabled,  side-effecting argument ran {callCount} time(s)");
    Console.WriteLine();
    Console.WriteLine("   This is the point of the feature and also its sharpest edge.");
    Console.WriteLine("   An argument inside an interpolated hole is NOT evaluated when the");
    Console.WriteLine("   handler says it is not interested.");
    Console.WriteLine();
    Console.WriteLine("   That is exactly what you want for an expensive ToString. It is a");
    Console.WriteLine("   bug if the expression has a side effect - incrementing a counter,");
    Console.WriteLine("   advancing an enumerator, calling something that mutates state.");
    Console.WriteLine("   That code will run in some environments and not others, decided by");
    Console.WriteLine("   a log level.");
    Console.WriteLine();
    Console.WriteLine("   The rule: an interpolation hole must be a pure expression.");

    int ExpensiveAndSideEffecting()
    {
        callCount++;
        return callCount * 100;
    }
}

// ---------------------------------------------------------------------------
static void Measure(string label, int iterations, Func<int> body,
    Func<int> readFormatted, Action resetFormatted)
{
    for (int i = 0; i < 1_000; i++)
    {
        body();
    }

    resetFormatted();

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();

    long before = GC.GetTotalAllocatedBytes(precise: true);
    var sw = Stopwatch.StartNew();

    for (int i = 0; i < iterations; i++)
    {
        body();
    }

    sw.Stop();
    long allocated = GC.GetTotalAllocatedBytes(precise: true) - before;

    Console.WriteLine($"   {label}   {allocated,10:N0} B   {readFormatted(),9:N0}   {sw.Elapsed.TotalMilliseconds,5:F0} ms");
}

// ---------------------------------------------------------------------------
// A logger taking a plain string. The caller builds the string whether or not
// it is wanted.
// ---------------------------------------------------------------------------
sealed class PlainLogger
{
    public bool Enabled { get; set; }

    public int Formatted { get; set; }

    public int Counter => 42;

    public void LogDebug(string message)
    {
        // The string already exists by the time this runs. Counting it here
        // is counting work the CALLER did.
        Formatted++;

        if (!Enabled)
        {
            return;
        }

        _ = message.Length;
    }
}

// ---------------------------------------------------------------------------
// A logger taking a custom interpolated string handler.
// ---------------------------------------------------------------------------
sealed class HandlerLogger
{
    public bool Enabled { get; set; }

    public int Formatted { get; set; }

    public int Counter => 42;

    // The handler type as the parameter is what makes this work. The compiler
    // rewrites the call site to construct it and append into it.
    public void LogDebug([InterpolatedStringHandlerArgument("")] ref DebugLogHandler handler)
    {
        if (!Enabled)
        {
            return;
        }

        _ = handler.ToStringAndClear().Length;
    }
}

// ---------------------------------------------------------------------------
// The handler. Three requirements: the attribute, a constructor with
// (literalLength, formattedCount), and AppendLiteral/AppendFormatted methods.
//
// The extra constructor parameters come from InterpolatedStringHandlerArgument
// on the method above: "" means the receiver, so the logger is passed in.
//
// The final out bool is the mechanism: returning false tells the compiler to
// skip every append AND to skip evaluating the arguments.
// ---------------------------------------------------------------------------
[InterpolatedStringHandler]
internal ref struct DebugLogHandler
{
    private DefaultInterpolatedStringHandler _inner;
    private readonly HandlerLogger _logger;
    private readonly bool _enabled;

    public DebugLogHandler(int literalLength, int formattedCount, HandlerLogger logger,
        out bool shouldAppend)
    {
        _logger = logger;
        _enabled = logger.Enabled;
        shouldAppend = _enabled;

        _inner = _enabled
            ? new DefaultInterpolatedStringHandler(literalLength, formattedCount)
            : default;
    }

    public void AppendLiteral(string value)
    {
        if (!_enabled)
        {
            return;
        }

        _logger.Formatted++;
        _inner.AppendLiteral(value);
    }

    public void AppendFormatted<T>(T value)
    {
        if (!_enabled)
        {
            return;
        }

        _logger.Formatted++;
        _inner.AppendFormatted(value);
    }

    public void AppendFormatted<T>(T value, string? format)
    {
        if (!_enabled)
        {
            return;
        }

        _logger.Formatted++;
        _inner.AppendFormatted(value, format);
    }

    public string ToStringAndClear() => _enabled ? _inner.ToStringAndClear() : string.Empty;
}
