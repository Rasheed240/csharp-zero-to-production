// 02-stable-ordering.cs — Why a page boundary needs a unique sort key, and what
// a filter contract has to say no to.
//
// Run:  dotnet run 02-stable-ordering.cs -c Release
//
// EXACT vs RATIO: every count and identifier here is deterministic.

#:sdk Microsoft.NET.Sdk
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Linq.Expressions;
using System.Reflection;

TiedRows();
TheTiebreaker();
SortInjection();
FilterContract();

// ---------------------------------------------------------------------------
static void TiedRows()
{
    Console.WriteLine("1. Ordering by something that is not unique");
    Console.WriteLine();
    Console.WriteLine("   Twelve payments, sorted by status. Four are 'captured', four are");
    Console.WriteLine("   'pending', four are 'failed' - so within each status, nothing in the");
    Console.WriteLine("   ORDER BY says which comes first.");
    Console.WriteLine();

    Row[] rows = Rows();

    Console.WriteLine("   Two orderings, both of which satisfy ORDER BY Status:");
    Console.WriteLine();

    // Both of these are correct answers to "ORDER BY Status". A database may
    // return either, and which one it returns can change with the plan, the
    // index it chose, or whether the scan was parallel.
    Row[] planA = [.. rows.OrderBy(r => r.Status, StringComparer.Ordinal)
        .ThenBy(r => r.Id, StringComparer.Ordinal)];

    Row[] planB = [.. rows.OrderBy(r => r.Status, StringComparer.Ordinal)
        .ThenByDescending(r => r.Id, StringComparer.Ordinal)];

    Console.WriteLine($"     plan A   {string.Join(" ", planA.Select(r => r.Id))}");
    Console.WriteLine($"     plan B   {string.Join(" ", planB.Select(r => r.Id))}");
    Console.WriteLine();
    Console.WriteLine("   Now page through FIVE at a time - a page size that does not line up");
    Console.WriteLine("   with the groups of four - with the engine happening to use plan A for");
    Console.WriteLine("   the first query and plan B for the second:");
    Console.WriteLine();

    string[] page1 = [.. planA.Skip(0).Take(5).Select(r => r.Id)];
    string[] page2 = [.. planB.Skip(5).Take(5).Select(r => r.Id)];
    string[] page3 = [.. planA.Skip(10).Take(5).Select(r => r.Id)];

    Console.WriteLine($"     page 1   {string.Join(" ", page1)}");
    Console.WriteLine($"     page 2   {string.Join(" ", page2)}");
    Console.WriteLine($"     page 3   {string.Join(" ", page3)}");
    Console.WriteLine();

    string[] seen = [.. page1, .. page2, .. page3];

    Console.WriteLine($"   rows seen        {seen.Length}");
    Console.WriteLine($"   distinct         {seen.Distinct().Count()}");
    Console.WriteLine($"   seen twice       {string.Join(" ", seen.GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key))}");
    Console.WriteLine($"   never seen       {string.Join(" ", rows.Select(r => r.Id).Except(seen))}");
    Console.WriteLine();
    Console.WriteLine("   NOTHING WAS INSERTED OR DELETED. The table did not change at all - the");
    Console.WriteLine("   only thing that changed was which of two equally correct orderings the");
    Console.WriteLine("   engine produced.");
    Console.WriteLine();
    Console.WriteLine("   AN ORDER BY ON A NON-UNIQUE COLUMN DOES NOT DEFINE AN ORDER. It");
    Console.WriteLine("   defines a partial order, and every arrangement of the tied rows");
    Console.WriteLine("   satisfies it. The engine is free to pick one, and it picks per query.");
    Console.WriteLine();
    Console.WriteLine("   WHAT MAKES IT CHANGE, none of which is under your control:");
    Console.WriteLine();
    Console.WriteLine("     - a different execution plan, chosen from statistics that update as");
    Console.WriteLine("       the table grows;");
    Console.WriteLine();
    Console.WriteLine("     - a parallel scan, where the order rows arrive depends on which");
    Console.WriteLine("       worker finished first;");
    Console.WriteLine();
    Console.WriteLine("     - an index added by somebody else, which changes the order rows are");
    Console.WriteLine("       naturally produced in;");
    Console.WriteLine();
    Console.WriteLine("     - a version upgrade of the database.");
    Console.WriteLine();
    Console.WriteLine("   The last one is the reason this fails in production having worked in");
    Console.WriteLine("   testing for two years.");
    Console.WriteLine();
    Console.WriteLine("   NOTE THAT THIS FILE HAD TO MODEL THE TWO PLANS BY HAND. LINQ's OrderBy");
    Console.WriteLine("   is documented as STABLE - ties keep their input order - so it will not");
    Console.WriteLine("   produce this on its own. SQL ORDER BY carries no such guarantee, and");
    Console.WriteLine("   assuming it does is the mistake.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheTiebreaker()
{
    Console.WriteLine("2. The fix, which is one column");
    Console.WriteLine();
    Console.WriteLine("     ORDER BY Status, Id");
    Console.WriteLine();

    Row[] rows = Rows();

    // With Id in the ORDER BY there is only one arrangement that satisfies it,
    // so both plans have to produce the same rows in the same order.
    Row[] planA = [.. rows.OrderBy(r => r.Status, StringComparer.Ordinal)
        .ThenBy(r => r.Id, StringComparer.Ordinal)];

    Row[] planB = [.. rows.OrderByDescending(r => r.Id, StringComparer.Ordinal)
        .OrderBy(r => r.Status, StringComparer.Ordinal)
        .ThenBy(r => r.Id, StringComparer.Ordinal)];

    Console.WriteLine($"     starting from one order    {string.Join(" ", planA.Select(r => r.Id))}");
    Console.WriteLine($"     starting from another      {string.Join(" ", planB.Select(r => r.Id))}");
    Console.WriteLine($"     identical                  {planA.SequenceEqual(planB)}");
    Console.WriteLine();

    string[] seen =
    [
        .. planA.Skip(0).Take(5).Select(r => r.Id),
        .. planB.Skip(5).Take(5).Select(r => r.Id),
        .. planA.Skip(10).Take(5).Select(r => r.Id)
    ];

    Console.WriteLine($"   rows seen across three pages   {seen.Length}");
    Console.WriteLine($"   distinct                       {seen.Distinct().Count()}");
    Console.WriteLine();
    Console.WriteLine("   ADDING A UNIQUE COLUMN TO THE ORDER BY MAKES THE ORDER TOTAL, so");
    Console.WriteLine("   there is exactly one arrangement that satisfies it and no plan can");
    Console.WriteLine("   choose differently.");
    Console.WriteLine();
    Console.WriteLine("   THE RULE: EVERY PAGED QUERY ORDERS BY SOMETHING UNIQUE, ALWAYS. Not");
    Console.WriteLine("   'when the sort column has duplicates' - always, because a column");
    Console.WriteLine("   without duplicates today is one insert away from having them.");
    Console.WriteLine();
    Console.WriteLine("   The primary key is the obvious tiebreaker and is almost always right:");
    Console.WriteLine("   it is unique by definition, it is already indexed, and it is stable.");
    Console.WriteLine();
    Console.WriteLine("   CREATED-AT IS NOT A SUBSTITUTE, and this is worth being explicit about");
    Console.WriteLine("   because it is the commonest near-miss. Two payments created in the same");
    Console.WriteLine("   millisecond have the same timestamp, and a batch insert creates");
    Console.WriteLine("   hundreds of them. A timestamp is a nearly-unique column, and nearly");
    Console.WriteLine("   unique is the same as not unique for this purpose.");
    Console.WriteLine();
    Console.WriteLine("   THE TIEBREAKER ALSO HAS TO BE IN THE INDEX. ORDER BY Status, Id over an");
    Console.WriteLine("   index on Status alone still has to sort within each status - which");
    Console.WriteLine("   works, and does it by reading and sorting every matching row. The index");
    Console.WriteLine("   you want covers the whole ORDER BY, in that order.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void SortInjection()
{
    Console.WriteLine("3. Letting the caller choose the sort column");
    Console.WriteLine();
    Console.WriteLine("   ?sort=amountMinor is a reasonable feature request. The way it is");
    Console.WriteLine("   usually built is to pass the string through to the query.");
    Console.WriteLine();

    Row[] rows = Rows();

    Console.WriteLine("   caller sends           reflection-based sort        allow-listed sort");
    Console.WriteLine("   ------------           ---------------------        -----------------");

    foreach (string sort in new[]
    {
        "AmountMinor", "Status", "InternalRiskScore", "Nonsense", "Id"
    })
    {
        Console.WriteLine($"   ?sort={sort,-16}  {Reflected(rows, sort),-27}  {AllowListed(rows, sort)}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE THIRD ROW IS THE PROBLEM. InternalRiskScore is a real property on");
    Console.WriteLine("   the row, never exposed in any response, and the reflection-based sort");
    Console.WriteLine("   happily orders by it.");
    Console.WriteLine();
    Console.WriteLine("   THAT IS AN INFORMATION LEAK, and it does not need the value to be");
    Console.WriteLine("   returned. A caller who can order by a hidden column can read it one");
    Console.WriteLine("   bit at a time: sort ascending, sort descending, compare the two");
    Console.WriteLine("   orderings, and the relative risk score of every payment is now known.");
    Console.WriteLine();
    Console.WriteLine("   It is the same shape as an injection vulnerability without any SQL");
    Console.WriteLine("   being concatenated: THE CALLER SUPPLIED A NAME AND THE SERVER USED IT");
    Console.WriteLine("   TO REACH SOMETHING.");
    Console.WriteLine();
    Console.WriteLine("   THE FOURTH ROW IS THE SECOND PROBLEM: a name that matches nothing.");
    Console.WriteLine("   The reflection version throws, which becomes a 500 - a caller can");
    Console.WriteLine("   produce server errors at will, and your error rate is now controlled");
    Console.WriteLine("   by whoever is typing.");
    Console.WriteLine();
    Console.WriteLine("   THE ALLOW-LIST IS THE WHOLE FIX, and it is a dictionary:");
    Console.WriteLine();
    Console.WriteLine("     private static readonly Dictionary<string, Expression<Func<Row, object>>>");
    Console.WriteLine("         Sortable = new(StringComparer.OrdinalIgnoreCase)");
    Console.WriteLine("     {");
    Console.WriteLine("         [\"amount\"] = r => r.AmountMinor,");
    Console.WriteLine("         [\"status\"] = r => r.Status,");
    Console.WriteLine("         [\"id\"] = r => r.Id");
    Console.WriteLine("     };");
    Console.WriteLine();
    Console.WriteLine("   THE NAMES IN IT ARE PART OF YOUR API and the property names are not,");
    Console.WriteLine("   which is the second thing it buys: renaming a property is no longer a");
    Console.WriteLine("   breaking change to callers who sort by it.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void FilterContract()
{
    Console.WriteLine("4. The same argument for filters, plus one more");
    Console.WriteLine();
    Console.WriteLine("   A filter has everything a sort has - an allow-list of fields, a name");
    Console.WriteLine("   that is part of the API - and one thing more: SOME FILTERS ARE CHEAP");
    Console.WriteLine("   AND SOME ARE NOT, and the caller cannot tell which.");
    Console.WriteLine();
    Console.WriteLine("   filter                              what it costs against a real table");
    Console.WriteLine("   ------                              ----------------------------------");
    Console.WriteLine("   status eq 'captured'                an index seek, if Status is indexed");
    Console.WriteLine("   createdAt between two dates         a range scan on an indexed column");
    Console.WriteLine("   reference contains 'INV'            a FULL SCAN - no index can help a");
    Console.WriteLine("                                       leading wildcard");
    Console.WriteLine("   description matches a regex         a full scan, and per-row regex work");
    Console.WriteLine("   customer.address.city eq 'London'   a join, and possibly two");
    Console.WriteLine();
    Console.WriteLine("   THE THIRD AND FOURTH ROWS ARE THE ONES THAT TAKE A DATABASE DOWN, and");
    Console.WriteLine("   they look exactly as innocent as the first two from the client side.");
    Console.WriteLine("   ?reference=INV is 14 characters and a table scan.");
    Console.WriteLine();
    Console.WriteLine("   WHAT A FILTER CONTRACT HAS TO STATE, and it is four things:");
    Console.WriteLine();
    Console.WriteLine("     1. WHICH FIELDS are filterable. An allow-list, same as sorting, and");
    Console.WriteLine("        for the same reason - a hidden field must not be reachable.");
    Console.WriteLine();
    Console.WriteLine("     2. WHICH OPERATORS each field supports. 'contains' on an indexed");
    Console.WriteLine("        column is not the same offer as 'equals' on it, and a field can");
    Console.WriteLine("        legitimately support one and not the other.");
    Console.WriteLine();
    Console.WriteLine("     3. HOW MANY filters may be combined, because ten ORs is a different");
    Console.WriteLine("        query plan from one.");
    Console.WriteLine();
    Console.WriteLine("     4. WHAT HAPPENS TO AN UNRECOGNISED ONE. Rejecting with a 400 naming");
    Console.WriteLine("        the field is right; ignoring it silently returns unfiltered data");
    Console.WriteLine("        to somebody who believes it was filtered - which for a");
    Console.WriteLine("        permissions-shaped filter is a disclosure.");
    Console.WriteLine();
    Console.WriteLine("   THAT LAST POINT DESERVES ITS OWN SENTENCE: IGNORING AN UNKNOWN FILTER");
    Console.WriteLine("   IS THE WORST AVAILABLE BEHAVIOUR. It is silent, it returns more data");
    Console.WriteLine("   rather than less, and the caller has no way to detect it.");
    Console.WriteLine();
    Console.WriteLine("   AND THE RULE THAT COVERS THE WHOLE FILE: THE SET OF QUERIES A CALLER");
    Console.WriteLine("   CAN CAUSE YOU TO RUN IS PART OF YOUR API, whether you designed it or");
    Console.WriteLine("   not. An allow-list is how you make that set finite and known.");
}

// ---------------------------------------------------------------------------
// The version that reaches a property by name. Every property, including the
// ones no response contains.
static string Reflected(Row[] rows, string sort)
{
    try
    {
        PropertyInfo? property = typeof(Row).GetProperty(sort,
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);

        if (property is null)
        {
            throw new ArgumentException($"no property named '{sort}'");
        }

        Row[] sorted = [.. rows.OrderBy(r => property.GetValue(r))];

        return $"sorted by {property.Name}";
    }
    catch (Exception exception)
    {
        return $"{exception.GetType().Name} -> 500";
    }
}

// The version that maps a caller's name to a column you chose to expose.
static string AllowListed(Row[] rows, string sort)
{
    Dictionary<string, Func<Row, object>> sortable = new(StringComparer.OrdinalIgnoreCase)
    {
        ["amountMinor"] = r => r.AmountMinor,
        ["status"] = r => r.Status,
        ["id"] = r => r.Id
    };

    if (!sortable.TryGetValue(sort, out Func<Row, object>? key))
    {
        return "400: unknown sort field";
    }

    _ = rows.OrderBy(key).ThenBy(r => r.Id, StringComparer.Ordinal).ToList();

    return $"sorted by {sort.ToLowerInvariant()}, then id";
}

// ---------------------------------------------------------------------------
static Row[] Rows() =>
[
    new("PAY-001", "captured", 1_000, 71),
    new("PAY-002", "pending", 2_000, 12),
    new("PAY-003", "failed", 3_000, 95),
    new("PAY-004", "captured", 4_000, 33),
    new("PAY-005", "pending", 5_000, 88),
    new("PAY-006", "failed", 6_000, 4),
    new("PAY-007", "captured", 7_000, 51),
    new("PAY-008", "pending", 8_000, 67),
    new("PAY-009", "failed", 9_000, 22),
    new("PAY-010", "captured", 10_000, 79),
    new("PAY-011", "pending", 11_000, 40),
    new("PAY-012", "failed", 12_000, 58)
];

// InternalRiskScore is never returned by any endpoint. It is on the row
// because the risk engine needs it, which is the ordinary reason a type has
// more properties than a response does.
public sealed record Row(string Id, string Status, long AmountMinor, int InternalRiskScore);
