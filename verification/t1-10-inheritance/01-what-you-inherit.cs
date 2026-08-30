// Trimming analysis cannot follow reflection over BaseType; these warnings are
// about publishing trimmed, not about the demonstration.
#:property NoWarn=IL2070;IL2075

// 01-what-you-inherit.cs — a derived type gets every member of its base except
// constructors and finalisers. Private members are inherited but unreachable.
// .NET 10.0.400. Run: dotnet run 01-what-you-inherit.cs

using System;
using System.Linq;
using System.Reflection;

class Account
{
    private decimal _auditOnly = 99m;      // inherited, but not reachable by name

    // Only Account can read it. SavingsAccount carries the field and cannot see it.
    public string AuditLine() => "audit " + _auditOnly;
    protected decimal Balance;
    public string Id { get; }

    public Account(string id) => Id = id;

    public void Deposit(decimal amount) => Balance += amount;
    public virtual string Describe() => $"Account {Id}: {Balance:0.00}";
}

class SavingsAccount : Account
{
    private readonly decimal _rate;

    // Constructors are NOT inherited. This one must exist and must chain.
    public SavingsAccount(string id, decimal rate) : base(id) => _rate = rate;

    public void ApplyInterest() => Balance += Balance * _rate;   // Balance is protected

    public override string Describe() => $"Savings {Id}: {Balance:0.00} @ {_rate:P0}";
}

class Program
{
    const BindingFlags All = BindingFlags.Public | BindingFlags.NonPublic
                           | BindingFlags.Instance | BindingFlags.DeclaredOnly;

    static void Main()
    {
        var s = new SavingsAccount("SV-1", 0.05m);
        s.Deposit(1000m);          // inherited method, not redeclared
        s.ApplyInterest();
        Console.WriteLine(s.Describe());
        Console.WriteLine($"Id came from the base: {s.Id}");

        Console.WriteLine();
        Console.WriteLine("Declared ON SavingsAccount itself:");
        Dump(typeof(SavingsAccount));

        Console.WriteLine();
        Console.WriteLine("Declared on Account:");
        Dump(typeof(Account));

        Console.WriteLine();
        Console.WriteLine("Every instance field an object of this type carries:");
        var t = typeof(SavingsAccount);
        for (Type? cur = t; cur != null && cur != typeof(object); cur = cur.BaseType)
            foreach (var f in cur.GetFields(All))
                Console.WriteLine($"  from {cur.Name,-16} {f.Name}");

        Console.WriteLine();
        Console.WriteLine($"chain: {string.Join(" -> ", Chain(t))}");
        Console.WriteLine($"is a SavingsAccount an Account? {s is Account}");
        Console.WriteLine($"is an Account a SavingsAccount? {new Account("A") is SavingsAccount}");
    }

    static void Dump(Type t)
    {
        foreach (var m in t.GetMembers(All)
                           .Where(m => m.MemberType is MemberTypes.Method or MemberTypes.Field
                                       or MemberTypes.Property or MemberTypes.Constructor)
                           .OrderBy(m => m.MemberType.ToString()).ThenBy(m => m.Name))
            Console.WriteLine($"  {m.MemberType,-11} {m.Name}");
    }

    static string[] Chain(Type t)
    {
        var names = new System.Collections.Generic.List<string>();
        for (Type? cur = t; cur != null; cur = cur.BaseType) names.Add(cur.Name);
        return names.ToArray();
    }
}
