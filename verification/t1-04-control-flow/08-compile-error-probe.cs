// Compile-error probe. This file is EXPECTED NOT TO COMPILE.
// Its purpose is to produce the exact diagnostics quoted in the lesson.

int amount = 500;

// (1) C# has no implicit fall-through between non-empty cases.
switch (amount)
{
    case 500:
        Console.WriteLine("five hundred");
    case 1000:
        Console.WriteLine("one thousand");
        break;
}

// (2) A condition must be a bool. Assignment is not a condition.
if (amount = 500)
{
    Console.WriteLine("never");
}

// (3) Unreachable code after an unconditional return in a loop body.
foreach (int i in new[] { 1, 2, 3 })
{
    break;
    Console.WriteLine(i);
}

// (4) break outside any loop or switch.
break;

// (5) A switch expression must produce a value for every input, and the
//     compiler warns when it cannot prove that.
string label = amount switch
{
    500 => "five hundred"
};
