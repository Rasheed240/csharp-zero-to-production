// Demo 1 — copy semantics for value vs reference types.
Counter a = new Counter { Value = 1 };
Counter b = a;
b.Value = 99;
Console.WriteLine($"struct  -> a.Value = {a.Value}, b.Value = {b.Value}");

CounterObject c = new CounterObject { Value = 1 };
CounterObject d = c;
d.Value = 99;
Console.WriteLine($"class   -> c.Value = {c.Value}, d.Value = {d.Value}");

Counter s = new Counter { Value = 1 };
BumpValue(s);
Console.WriteLine($"struct after BumpValue(s)      -> {s.Value}");

BumpValueByRef(ref s);
Console.WriteLine($"struct after BumpValueByRef(s) -> {s.Value}");

CounterObject o = new CounterObject { Value = 1 };
BumpObject(o);
Console.WriteLine($"class after BumpObject(o)      -> {o.Value}");

CounterObject p = new CounterObject { Value = 1 };
ReplaceObject(p);
Console.WriteLine($"class after ReplaceObject(p)   -> {p.Value}");

static void BumpValue(Counter counter) => counter.Value = 42;
static void BumpValueByRef(ref Counter counter) => counter.Value = 42;
static void BumpObject(CounterObject counter) => counter.Value = 42;
static void ReplaceObject(CounterObject counter) => counter = new CounterObject { Value = 42 };

struct Counter
{
    public int Value;
}

class CounterObject
{
    public int Value;
}
