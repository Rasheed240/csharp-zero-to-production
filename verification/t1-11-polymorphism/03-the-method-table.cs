// 03-the-method-table.cs — dispatch is not magic. Every object begins with a
// pointer to its type's method table, and that pointer is how the runtime finds
// the right override. This reads it directly.
// .NET 10.0.400, x64. Run: dotnet run 03-the-method-table.cs -c Release

#:property AllowUnsafeBlocks=true

using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

class Animal
{
    public virtual string Speak() => "...";
}

class Dog : Animal
{
    public override string Speak() => "woof";
}

class Cat : Animal
{
    public override string Speak() => "meow";
}

class Program
{
    // The first pointer-sized field of any reference type instance is its
    // method table pointer. This is an implementation detail of CoreCLR, shown
    // here to make dispatch concrete — never rely on it in real code.
    static unsafe nint MethodTableOf(object o)
    {
        // TypedReference gives us the address of the reference itself.
        var handle = GCHandle.Alloc(o, GCHandleType.Normal);
        nint objAddress = GCHandle.ToIntPtr(handle);
        // Dereference the handle to reach the object, then read its first word.
        nint objPtr = *(nint*)objAddress;
        nint mt = *(nint*)objPtr;
        handle.Free();
        return mt;
    }

    static void Main()
    {
        var d1 = new Dog();
        var d2 = new Dog();
        var c1 = new Cat();
        var a1 = new Animal();

        Console.WriteLine("Each object's first word, and its type's method table handle:");
        foreach (var (name, o) in new (string, object)[]
                 { ("d1 (Dog)", d1), ("d2 (Dog)", d2), ("c1 (Cat)", c1), ("a1 (Animal)", a1) })
        {
            nint fromObject = MethodTableOf(o);
            nint fromType = o.GetType().TypeHandle.Value;
            Console.WriteLine($"  {name,-12} object word = 0x{fromObject:X}   " +
                              $"TypeHandle = 0x{fromType:X}   same = {fromObject == fromType}");
        }

        Console.WriteLine();
        Console.WriteLine("Two Dogs share one method table; a Cat has a different one:");
        Console.WriteLine($"  d1 and d2 share : {MethodTableOf(d1) == MethodTableOf(d2)}");
        Console.WriteLine($"  d1 and c1 share : {MethodTableOf(d1) == MethodTableOf(c1)}");

        Console.WriteLine();
        Console.WriteLine("That word is the entire mechanism. A virtual call reads it,");
        Console.WriteLine("looks up a fixed slot, and jumps:");
        Animal[] zoo = { d1, c1, a1 };
        foreach (var a in zoo)
            Console.WriteLine($"  static type Animal, object is {a.GetType().Name,-7} -> {a.Speak()}");

        Console.WriteLine();
        Console.WriteLine($"size of a reference on this platform: {IntPtr.Size} bytes");
        Console.WriteLine($"object header + method table pointer: {2 * IntPtr.Size} bytes per object");
        Console.WriteLine($"Unsafe.SizeOf<Animal reference>()   : {Unsafe.SizeOf<Animal>()} bytes (the reference, not the object)");
    }
}
