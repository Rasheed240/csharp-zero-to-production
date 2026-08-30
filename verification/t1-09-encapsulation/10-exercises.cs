#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property NoWarn=IL2026;IL3050

// 10-exercises.cs — every answer claimed in this module's exercises, run.
// .NET 10.0.400. Run: dotnet run 10-exercises.cs

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text.Json;

// ===== Exercise 2 ==========================================================
class Playlist
{
    private readonly List<string> _tracks = new();
    private readonly HashSet<string> _seen = new();

    public IReadOnlyList<string> Tracks => _tracks;
    public int UniqueCount => _seen.Count;

    public void Add(string track)
    {
        if (_seen.Add(track)) _tracks.Add(track);
    }
}

class FixedPlaylist
{
    private readonly List<string> _tracks = new();
    private readonly HashSet<string> _seen = new();
    private readonly ReadOnlyCollection<string> _view;

    public FixedPlaylist() => _view = new ReadOnlyCollection<string>(_tracks);

    public IReadOnlyList<string> Tracks => _view;
    public int UniqueCount => _seen.Count;

    public void Add(string track)
    {
        if (_seen.Add(track)) _tracks.Add(track);
    }
}

// ===== Exercise 4 ==========================================================
class BeforeSensor
{
    public static int AverageReads;
    private readonly double[] _samples;

    public BeforeSensor(double[] samples) => _samples = samples;

    public string Name { get; set; } = "";

    public double Average
    {
        get { AverageReads++; return _samples.Average(); }
    }

    // Does not throw. Returns Infinity when the smallest sample is zero.
    public double Peak => _samples.Max() / _samples.Min();
}

class AfterSensor
{
    public string Name { get; }
    public double Average { get; }
    public double? Peak { get; }

    public AfterSensor(string name, double[] samples)
    {
        Name = name;
        Average = samples.Average();
        double min = samples.Min();
        Peak = min == 0 ? null : samples.Max() / min;
    }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("===== Exercise 2: breaking Playlist =====");
        var p = new Playlist();
        p.Add("one");
        p.Add("two");
        p.Add("one");
        Console.WriteLine($"start: Tracks={p.Tracks.Count}, UniqueCount={p.UniqueCount}");

        if (p.Tracks is List<string> live)
        {
            live.Add("three");
            live.Add("three");
            Console.WriteLine($"after mutating the returned list: " +
                              $"Tracks={p.Tracks.Count}, UniqueCount={p.UniqueCount}");
        }

        var f = new FixedPlaylist();
        f.Add("one");
        f.Add("two");
        f.Add("one");
        IReadOnlyList<string> view = f.Tracks;
        Console.WriteLine($"fixed version: Tracks={view.Count}, UniqueCount={f.UniqueCount}");
        Console.WriteLine($"  can it be cast back to List<string>?  {view is List<string>}");
        try
        {
            ((IList<string>)view).Add("three");
        }
        catch (NotSupportedException)
        {
            Console.WriteLine("  forcing it through IList threw NotSupportedException");
        }

        Console.WriteLine();
        Console.WriteLine("===== Exercise 4: sensor readings =====");
        var samples = new double[] { 4, 8, 15, 16, 23, 42 };
        var withZero = new double[] { 0, 8, 15 };

        BeforeSensor.AverageReads = 0;
        var sensors = Enumerable.Range(0, 100)
                                .Select(i => new BeforeSensor(samples) { Name = $"S{i}" })
                                .ToList();

        var top = sensors.Where(s => s.Average > 10)
                         .OrderByDescending(s => s.Average)
                         .Take(3)
                         .Select(s => s.Name)
                         .ToList();

        Console.WriteLine($"returned {top.Count} names from {sensors.Count} sensors; " +
                          $"Average getter ran {BeforeSensor.AverageReads} times");

        Console.WriteLine();
        Console.WriteLine("what Peak does when a sample is zero:");
        var bad = new BeforeSensor(withZero);
        Console.WriteLine($"  bad.Peak = {bad.Peak}   (no exception thrown)");
        Console.WriteLine($"  double.IsInfinity: {double.IsInfinity(bad.Peak)}");

        Console.WriteLine("  the same division in other types:");
        decimal dz = 0m;
        try { Console.WriteLine($"    decimal: {15m / dz}"); }
        catch (DivideByZeroException) { Console.WriteLine("    decimal: DivideByZeroException"); }
        int iz = 0;
        try { Console.WriteLine($"    int:     {15 / iz}"); }
        catch (DivideByZeroException) { Console.WriteLine("    int:     DivideByZeroException"); }

        Console.WriteLine();
        Console.WriteLine("where it actually fails:");
        try
        {
            Console.WriteLine(JsonSerializer.Serialize(bad));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  {ex.GetType().Name}: {ex.Message[..72]}...");
        }

        Console.WriteLine();
        var after = new AfterSensor("S0", withZero);
        Console.WriteLine($"AfterSensor.Peak for a zero sample: " +
                          $"{(after.Peak is null ? "null" : after.Peak.ToString())}");
        Console.WriteLine($"  serialises to: {JsonSerializer.Serialize(after)}");

        var afterAll = Enumerable.Range(0, 100)
                                 .Select(i => new AfterSensor($"S{i}", samples))
                                 .ToList();
        var topAfter = afterAll.Where(s => s.Average > 10)
                               .OrderByDescending(s => s.Average)
                               .Take(3)
                               .Select(s => s.Name)
                               .ToList();
        Console.WriteLine($"AfterSensor returned {topAfter.Count} names with 0 recomputations");
    }
}
