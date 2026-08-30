// 02-the-runtime-does-not-care.cs — the four routes by which a non-nullable
// reference ends up holding null in a running process, none of which the
// compiler warned about. This is the gap between "no warnings" and "no nulls".
// .NET 10.0.400. Run: dotnet run 02-the-runtime-does-not-care.cs
#:property Nullable=enable
#:property NoWarn=IL2026;IL3050
// File-based apps default to the trimming-friendly JSON configuration, which
// disables reflection-based serialisation. A normal ASP.NET Core project has it
// on; here the resolver is supplied explicitly so the demo works either way.

using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

class InvoiceDto
{
    // Declared non-nullable. Nothing in the type system enforces that.
    public string Number { get; set; } = "";
    public string CustomerId { get; set; } = "";
    public decimal Amount { get; set; }
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- 1. JSON deserialisation ignores the annotation ---");
        const string json = """{ "Number": "INV-1", "Amount": 120.00 }""";
        var options = new JsonSerializerOptions { TypeInfoResolver = new DefaultJsonTypeInfoResolver() };
        var dto = JsonSerializer.Deserialize<InvoiceDto>(json, options)!;
        Console.WriteLine($"  Number     : {dto.Number}");
        Console.WriteLine($"  CustomerId : {dto.CustomerId ?? "(NULL)"}  <- declared 'string'");
        Console.WriteLine($"  is null    : {dto.CustomerId is null}");
        Console.WriteLine("  The property initialiser ran, so this one held \"\" instead.");
        Console.WriteLine("  Remove the '= \"\"' and it is null, with no warning at the");
        Console.WriteLine("  point of use, because the compiler trusts the declaration.");

        Console.WriteLine();
        Console.WriteLine("--- the same DTO without initialisers ---");
        var bare = JsonSerializer.Deserialize<BareDto>(json, options)!;
        Console.WriteLine($"  Number     : {bare.Number ?? "(NULL)"}");
        Console.WriteLine($"  CustomerId : {bare.CustomerId ?? "(NULL)"}  <- declared 'string'");
        Console.WriteLine($"  is null    : {bare.CustomerId is null}");
        Console.WriteLine("  A missing JSON property leaves a non-nullable string null.");
        Console.WriteLine("  Every later 'bare.CustomerId.Length' is warning-free and wrong.");

        Console.WriteLine();
        Console.WriteLine("--- 2. reflection writes whatever it is given ---");
        var viaReflection = new InvoiceDto();
        typeof(InvoiceDto).GetProperty(nameof(InvoiceDto.Number))!
            .SetValue(viaReflection, null);
        Console.WriteLine($"  Number after SetValue(null) : {viaReflection.Number ?? "(NULL)"}");
        Console.WriteLine("  No exception. Reflection sets fields, not contracts.");

        Console.WriteLine();
        Console.WriteLine("--- 3. default(T) in generic code ---");
        Console.WriteLine($"  Default<string>() is null : {Default<string>() is null}");
        Console.WriteLine("  An unconstrained T can be a reference type, so 'default'");
        Console.WriteLine("  is null and the signature still says it returns T.");

        Console.WriteLine();
        Console.WriteLine("--- 4. a library compiled WITHOUT nullable enabled ---");
        Console.WriteLine("  Types from such an assembly are 'oblivious': neither nullable");
        Console.WriteLine("  nor non-nullable. The compiler issues no warnings about them");
        Console.WriteLine("  in either direction, so their nulls arrive silently.");
        Console.WriteLine($"  This is why enabling nullable on one project does not");
        Console.WriteLine($"  protect it from its dependencies.");

        Console.WriteLine();
        Console.WriteLine("--- the null-forgiving operator is an assertion, not a check ---");
        string? unknown = null;
        string forgiven = unknown!;
        Console.WriteLine($"  after 'unknown!', is the value null? : {forgiven is null}");
        Console.WriteLine("  '!' emits NO code. It removes a warning and changes nothing");
        Console.WriteLine("  else. The IL for 'x!' and 'x' is identical.");
        Console.WriteLine();
        Console.WriteLine("  The next line dereferences it, and the compiler warns:");
        Console.WriteLine("    warning CS8602: Dereference of a possibly null reference.");
        Console.WriteLine("  Even though the value came through a '!'. The reason is the");
        Console.WriteLine("  'forgiven is null' test above: ASKING whether something is");
        Console.WriteLine("  null re-introduces the maybe-null state, because one branch of");
        Console.WriteLine("  that question has it null. The '!' asserted a state, and a");
        Console.WriteLine("  later test replaced it. Suppressed below so this file builds");
        Console.WriteLine("  clean; the warning is the lesson.");
#pragma warning disable CS8602
        try
        {
            Console.WriteLine(forgiven.Length);
        }
        catch (NullReferenceException)
        {
            Console.WriteLine("  ...and dereferencing it threw NullReferenceException.");
        }
#pragma warning restore CS8602
        Console.WriteLine();
        Console.WriteLine("  Worth knowing what does NOT warn: 'var x = unknown!; x.Length;'");
        Console.WriteLine("  is clean. 'var' keeps the flow state the '!' established, so");
        Console.WriteLine("  the assertion survives to the next line. It is the null TEST,");
        Console.WriteLine("  not the 'var', that undoes it.");

        Console.WriteLine();
        Console.WriteLine("--- what an actual runtime check looks like ---");
        try
        {
            Checked(null!);
        }
        catch (ArgumentNullException ex)
        {
            Console.WriteLine($"  ArgumentNullException, ParamName={ex.ParamName}");
        }
        Console.WriteLine("  ArgumentNullException.ThrowIfNull is one line and produces a");
        Console.WriteLine("  named, catchable failure at the boundary — which is what the");
        Console.WriteLine("  annotation alone cannot do.");

        Console.WriteLine();
        Console.WriteLine("--- the annotations ARE visible at runtime, as metadata ---");
        var prop = typeof(NullableProbe).GetProperty(nameof(NullableProbe.Maybe))!;
        var info = new NullabilityInfoContext().Create(prop);
        var prop2 = typeof(NullableProbe).GetProperty(nameof(NullableProbe.Definitely))!;
        var info2 = new NullabilityInfoContext().Create(prop2);
        Console.WriteLine($"  Maybe      : ReadState={info.ReadState}");
        Console.WriteLine($"  Definitely : ReadState={info2.ReadState}");
        Console.WriteLine("  NullabilityInfoContext reads the [Nullable] attributes the");
        Console.WriteLine("  compiler emitted. That is how serialisers and validators can");
        Console.WriteLine("  enforce what the runtime itself does not.");
    }

    static T Default<T>() => default!;

    static void Checked(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        Console.WriteLine(value.Length);
    }
}

// The compiler warns about exactly this shape, twice:
//   warning CS8618: Non-nullable property 'Number' must contain a non-null value
//   when exiting constructor. Consider adding the 'required' modifier or declaring
//   the property as nullable.
// Suppressed so the file builds clean; the warning IS the lesson.
#pragma warning disable CS8618
class BareDto
{
    public string Number { get; set; }
    public string CustomerId { get; set; }
    public decimal Amount { get; set; }
}
#pragma warning restore CS8618

class NullableProbe
{
    public string? Maybe { get; set; }
    public string Definitely { get; set; } = "";
}
