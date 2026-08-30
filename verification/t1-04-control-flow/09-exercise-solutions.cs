// The worked solutions from exercises 1, 2 and 4, verified.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// --- Exercise 1: predict the output --------------------------------------
Console.WriteLine("Exercise 1");
Console.Write("  (a) continue : ");
for (int i = 0; i < 3; i++)
{
    if (i == 1) { continue; }
    Console.Write($"{i} ");
}
Console.WriteLine();

Console.Write("  (b) break    : ");
for (int i = 0; i < 3; i++)
{
    if (i == 1) { break; }
    Console.Write($"{i} ");
}
Console.WriteLine();

Console.Write("  (c) do/while : ");
int n = 5;
do { Console.Write("ran "); } while (n < 0);
Console.WriteLine();

Console.Write("  (d) switch   : ");
string status = "disputed";
switch (status)
{
    case "pending": Console.Write("pending "); break;
    case "captured": Console.Write("captured "); break;
}
Console.WriteLine("after switch");
Console.WriteLine();

// --- Exercise 2: the rewritten TotalOutstanding --------------------------
Console.WriteLine("Exercise 2 - TotalOutstanding");

List<Invoice> invoices = new List<Invoice>
{
    new Invoice("INV-1", 100m, false),
    new Invoice("INV-2", 200m, false),
    new Invoice("INV-3", 300m, true),    // cancelled
    new Invoice("INV-4", 400m, false)
};

List<Payment> payments = new List<Payment>
{
    new Payment("INV-1", 100m),          // pays INV-1 exactly
    new Payment("INV-2", 50m),           // underpays INV-2
    new Payment("INV-2", 250m),          // a later, larger payment for INV-2
    new Payment("INV-9", 999m)           // unrelated
};

int invoiceCountBefore = invoices.Count;
decimal outstanding = TotalOutstanding(invoices, payments);

Console.WriteLine($"  outstanding            = {outstanding}   (expected 400: INV-4 only)");
Console.WriteLine($"  caller's list untouched = {invoices.Count == invoiceCountBefore}");
Console.WriteLine();

// --- Exercise 4: FindFirstGap --------------------------------------------
Console.WriteLine("Exercise 4 - FindFirstGap");
Gap(new[] { 3, 1, 2, 5, 4, 7 }, 1, "6");
Gap(new[] { 1, 2, 3 }, 1, "null");
Gap(new[] { 2, 2, 3 }, 1, "1");
Gap(Array.Empty<int>(), 1, "1");
Gap(new[] { -5, 0 }, 1, "1");
Gap(new[] { 10, 11, 13 }, 10, "12");
Console.WriteLine();

Console.WriteLine("  the sorting alternative, same cases:");
GapSorted(new[] { 3, 1, 2, 5, 4, 7 }, 1, "6");
GapSorted(new[] { 1, 2, 3 }, 1, "null");
GapSorted(new[] { 2, 2, 3 }, 1, "1");
GapSorted(new[] { 10, 11, 13 }, 10, "12");

static void Gap(int[] input, int start, string expected)
{
    int? actual = FindFirstGap(input, start);
    string shown = actual is null ? "null" : actual.Value.ToString(CultureInfo.InvariantCulture);
    Console.WriteLine($"  [{string.Join(",", input),-16}] start={start} -> {shown,-5} expected {expected,-5} {(shown == expected ? "ok" : "MISMATCH")}");
}

static void GapSorted(int[] input, int start, string expected)
{
    int? actual = FindFirstGapBySorting(input, start);
    string shown = actual is null ? "null" : actual.Value.ToString(CultureInfo.InvariantCulture);
    Console.WriteLine($"  [{string.Join(",", input),-16}] start={start} -> {shown,-5} expected {expected,-5} {(shown == expected ? "ok" : "MISMATCH")}");
}

static decimal TotalOutstanding(
    IReadOnlyList<Invoice> invoices,
    IReadOnlyList<Payment> payments)
{
    ArgumentNullException.ThrowIfNull(invoices);
    ArgumentNullException.ThrowIfNull(payments);

    // Build the lookup once: reference -> the largest payment seen for it.
    Dictionary<string, decimal> paidByReference =
        new Dictionary<string, decimal>(payments.Count, StringComparer.Ordinal);

    foreach (Payment payment in payments)
    {
        if (paidByReference.TryGetValue(payment.Reference, out decimal existing))
        {
            if (payment.Amount > existing)
            {
                paidByReference[payment.Reference] = payment.Amount;
            }
        }
        else
        {
            paidByReference[payment.Reference] = payment.Amount;
        }
    }

    decimal total = 0m;

    foreach (Invoice invoice in invoices)
    {
        if (invoice.IsCancelled)
        {
            continue;   // safe: foreach advances on its own
        }

        bool paid = paidByReference.TryGetValue(invoice.Reference, out decimal amountPaid)
            && amountPaid >= invoice.Amount;

        if (!paid)
        {
            total += invoice.Amount;
        }
    }

    return total;
}

static int? FindFirstGap(IReadOnlyCollection<int> sequenceNumbers, int start)
{
    ArgumentNullException.ThrowIfNull(sequenceNumbers);

    if (sequenceNumbers.Count == 0)
    {
        return start;
    }

    // One pass to build the set, and it de-duplicates for free.
    HashSet<int> present = new HashSet<int>(sequenceNumbers.Count);
    int highest = int.MinValue;

    foreach (int number in sequenceNumbers)
    {
        if (number >= start)
        {
            present.Add(number);
            if (number > highest)
            {
                highest = number;
            }
        }
    }

    // Everything was below start, so the very first expected number is missing.
    if (highest == int.MinValue)
    {
        return start;
    }

    // Bounded by the highest value seen, so this always terminates.
    for (int candidate = start; candidate <= highest; candidate++)
    {
        if (!present.Contains(candidate))
        {
            return candidate;
        }
    }

    return null;   // start..highest are all present, so there is no gap
}

static int? FindFirstGapBySorting(IReadOnlyCollection<int> sequenceNumbers, int start)
{
    int[] sorted = sequenceNumbers.Where(n => n >= start).ToArray();
    Array.Sort(sorted);

    int expected = start;
    foreach (int number in sorted)
    {
        if (number > expected) { return expected; }   // the gap
        if (number == expected) { expected++; }        // duplicates are skipped
    }
    return null;
}

sealed record Invoice(string Reference, decimal Amount, bool IsCancelled);
sealed record Payment(string Reference, decimal Amount);
