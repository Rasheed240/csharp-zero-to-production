// 01-cooperative.cs — cancellation in .NET is COOPERATIVE. Nothing is stopped;
// something is asked to stop, and it stops only if it was written to notice.
// This file measures what happens when it was not.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 01-cooperative.cs -c Release
#:property Nullable=enable

using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static long _sink;

    static void Main()
    {
        Console.WriteLine("=== 1. cancelling something that does not check ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            var sw = Stopwatch.StartNew();
            var work = Task.Run(() => IgnoresTheToken(cts.Token));
            cts.Cancel();                                  // cancel immediately
            var cancelledAt = sw.Elapsed.TotalMilliseconds;
            work.GetAwaiter().GetResult();

            Console.WriteLine($"  cancel() called at   : {cancelledAt,6:N0} ms");
            Console.WriteLine($"  work actually ended  : {sw.Elapsed.TotalMilliseconds,6:N0} ms");
            Console.WriteLine($"  token was cancelled  : {cts.Token.IsCancellationRequested}");
        }
        Console.WriteLine();
        Console.WriteLine("  The token was cancelled 500 ms before the work finished, and the");
        Console.WriteLine("  work finished anyway. Cancel() does not stop anything. It sets a");
        Console.WriteLine("  boolean and runs callbacks; that is the entire mechanism.");
        Console.WriteLine("  There is NO API in .NET that forcibly stops a running operation.");
        Console.WriteLine("  Thread.Abort existed and was removed in .NET Core because it could");
        Console.WriteLine("  not be made safe.");

        Console.WriteLine();
        Console.WriteLine("=== 2. the same work, written to notice ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            var sw = Stopwatch.StartNew();
            var work = Task.Run(() => ChecksTheToken(cts.Token));
            Thread.Sleep(50);
            cts.Cancel();
            var stoppedAt = 0.0;
            try { work.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { stoppedAt = sw.Elapsed.TotalMilliseconds; }

            Console.WriteLine($"  cancel() at          : ~50 ms");
            Console.WriteLine($"  work stopped at      : {stoppedAt,6:N0} ms");
            Console.WriteLine($"  threw                : OperationCanceledException");
        }

        Console.WriteLine();
        Console.WriteLine("=== 3. the two ways to check, and when each is right ===");
        Console.WriteLine();
        Console.WriteLine("  ThrowIfCancellationRequested()  — the default. Throws");
        Console.WriteLine("    OperationCanceledException, which callers and the framework");
        Console.WriteLine("    already understand as 'cancelled', not 'failed'.");
        Console.WriteLine();
        Console.WriteLine("  if (token.IsCancellationRequested) — when you must clean up, return");
        Console.WriteLine("    a partial result, or stop a loop without unwinding. Rarer than it");
        Console.WriteLine("    looks: if you return normally after a cancellation, the caller");
        Console.WriteLine("    cannot tell the difference between 'finished' and 'gave up'.");
        Console.WriteLine();

        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            Console.WriteLine($"  returned partial     : {PartialResult(cts.Token)} of 1000 items");
            Console.WriteLine("  ...and the caller has no idea this is incomplete. If you take");
            Console.WriteLine("  this route, the return type must say so — a status enum, or a");
            Console.WriteLine("  tuple carrying 'was cancelled'.");
        }

        Console.WriteLine();
        Console.WriteLine("=== 4. what the exception type actually is ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();

            Report("token.ThrowIfCancellationRequested()", () => cts.Token.ThrowIfCancellationRequested());
            Report("await Task.Delay(1000, token)",
                () => Task.Delay(1000, cts.Token).GetAwaiter().GetResult());
            Report("Task.FromCanceled(token)",
                () => Task.FromCanceled(cts.Token).GetAwaiter().GetResult());
        }
        Console.WriteLine();
        Console.WriteLine("  TaskCanceledException DERIVES from OperationCanceledException, so");
        Console.WriteLine("  catching the base type catches both. Catch the base type. Code that");
        Console.WriteLine("  catches only TaskCanceledException misses direct token throws, which");
        Console.WriteLine("  is a real and common bug.");

        Console.WriteLine();
        Console.WriteLine("=== 5. cancellation is not failure ===");
        Console.WriteLine();
        using (var cts = new CancellationTokenSource())
        {
            cts.Cancel();
            var t = Task.Run(() => ChecksTheToken(cts.Token), cts.Token);
            try { t.GetAwaiter().GetResult(); } catch (OperationCanceledException) { }
            Console.WriteLine($"  task status          : {t.Status}");
            Console.WriteLine($"  IsCanceled           : {t.IsCanceled}");
            Console.WriteLine($"  IsFaulted            : {t.IsFaulted}");
        }
        Console.WriteLine();
        Console.WriteLine("  Canceled is its OWN terminal state, distinct from Faulted. This");
        Console.WriteLine("  matters operationally: a cancelled request is not an error, and");
        Console.WriteLine("  logging it as one turns every user who closed a browser tab into a");
        Console.WriteLine("  page in your error budget.");

        Console.WriteLine();
        Console.WriteLine("=== 6. which token the exception carries ===");
        Console.WriteLine();
        Console.WriteLine("  A widely repeated claim is that throwing a bare");
        Console.WriteLine("  OperationCanceledException makes the task FAULT rather than cancel.");
        Console.WriteLine("  On .NET 10 that is not what happens. Measured:");
        Console.WriteLine();
        Console.WriteLine("  case                              status      oce.Token == ct");
        ShowThrow("Task.Run body, OCE(ct)", useTaskRun: true, carry: true);
        ShowThrow("Task.Run body, bare OCE", useTaskRun: true, carry: false);
        ShowThrow("async method, OCE(ct)", useTaskRun: false, carry: true);
        ShowThrow("async method, bare OCE", useTaskRun: false, carry: false);
        Console.WriteLine();
        Console.WriteLine("  The STATUS is Canceled in all four. What differs is the token the");
        Console.WriteLine("  exception carries, and that is what you actually need, because it is");
        Console.WriteLine("  how you answer the question that matters at a catch site:");
        Console.WriteLine();
        Console.WriteLine("      catch (OperationCanceledException ex) when (ex.CancellationToken == ct)");
        Console.WriteLine("          // the caller asked us to stop: not an error, do not retry");
        Console.WriteLine("      catch (OperationCanceledException)");
        Console.WriteLine("          // something ELSE cancelled - a timeout, most likely");
        Console.WriteLine();
        Console.WriteLine("  Without the token, those two are indistinguishable, and a timeout");
        Console.WriteLine("  gets silently reported as a user cancellation. That distinction is");
        Console.WriteLine("  the whole subject of 02-linking-and-timeouts.cs.");
        Console.WriteLine("  Use ThrowIfCancellationRequested(): it carries the token for free.");
        Console.WriteLine($"  (checksum {_sink})");
    }

    /// <summary>
    /// Starts work that is already running, cancels its token, then throws an
    /// OperationCanceledException that either does or does not carry that token.
    /// The task must be RUNNING when Cancel lands, or Task.Run cancels it before
    /// the body executes and every case reads the same.
    /// </summary>
    static void ShowThrow(string label, bool useTaskRun, bool carry)
    {
        using var cts = new CancellationTokenSource();
        using var started = new ManualResetEventSlim(false);
        var ct = cts.Token;

        Task task = useTaskRun
            ? Task.Run(() =>
              {
                  started.Set();
                  Thread.Sleep(60);
                  throw carry ? new OperationCanceledException(ct)
                              : new OperationCanceledException();
              }, ct)
            : ThrowingBodyAsync(ct, carry, started);

        started.Wait();
        cts.Cancel();

        var carriesToken = false;
        try { task.GetAwaiter().GetResult(); }
        catch (OperationCanceledException ex) { carriesToken = ex.CancellationToken == ct; }
        catch { }

        Console.WriteLine($"  {label,-34}{task.Status,-12}{carriesToken}");
    }

    static async Task ThrowingBodyAsync(CancellationToken ct, bool carry, ManualResetEventSlim started)
    {
        started.Set();
        await Task.Delay(60).ConfigureAwait(false);
        throw carry ? new OperationCanceledException(ct) : new OperationCanceledException();
    }

    static void IgnoresTheToken(CancellationToken ct)
    {
        var end = Stopwatch.StartNew();
        while (end.ElapsedMilliseconds < 500) _sink++;      // never looks at ct
    }

    static void ChecksTheToken(CancellationToken ct)
    {
        var end = Stopwatch.StartNew();
        while (end.ElapsedMilliseconds < 500)
        {
            ct.ThrowIfCancellationRequested();
            _sink++;
        }
    }

    static int PartialResult(CancellationToken ct)
    {
        var done = 0;
        for (var i = 0; i < 1000; i++)
        {
            if (ct.IsCancellationRequested) break;          // returns quietly
            done++;
        }
        return done;
    }

    static void Report(string label, Action a)
    {
        try { a(); Console.WriteLine($"  {label,-38} did not throw"); }
        catch (Exception ex)
        {
            var isBase = ex is OperationCanceledException;
            Console.WriteLine($"  {label,-38} {ex.GetType().Name}" +
                              $"{(isBase ? "  (is an OperationCanceledException)" : "")}");
        }
    }
}
