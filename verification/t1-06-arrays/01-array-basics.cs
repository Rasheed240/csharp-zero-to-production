// Demo 1 — declaring arrays, their fixed length, zeroing, and the fact that an
// array variable holds a reference rather than the elements.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

Console.WriteLine("1. four ways to create the same array");
int[] a = new int[3] { 10, 20, 30 };
int[] b = new int[] { 10, 20, 30 };
int[] c = { 10, 20, 30 };
int[] d = [10, 20, 30];              // collection expression, C# 12+
Console.WriteLine($"   {string.Join(",", a)} | {string.Join(",", b)} | {string.Join(",", c)} | {string.Join(",", d)}");
Console.WriteLine();

Console.WriteLine("2. a new array is zeroed, never left as rubbish");
int[] numbers = new int[4];
string?[] names = new string?[3];
bool[] flags = new bool[2];
Console.WriteLine($"   new int[4]     -> {string.Join(",", numbers)}");
Console.WriteLine($"   new string?[3] -> {string.Join(",", names.Select(n => n is null ? "null" : n))}");
Console.WriteLine($"   new bool[2]    -> {string.Join(",", flags)}");
Console.WriteLine("   That zeroing is real work, proportional to the size.");
Console.WriteLine();

Console.WriteLine("3. the length is fixed for the array's whole life");
Console.WriteLine($"   a.Length       -> {a.Length}");
Console.WriteLine("   There is no Add, no Remove, and no way to grow it.");
Console.WriteLine();

Console.WriteLine("4. an array variable holds a REFERENCE");
int[] original = { 1, 2, 3 };
int[] alias = original;             // copies the reference, not the elements
alias[0] = 99;
Console.WriteLine($"   original[0] after alias[0] = 99 -> {original[0]}");
Console.WriteLine($"   ReferenceEquals(original, alias) -> {ReferenceEquals(original, alias)}");

int[] copy = (int[])original.Clone();
copy[0] = 7;
Console.WriteLine($"   original[0] after copy[0] = 7    -> {original[0]}   (Clone made a real copy)");
Console.WriteLine();

Console.WriteLine("5. equality compares references, not contents");
int[] left = { 1, 2, 3 };
int[] right = { 1, 2, 3 };
Console.WriteLine($"   left == right                    -> {left == right}");
Console.WriteLine($"   left.SequenceEqual(right)        -> {left.SequenceEqual(right)}");
Console.WriteLine();

Console.WriteLine("6. Array.Empty<T>() returns a shared instance; new T[0] does not");
int[] empty1 = Array.Empty<int>();
int[] empty2 = Array.Empty<int>();
int[] empty3 = new int[0];
Console.WriteLine($"   ReferenceEquals(Array.Empty, Array.Empty) -> {ReferenceEquals(empty1, empty2)}");
Console.WriteLine($"   ReferenceEquals(Array.Empty, new int[0])  -> {ReferenceEquals(empty1, empty3)}");
Console.WriteLine();

Console.WriteLine("7. searching a SORTED array with BinarySearch");
int[] sorted = { 10, 20, 30, 40, 50 };
Console.WriteLine($"   BinarySearch(sorted, 30)   -> {Array.BinarySearch(sorted, 30)}   (index)");
Console.WriteLine($"   BinarySearch(sorted, 35)   -> {Array.BinarySearch(sorted, 35)}   (~ of the insertion point)");

int[] unsorted = { 50, 10, 40, 20, 30 };
Console.WriteLine($"   BinarySearch(unsorted, 30) -> {Array.BinarySearch(unsorted, 30)}   <-- wrong, and no error");
Console.WriteLine("   BinarySearch on an unsorted array returns nonsense silently.");
