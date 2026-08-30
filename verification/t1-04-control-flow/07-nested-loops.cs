// Demo 7 — the Ledger reconciliation incident. Matching payments to invoices
// with a nested loop, then with a lookup. Run with:
//   dotnet run -c Release 07-nested-loops.cs
using System.Diagnostics;
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

foreach (int size in new[] { 1_000, 5_000, 10_000, 20_000 })
{
    Invoice[] invoices = BuildInvoices(size);
    Payment[] payments = BuildPayments(size);

    Stopwatch sw = Stopwatch.StartNew();
    int nestedMatches = MatchWithNestedLoop(payments, invoices);
    sw.Stop();
    long nestedMs = sw.ElapsedMilliseconds;

    sw.Restart();
    int lookupMatches = MatchWithLookup(payments, invoices);
    sw.Stop();
    long lookupMs = sw.ElapsedMilliseconds;

    long comparisons = (long)size * size;

    Console.WriteLine(
        $"{size,6:N0} payments x {size,6:N0} invoices = {comparisons,15:N0} comparisons  " +
        $"nested {nestedMs,7:N0} ms   lookup {lookupMs,4:N0} ms   " +
        $"matches {nestedMatches}/{lookupMatches}");
}

Console.WriteLine();
Console.WriteLine("Doubling the input roughly quadruples the nested-loop time.");
Console.WriteLine("The lookup version stays close to linear.");

static int MatchWithNestedLoop(Payment[] payments, Invoice[] invoices)
{
    int matched = 0;
    foreach (Payment payment in payments)
    {
        foreach (Invoice invoice in invoices)
        {
            if (invoice.Reference == payment.Reference)
            {
                matched++;
                break;
            }
        }
    }
    return matched;
}

static int MatchWithLookup(Payment[] payments, Invoice[] invoices)
{
    Dictionary<string, Invoice> byReference = new Dictionary<string, Invoice>(
        invoices.Length, StringComparer.Ordinal);

    foreach (Invoice invoice in invoices)
    {
        byReference[invoice.Reference] = invoice;
    }

    int matched = 0;
    foreach (Payment payment in payments)
    {
        if (byReference.ContainsKey(payment.Reference))
        {
            matched++;
        }
    }
    return matched;
}

static Invoice[] BuildInvoices(int count)
{
    Invoice[] invoices = new Invoice[count];
    for (int i = 0; i < count; i++)
    {
        invoices[i] = new Invoice($"INV-{i:D7}", i * 100m);
    }
    return invoices;
}

static Payment[] BuildPayments(int count)
{
    // Reversed so the nested loop scans most of the invoice list each time,
    // which is what happens in production when references are not ordered.
    Payment[] payments = new Payment[count];
    for (int i = 0; i < count; i++)
    {
        payments[i] = new Payment($"INV-{count - 1 - i:D7}", i * 100m);
    }
    return payments;
}

sealed record Invoice(string Reference, decimal Amount);
sealed record Payment(string Reference, decimal Amount);
