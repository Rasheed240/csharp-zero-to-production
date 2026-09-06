// 05-minimal-example.cs — the smallest program showing an async stream: values
// arriving one at a time, consumed before the producer has finished.
// .NET SDK 10.0.400, runtime 10.0.11, Windows 11, 8 logical processors.
// Run: dotnet run 05-minimal-example.cs -c Release
#:property Nullable=enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        var sw = Stopwatch.StartNew();

        await foreach (var row in ReadRowsAsync())
            Console.WriteLine($"{sw.ElapsedMilliseconds,5} ms  consumed {row}");

        Console.WriteLine($"{sw.ElapsedMilliseconds,5} ms  done");
    }

    // async + IAsyncEnumerable<T> + yield return. No List, no Task<List>.
    static async IAsyncEnumerable<string> ReadRowsAsync(
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        for (var i = 1; i <= 3; i++)
        {
            await Task.Delay(100, ct).ConfigureAwait(false);   // a page arrives
            yield return $"row-{i}";
        }
    }
}
