// Demo 2 — the four loops, break and continue, and the trap that hangs a service.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

string[] references = { "INV-01", "INV-02", "SKIP", "INV-03", "STOP", "INV-04" };

Console.WriteLine("for - when you need the index");
for (int i = 0; i < references.Length; i++)
{
    Console.WriteLine($"  [{i}] {references[i]}");
}
Console.WriteLine();

Console.WriteLine("foreach - when you do not");
foreach (string reference in references)
{
    Console.WriteLine($"  {reference}");
}
Console.WriteLine();

Console.WriteLine("while - when the count is not known in advance");
int remaining = 3;
while (remaining > 0)
{
    Console.WriteLine($"  {remaining} retries left");
    remaining--;
}
Console.WriteLine();

Console.WriteLine("do/while - when the body must run at least once");
int attempt = 0;
do
{
    attempt++;
    Console.WriteLine($"  attempt {attempt}");
}
while (attempt < 1);
Console.WriteLine();

Console.WriteLine("continue skips the rest of THIS iteration; break leaves the loop");
foreach (string reference in references)
{
    if (reference == "SKIP")
    {
        continue;
    }
    if (reference == "STOP")
    {
        break;
    }
    Console.WriteLine($"  processing {reference}");
}
Console.WriteLine();

// The trap: continue in a while loop skips the increment too.
Console.WriteLine("the continue trap in a while loop");
int index = 0;
int iterations = 0;
const int SafetyLimit = 20;

while (index < references.Length)
{
    iterations++;
    if (iterations > SafetyLimit)
    {
        Console.WriteLine($"  bailed out after {SafetyLimit} iterations - index is still {index}");
        Console.WriteLine("  in production there is no safety limit and the thread hangs here");
        break;
    }

    if (references[index] == "SKIP")
    {
        // index++ never runs, so the condition never changes.
        continue;
    }

    Console.WriteLine($"  processed {references[index]}");
    index++;
}
Console.WriteLine();

Console.WriteLine("the same loop written as a for, where the increment cannot be skipped");
for (int i = 0; i < references.Length; i++)
{
    if (references[i] == "SKIP")
    {
        continue;   // the i++ in the for header still runs
    }
    Console.WriteLine($"  processed {references[i]}");
}
