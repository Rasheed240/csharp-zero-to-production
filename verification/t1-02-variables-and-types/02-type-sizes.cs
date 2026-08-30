// Demo 2 — the built-in numeric types, measured rather than memorised.
Console.WriteLine($"{"type",-10} {"bytes",5}  {"min",32}  {"max",32}");
Console.WriteLine(new string('-', 86));

Row("byte", sizeof(byte), byte.MinValue, byte.MaxValue);
Row("sbyte", sizeof(sbyte), sbyte.MinValue, sbyte.MaxValue);
Row("short", sizeof(short), short.MinValue, short.MaxValue);
Row("ushort", sizeof(ushort), ushort.MinValue, ushort.MaxValue);
Row("int", sizeof(int), int.MinValue, int.MaxValue);
Row("uint", sizeof(uint), uint.MinValue, uint.MaxValue);
Row("long", sizeof(long), long.MinValue, long.MaxValue);
Row("ulong", sizeof(ulong), ulong.MinValue, ulong.MaxValue);
Row("float", sizeof(float), float.MinValue, float.MaxValue);
Row("double", sizeof(double), double.MinValue, double.MaxValue);
Row("decimal", sizeof(decimal), decimal.MinValue, decimal.MaxValue);

Console.WriteLine();
Console.WriteLine($"bool    {sizeof(bool),5} bytes");
Console.WriteLine($"char    {sizeof(char),5} bytes  (one UTF-16 code unit)");

Console.WriteLine();
Console.WriteLine("significant decimal digits each can carry without losing information:");
Console.WriteLine($"  float   ~7   ({float.MaxValue:G7} at the top end)");
Console.WriteLine($"  double  ~15-17");
Console.WriteLine($"  decimal  28-29");

static void Row(string name, int size, object min, object max)
{
    Console.WriteLine($"{name,-10} {size,5}  {min,32}  {max,32}");
}
