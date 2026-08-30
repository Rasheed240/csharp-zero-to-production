using System.Runtime.InteropServices;

// Demo 8 — when you genuinely must mutate a value type in place, these are the
// three tools that do it without a hidden copy.

List<Tally> tallies = new List<Tally>
{
    new Tally { Name = "gbp", Count = 0 },
    new Tally { Name = "usd", Count = 0 }
};

// 1. CollectionsMarshal.AsSpan gives a window onto the list's own backing array,
//    so each element is a real variable, not a copy.
Span<Tally> span = CollectionsMarshal.AsSpan(tallies);
for (int i = 0; i < span.Length; i++)
{
    span[i].Count += 10;
}
Console.WriteLine($"after AsSpan      -> {tallies[0].Count}, {tallies[1].Count}");

// 2. A ref local is an alias for an existing storage location.
Tally[] array = new Tally[] { new Tally { Name = "eur", Count = 5 } };
ref Tally slot = ref array[0];
slot.Count += 100;
Console.WriteLine($"after ref local   -> {array[0].Count}");

// 3. foreach over a Span hands out ref elements, unlike foreach over a List.
foreach (ref Tally tally in CollectionsMarshal.AsSpan(tallies))
{
    tally.Count += 1;
}
Console.WriteLine($"after ref foreach -> {tallies[0].Count}, {tallies[1].Count}");

// The boring alternative that is usually the right answer: read, change, write back.
tallies[0] = tallies[0] with { Count = 999 };
Console.WriteLine($"after write-back  -> {tallies[0].Count}");

record struct Tally
{
    public string Name { get; set; }
    public int Count { get; set; }
}
