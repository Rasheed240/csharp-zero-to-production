// Worked solutions from exercises 1, 2 and 4, verified.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- Exercise 1: predictions ---------------------------------------------
Console.WriteLine("Exercise 1");

int[] a = { 1, 2, 3 };
int[] b = a;
b[0] = 99;
Console.WriteLine($"  (a) a[0] after b[0]=99          -> {a[0]}");

int[] left = { 1, 2, 3 };
int[] right = { 1, 2, 3 };
Console.WriteLine($"  (b) left == right               -> {left == right}");

int[] grown = { 1, 2, 3 };
int[] alias = grown;
Array.Resize(ref grown, 5);
Console.WriteLine($"  (c) grown.Length alias.Length   -> {grown.Length} {alias.Length}");

int[] sorted = { 10, 20, 30, 40, 50 };
int found = Array.BinarySearch(sorted, 35);
Console.WriteLine($"  (d) BinarySearch(sorted, 35)    -> {found}  (insertion point {~found})");
Console.WriteLine("  (e) new bool[2][0]              -> CS0178, does not compile");
Console.WriteLine();

// --- the decimal LOH threshold quoted in exercise 2 ----------------------
Console.WriteLine("decimal LOH threshold quoted in exercise 2:");
int decimalThreshold = -1;
for (int n = 5_200; n <= 5_400; n++)
{
    decimal[] probe = new decimal[n];
    probe[0] = 1m;
    if (GC.GetGeneration(probe) == 2) { decimalThreshold = n; break; }
}
Console.WriteLine($"  first decimal[] on the LOH      -> {decimalThreshold:N0} elements");
Console.WriteLine($"  ({(85_000 - 24) / 16:N0} by arithmetic: (85,000 - 24) / 16)");
Console.WriteLine();

// --- Exercise 2: the rewritten DailyTotals --------------------------------
Console.WriteLine("Exercise 2 - DailyTotals");
DailyTotals totals = new DailyTotals(expectedCount: 4);
totals.Add(10.50m);
totals.Add(20.25m);
totals.Add(5.00m);
Console.WriteLine($"  Count                           -> {totals.Count}");
Console.WriteLine($"  Total()                         -> {totals.Total()}");
Console.WriteLine($"  Amounts is IReadOnlyList        -> {totals.Amounts is IReadOnlyList<decimal>}");
Console.WriteLine();

// --- Exercise 4: RingBuffer ----------------------------------------------
Console.WriteLine("Exercise 4 - RingBuffer");

RingBuffer<int> buffer = new RingBuffer<int>(3);
Console.WriteLine($"  empty                           -> [{string.Join(",", buffer.InOrder())}] count={buffer.Count}");

buffer.Add(1);
Console.WriteLine($"  after Add(1)                    -> [{string.Join(",", buffer.InOrder())}] count={buffer.Count}");

buffer.Add(2);
Console.WriteLine($"  after Add(2)  (partially full)  -> [{string.Join(",", buffer.InOrder())}] count={buffer.Count}");

buffer.Add(3);
Console.WriteLine($"  after Add(3)  (exactly full)    -> [{string.Join(",", buffer.InOrder())}] count={buffer.Count}");

buffer.Add(4);
Console.WriteLine($"  after Add(4)  (wrapped)         -> [{string.Join(",", buffer.InOrder())}] count={buffer.Count}");

buffer.Add(5);
buffer.Add(6);
buffer.Add(7);
Console.WriteLine($"  after 5,6,7   (wrapped twice)   -> [{string.Join(",", buffer.InOrder())}] count={buffer.Count}");

Console.WriteLine($"  indexer [0] (oldest)            -> {buffer[0]}");
Console.WriteLine($"  indexer [2] (newest)            -> {buffer[2]}");

try
{
    _ = buffer[3];
}
catch (ArgumentOutOfRangeException)
{
    Console.WriteLine("  indexer [3]                     -> ArgumentOutOfRangeException");
}

buffer.Clear();
Console.WriteLine($"  after Clear()                   -> [{string.Join(",", buffer.InOrder())}] count={buffer.Count}");

// A capacity-1 buffer, the degenerate case.
RingBuffer<string> single = new RingBuffer<string>(1);
single.Add("a");
single.Add("b");
Console.WriteLine($"  capacity 1, added a then b      -> [{string.Join(",", single.InOrder())}]");

// Constant-time growth check: a million adds into a small buffer.
RingBuffer<int> big = new RingBuffer<int>(1_000);
for (int i = 0; i < 1_000_000; i++) { big.Add(i); }
Console.WriteLine($"  1,000,000 adds into capacity 1000 -> count={big.Count}, oldest={big[0]}, newest={big[999]}");

// ---------------------------------------------------------------------------

public sealed class DailyTotals
{
    private readonly List<decimal> _amounts;

    public DailyTotals(int expectedCount = 0)
    {
        _amounts = expectedCount > 0
            ? new List<decimal>(expectedCount)
            : new List<decimal>();
    }

    public IReadOnlyList<decimal> Amounts => _amounts;

    public int Count => _amounts.Count;

    public void Add(decimal amount) => _amounts.Add(amount);

    public decimal Total()
    {
        decimal total = 0m;
        for (int i = 0; i < _amounts.Count; i++)
        {
            total += _amounts[i];
        }
        return total;
    }
}

public sealed class RingBuffer<T>
{
    private readonly T[] _items;
    private int _next;      // where the NEXT item will be written
    private int _count;     // how many slots are in use, capped at capacity

    public RingBuffer(int capacity)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);
        _items = new T[capacity];   // the only allocation this class ever makes
    }

    public int Capacity => _items.Length;

    public int Count => _count;

    public bool IsFull => _count == _items.Length;

    public void Add(T item)
    {
        _items[_next] = item;
        _next = (_next + 1) % _items.Length;   // wrap around

        if (_count < _items.Length)
        {
            _count++;
        }
    }

    /// <summary>Yields the buffered items oldest first.</summary>
    public IEnumerable<T> InOrder()
    {
        int start = _count < _items.Length ? 0 : _next;

        for (int i = 0; i < _count; i++)
        {
            yield return _items[(start + i) % _items.Length];
        }
    }

    /// <summary>Logical index 0 is the oldest item.</summary>
    public T this[int index]
    {
        get
        {
            ArgumentOutOfRangeException.ThrowIfNegative(index);
            ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(index, _count);

            int start = _count < _items.Length ? 0 : _next;
            return _items[(start + index) % _items.Length];
        }
    }

    public void Clear()
    {
        Array.Clear(_items, 0, _items.Length);
        _next = 0;
        _count = 0;
    }
}
