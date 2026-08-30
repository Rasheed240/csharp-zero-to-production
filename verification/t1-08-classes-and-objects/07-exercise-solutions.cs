// Worked solutions from exercises 1, 2 and 4, verified.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- Exercise 1: initialisation order ------------------------------------
Console.WriteLine("Exercise 1 - predicted order C, A, B, D(null), then Label = E");
Derived d = new Derived { Label = "E" };
Console.WriteLine($"  final Label = {d.Label}");
Console.WriteLine();

// --- Exercise 2: the rewritten ReportBuilder -----------------------------
Console.WriteLine("Exercise 2 - ReportBuilder");
ReportBuilder builder = new ReportBuilder("acme", "March settlement", "<h1>{header}</h1>");
builder.AddRow("INV-1,144.00");
builder.AddRow("INV-2,250.00");

Console.WriteLine($"  Header            : {builder.Header}");
Console.WriteLine($"  Rows              : {builder.Rows.Count}");
Console.WriteLine($"  Rows static type  : IReadOnlyList<string>");
Console.WriteLine($"  Rows runtime type : {builder.Rows.GetType().Name}  <-- still the List; the guarantee is compile-time only");
Console.WriteLine($"  Render()          : {builder.Render()}");

try
{
    _ = new ReportBuilder("acme", "  ", "template");
}
catch (ArgumentException)
{
    Console.WriteLine("  blank title rejected -> ArgumentException");
}
Console.WriteLine();

// --- Does Lazy<T> really cache exceptions? -------------------------------
Console.WriteLine("Exercise 4 - checking the claims about Lazy<T> first");

int defaultAttempts = 0;
Lazy<string> defaultLazy = new Lazy<string>(() =>
{
    defaultAttempts++;
    throw new InvalidOperationException("load failed");
});

for (int i = 1; i <= 3; i++)
{
    try { _ = defaultLazy.Value; }
    catch (InvalidOperationException) { }
}
Console.WriteLine($"  default Lazy<T>          : factory ran {defaultAttempts} time(s) over 3 accesses");

int publicationAttempts = 0;
Lazy<string> publicationLazy = new Lazy<string>(() =>
{
    publicationAttempts++;
    throw new InvalidOperationException("load failed");
}, LazyThreadSafetyMode.PublicationOnly);

for (int i = 1; i <= 3; i++)
{
    try { _ = publicationLazy.Value; }
    catch (InvalidOperationException) { }
}
Console.WriteLine($"  Lazy<T> PublicationOnly  : factory ran {publicationAttempts} time(s) over 3 accesses");
Console.WriteLine();

// --- Exercise 4: the retryable shared loader -----------------------------
Console.WriteLine("Exercise 4 - ExchangeRateTable");

ExchangeRateTable.FailNextLoads(2);

for (int attempt = 1; attempt <= 4; attempt++)
{
    try
    {
        ExchangeRateTable table = ExchangeRateTable.Current;
        Console.WriteLine($"  attempt {attempt}: loaded, GBP->USD = {table.Rates["USD"]}");
    }
    catch (InvalidOperationException ex)
    {
        Console.WriteLine($"  attempt {attempt}: {ex.Message}   (retryable - nothing poisoned)");
    }
}

Console.WriteLine($"  load attempts made       : {ExchangeRateTable.LoadAttempts}");
Console.WriteLine("  (2 failures, then one success, then cached - no further loads)");

// Concurrency: many threads, exactly one successful load.
ExchangeRateTable.Invalidate();
ExchangeRateTable.ResetCounters();
Parallel.For(0, 32, i => { ExchangeRateTable table = ExchangeRateTable.Current; if (table.Rates.Count == 0) { Console.WriteLine(i); } });
Console.WriteLine($"  32 concurrent callers    : {ExchangeRateTable.LoadAttempts} load(s) performed");

// ---------------------------------------------------------------------------

static class Log
{
    public static string Trace(string what)
    {
        Console.WriteLine($"  {what}");
        return what;
    }
}

class Base
{
    private readonly string _b = Log.Trace("A");
    public Base() => Log.Trace("B");
}

class Derived : Base
{
    private readonly string _d = Log.Trace("C");
    public Derived() => Log.Trace($"D (Label={Label ?? "null"})");
    public string? Label { get; set; }
}

public sealed class ReportBuilder
{
    private readonly List<string> _rows = new List<string>();
    private readonly string _template;

    public ReportBuilder(string tenant, string title, string template)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tenant);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentException.ThrowIfNullOrWhiteSpace(template);

        Tenant = tenant;
        Title = title;
        _template = template;

        Header = $"{Tenant}: {Title}";
    }

    public string Tenant { get; }
    public string Title { get; }
    public string Header { get; }

    public IReadOnlyList<string> Rows => _rows;

    public void AddRow(string row)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(row);
        _rows.Add(row);
    }

    public string Render() => _template.Replace("{header}", Header, StringComparison.Ordinal);
}

public sealed class ExchangeRateTable
{
    private static readonly Lock Gate = new Lock();
    private static ExchangeRateTable? _current;
    private static int _loadAttempts;
    private static int _failuresRemaining;

    private ExchangeRateTable(IReadOnlyDictionary<string, decimal> rates) => Rates = rates;

    public IReadOnlyDictionary<string, decimal> Rates { get; }

    public static int LoadAttempts => _loadAttempts;

    public static ExchangeRateTable Current
    {
        get
        {
            ExchangeRateTable? existing = Volatile.Read(ref _current);
            if (existing is not null)
            {
                return existing;
            }

            lock (Gate)
            {
                if (_current is not null)
                {
                    return _current;
                }

                // If this throws, _current stays null and the NEXT caller
                // tries again. Nothing is poisoned.
                ExchangeRateTable loaded = Load();
                Volatile.Write(ref _current, loaded);
                return loaded;
            }
        }
    }

    public static void Invalidate()
    {
        lock (Gate)
        {
            _current = null;
        }
    }

    // Test hooks, not part of the published solution.
    public static void FailNextLoads(int count) => _failuresRemaining = count;
    public static void ResetCounters() => _loadAttempts = 0;

    private static ExchangeRateTable Load()
    {
        Interlocked.Increment(ref _loadAttempts);

        if (_failuresRemaining > 0)
        {
            _failuresRemaining--;
            throw new InvalidOperationException("rate feed unavailable");
        }

        Dictionary<string, decimal> rates = new Dictionary<string, decimal>(StringComparer.Ordinal)
        {
            ["GBP"] = 1.00m,
            ["USD"] = 1.27m,
            ["EUR"] = 1.17m
        };

        return new ExchangeRateTable(rates);
    }
}
