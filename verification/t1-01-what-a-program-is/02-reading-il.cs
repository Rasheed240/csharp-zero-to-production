// Demo 2 — proving that a compiled .NET assembly contains IL and metadata,
// not machine code, using nothing but the class library.
using System.Reflection;

MethodInfo add = typeof(Maths).GetMethod(nameof(Maths.Add))!;
MethodBody body = add.GetMethodBody()!;
byte[] il = body.GetILAsByteArray()!;

Console.WriteLine($"Maths.Add compiles to {il.Length} bytes of IL:");
Console.WriteLine($"  {Convert.ToHexString(il)}");
Console.WriteLine();

Console.WriteLine("Those bytes decode as:");
foreach (byte opcode in il)
{
    Console.WriteLine($"  0x{opcode:X2}  {Describe(opcode)}");
}
Console.WriteLine();

// The metadata is what makes this readable at all: names survive compilation.
Console.WriteLine("Metadata the runtime can still read at run time:");
Console.WriteLine($"  declaring type : {add.DeclaringType!.FullName}");
Console.WriteLine($"  method name    : {add.Name}");
Console.WriteLine($"  returns        : {add.ReturnType.Name}");
foreach (ParameterInfo p in add.GetParameters())
{
    Console.WriteLine($"  parameter      : {p.ParameterType.Name} {p.Name}");
}

static string Describe(byte opcode) => opcode switch
{
    0x02 => "ldarg.0   push argument 0 onto the stack",
    0x03 => "ldarg.1   push argument 1 onto the stack",
    0x58 => "add       pop two, add them, push the result",
    0x2A => "ret       return the value on top of the stack",
    _ => "(not decoded by this demo)"
};

static class Maths
{
    public static int Add(int a, int b) => a + b;
}
