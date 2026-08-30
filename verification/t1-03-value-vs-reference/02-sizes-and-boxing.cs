using System.Runtime.CompilerServices;

Console.WriteLine($"int          {Unsafe.SizeOf<int>(),3} bytes");
Console.WriteLine($"Money        {Unsafe.SizeOf<Money>(),3} bytes");
Console.WriteLine($"LedgerEntry  {Unsafe.SizeOf<LedgerEntry>(),3} bytes");
Console.WriteLine($"a reference  {IntPtr.Size,3} bytes");

Console.WriteLine();

long before = GC.GetAllocatedBytesForCurrentThread();
object boxed = 42;
long after = GC.GetAllocatedBytesForCurrentThread();

Console.WriteLine($"boxing one int allocated {after - before} bytes on the heap");
Console.WriteLine($"unboxing it back gives   {(int)boxed}");

public readonly record struct Money(decimal Amount, string Currency);

public readonly record struct LedgerEntry(
    Guid Id,
    Money Amount,
    DateTimeOffset PostedAt,
    long SequenceNumber);
