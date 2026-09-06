// 04-exercises.cs — Four problems, each stated as a symptom, with the answer
// measured rather than described.
//
// Run:  dotnet run 04-exercises.cs -c Release
//
// EXACT vs RATIO: every type name, count and exception name here is
// deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

// These exercises compare containers, so they build providers directly.
#pragma warning disable ASP0000

One();
Two();
Three();
await Four();

// ---------------------------------------------------------------------------
static void One()
{
    Console.WriteLine("EXERCISE 1 (easy) - the registration that did nothing");
    Console.WriteLine();
    Console.WriteLine("   A library ships an extension method that registers its own default");
    Console.WriteLine("   clock. Your application registers a test clock. Depending on which");
    Console.WriteLine("   line comes first, one of them wins.");
    Console.WriteLine();
    Console.WriteLine("   Which, and what should the library have written instead?");
    Console.WriteLine();

    Console.WriteLine("   order                                        resolves to");
    Console.WriteLine("   -----                                        -----------");

    foreach ((string label, Action<IServiceCollection> arrange) in new (string, Action<IServiceCollection>)[]
    {
        ("app first, library second (Add)", services =>
        {
            services.AddSingleton<IClock, AppClock>();
            services.AddSingleton<IClock, LibraryClock>();
        }),
        ("library first, app second (Add)", services =>
        {
            services.AddSingleton<IClock, LibraryClock>();
            services.AddSingleton<IClock, AppClock>();
        }),
        ("app first, library second (TryAdd)", services =>
        {
            services.AddSingleton<IClock, AppClock>();
            services.TryAddSingleton<IClock, LibraryClock>();
        }),
        ("library first, app second (TryAdd)", services =>
        {
            services.TryAddSingleton<IClock, LibraryClock>();
            services.AddSingleton<IClock, AppClock>();
        })
    })
    {
        var services = new ServiceCollection();
        arrange(services);

        using ServiceProvider provider = services.BuildServiceProvider();

        Console.WriteLine($"   {label,-42}   {provider.GetRequiredService<IClock>().GetType().Name}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: with Add, the LAST line wins, so the outcome depends on the");
    Console.WriteLine("   order two files happen to be called in. The library should use");
    Console.WriteLine("   TryAddSingleton, which registers only if nothing is registered yet.");
    Console.WriteLine();
    Console.WriteLine("   Read the last two rows carefully. TryAdd makes the application win in");
    Console.WriteLine("   BOTH orders, which is the actual requirement - not 'the library loses'");
    Console.WriteLine("   but 'the answer does not depend on ordering'.");
    Console.WriteLine();
    Console.WriteLine("   THE REVIEW RULE THIS GIVES YOU: Add in an application, TryAdd in");
    Console.WriteLine("   anything shared. An Add inside a library's registration method is a");
    Console.WriteLine("   statement that no consumer may override it, which is almost never");
    Console.WriteLine("   what was meant.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Two()
{
    Console.WriteLine("EXERCISE 2 (medium) - the constructor that ran in production only");
    Console.WriteLine();
    Console.WriteLine("   A class has two constructors: a full one, and a shorter one added");
    Console.WriteLine("   'for tests'. A pull request deletes an unrelated registration, and");
    Console.WriteLine("   an endpoint starts silently skipping its audit logging. Nothing");
    Console.WriteLine("   threw, and no test failed.");
    Console.WriteLine();
    Console.WriteLine("   Explain it.");
    Console.WriteLine();

    Console.WriteLine("   registrations present         constructor chosen                 audits");
    Console.WriteLine("   ---------------------         ------------------                 ------");

    foreach ((string label, bool auditRegistered) in new[]
    {
        ("IClock and IAuditLog", true),
        ("IClock only", false)
    })
    {
        var services = new ServiceCollection();
        services.AddSingleton<IClock, AppClock>();

        if (auditRegistered)
        {
            services.AddSingleton<IAuditLog, AuditLog>();
        }

        services.AddSingleton<RefundService>();

        using ServiceProvider provider = services.BuildServiceProvider();
        RefundService refunds = provider.GetRequiredService<RefundService>();

        refunds.Refund("PAY-1", 5_000);

        Console.WriteLine($"   {label,-27}   {refunds.Chosen,-33}  {refunds.AuditCount}");
    }

    Console.WriteLine();
    Console.WriteLine("   ANSWER: the container picks the greediest constructor it can satisfy.");
    Console.WriteLine("   Removing the IAuditLog registration did not cause a failure - it");
    Console.WriteLine("   caused a DIFFERENT CONSTRUCTOR to be chosen, the one that does not");
    Console.WriteLine("   audit.");
    Console.WriteLine();
    Console.WriteLine("   Nothing threw because both constructors are valid. No test failed");
    Console.WriteLine("   because the tests construct the class directly and pass both");
    Console.WriteLine("   arguments, so they exercise a code path production no longer uses.");
    Console.WriteLine();
    Console.WriteLine("   THE FIX IS THE RULE FROM EARLIER: ONE CONSTRUCTOR. A test that needs");
    Console.WriteLine("   fewer arguments passes a no-op implementation, which is three lines");
    Console.WriteLine("   and cannot silently change what production does.");
    Console.WriteLine();
    Console.WriteLine("   The general shape is worth naming, because it recurs: A FALLBACK THAT");
    Console.WriteLine("   IS SELECTED SILENTLY IS NOT A FALLBACK, IT IS A SECOND BEHAVIOUR NO");
    Console.WriteLine("   ONE IS WATCHING.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Three()
{
    Console.WriteLine("EXERCISE 3 (medium) - two gateways, one interface");
    Console.WriteLine();
    Console.WriteLine("   Checkout needs the card gateway. Payouts needs the bank gateway. Both");
    Console.WriteLine("   are IPaymentGateway, both are needed, and neither is a default.");
    Console.WriteLine();
    Console.WriteLine("   Three ways to do it. Which would you ship?");
    Console.WriteLine();

    // (a) Two interfaces that exist only to be different types.
    var interfaces = new ServiceCollection();
    interfaces.AddSingleton<ICardGateway, CardGateway>();
    interfaces.AddSingleton<IBankGateway, BankGateway>();
    interfaces.AddSingleton<CheckoutByInterface>();

    using (ServiceProvider provider = interfaces.BuildServiceProvider())
    {
        Console.WriteLine($"   a. two interfaces     {provider.GetRequiredService<CheckoutByInterface>().Describe()}");
    }

    // (b) A factory that picks by name.
    var factory = new ServiceCollection();
    factory.AddSingleton<CardGateway>();
    factory.AddSingleton<BankGateway>();
    factory.AddSingleton<IGatewayFactory, GatewayFactory>();
    factory.AddSingleton<CheckoutByFactory>();

    using (ServiceProvider provider = factory.BuildServiceProvider())
    {
        Console.WriteLine($"   b. a factory          {provider.GetRequiredService<CheckoutByFactory>().Describe()}");
    }

    // (c) Keyed registrations, .NET 8 and later.
    var keyed = new ServiceCollection();
    keyed.AddKeyedSingleton<IPaymentGateway, CardGateway>("card");
    keyed.AddKeyedSingleton<IPaymentGateway, BankGateway>("bank");
    keyed.AddSingleton<CheckoutByKey>();

    using (ServiceProvider provider = keyed.BuildServiceProvider())
    {
        Console.WriteLine($"   c. keyed services     {provider.GetRequiredService<CheckoutByKey>().Describe()}");
    }

    Console.WriteLine();
    Console.WriteLine("   ALL THREE WORK. The answer is about what each one costs.");
    Console.WriteLine();
    Console.WriteLine("     a. TWO INTERFACES. Every consumer states exactly what it needs, and");
    Console.WriteLine("        the compiler enforces it. The cost is two interfaces that exist");
    Console.WriteLine("        only to be different types, and a third the day a third gateway");
    Console.WriteLine("        arrives. Best when the two really are different capabilities -");
    Console.WriteLine("        if the bank gateway can do something the card one cannot, these");
    Console.WriteLine("        were never one interface.");
    Console.WriteLine();
    Console.WriteLine("     b. A FACTORY. One place decides, and the choice can depend on data -");
    Console.WriteLine("        a currency, a merchant setting, a route value. The cost is that");
    Console.WriteLine("        the lookup is by string and fails at runtime. Best when the");
    Console.WriteLine("        choice is genuinely dynamic.");
    Console.WriteLine();
    Console.WriteLine("     c. KEYED SERVICES. The least new code, and the key is visible at the");
    Console.WriteLine("        point of use. The cost is that the key is a string checked at");
    Console.WriteLine("        resolve time, and keyed registrations do not answer unkeyed asks.");
    Console.WriteLine("        Best when the set is fixed and known at compile time.");
    Console.WriteLine();
    Console.WriteLine("   WHAT WOULD I SHIP: (c) for a fixed pair chosen statically, (b) when");
    Console.WriteLine("   the choice depends on the request. (a) when they turn out to be two");
    Console.WriteLine("   different things - which, in payments, is more often than it looks.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task Four()
{
    Console.WriteLine("EXERCISE 4 (hard) - the class that cannot be tested");
    Console.WriteLine();
    Console.WriteLine("   Below is a class as it was actually written. Refactor it so that a");
    Console.WriteLine("   test can assert on its output, without a container, a network, a");
    Console.WriteLine("   clock or a random number generator.");
    Console.WriteLine();
    Console.WriteLine("   Then say which of its dependencies should NOT have become");
    Console.WriteLine("   constructor parameters.");
    Console.WriteLine();

    var untestable = new UntestableReceipt();

    Console.WriteLine($"   before, call 1   {untestable.Issue("PAY-1", 50_000)}");
    Console.WriteLine($"   before, call 2   {untestable.Issue("PAY-1", 50_000)}");
    Console.WriteLine();
    Console.WriteLine("   Two calls, same arguments, different answers, and nothing in the");
    Console.WriteLine("   signature says why.");
    Console.WriteLine();

    var testable = new TestableReceipt(
        new FixedClock(new DateTime(2026, 1, 1, 9, 0, 0)),
        new FixedReferences("REF-000001"),
        new ReceiptFormatter());

    string first = testable.Issue("PAY-1", 50_000);
    string second = testable.Issue("PAY-1", 50_000);

    Console.WriteLine($"   after, call 1    {first}");
    Console.WriteLine($"   after, call 2    {second}");
    Console.WriteLine($"   identical        {first == second}");
    Console.WriteLine();

    // And it still works when the container wires it with the real ones.
    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddSingleton<IClock, AppClock>();
    builder.Services.AddSingleton<IReferences, RandomReferences>();
    builder.Services.AddSingleton<ReceiptFormatter>();
    builder.Services.AddSingleton<TestableReceipt>();

    var app = builder.Build();

    Console.WriteLine($"   wired for real   {app.Services.GetRequiredService<TestableReceipt>().Issue("PAY-1", 50_000)}");

    await app.DisposeAsync();

    Console.WriteLine();
    Console.WriteLine("   ANSWER, part one: the two things that made it untestable were both");
    Console.WriteLine("   sources of NON-DETERMINISM reached through a static - DateTime.UtcNow");
    Console.WriteLine("   and Random.Shared. Neither appeared in the signature, so neither");
    Console.WriteLine("   could be replaced.");
    Console.WriteLine();
    Console.WriteLine("   That is the general rule for what has to be injected, and it is");
    Console.WriteLine("   narrower than 'everything': ANYTHING WHOSE ANSWER YOU DO NOT CONTROL.");
    Console.WriteLine("   The clock, randomness, the file system, the network, the machine name,");
    Console.WriteLine("   the current user, the environment.");
    Console.WriteLine();
    Console.WriteLine("   ANSWER, part two: ReceiptFormatter should NOT have become a");
    Console.WriteLine("   constructor parameter, and it is in the list above as the deliberate");
    Console.WriteLine("   wrong turn. It has no state, no I/O and one implementation. Injecting");
    Console.WriteLine("   it adds a registration, an interface nobody will implement twice, and");
    Console.WriteLine("   a parameter to every test - and buys a substitution nobody will make.");
    Console.WriteLine();
    Console.WriteLine("   A static method, or a plain call to new inside Issue, is the better");
    Console.WriteLine("   answer, and it can become injectable the day a second format exists.");
    Console.WriteLine();
    Console.WriteLine("   THE DISTINCTION TO CARRY AWAY: new IS NOT THE PROBLEM. Constructing a");
    Console.WriteLine("   formatter, a StringBuilder or a value object inside a method is");
    Console.WriteLine("   ordinary code. What is a problem is constructing - or statically");
    Console.WriteLine("   reaching - something whose behaviour you would ever want to change.");
}

// ---------------------------------------------------------------------------
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class AppClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed class LibraryClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed class FixedClock(DateTime fixedTime) : IClock
{
    public DateTime UtcNow => fixedTime;
}

public interface IAuditLog
{
    void Record(string entry);

    int Count { get; }
}

public sealed class AuditLog : IAuditLog
{
    private readonly List<string> _entries = [];

    public void Record(string entry) => _entries.Add(entry);

    public int Count => _entries.Count;
}

// Two constructors, and therefore two behaviours.
public sealed class RefundService
{
    private readonly IAuditLog? _audit;

    public RefundService(IClock clock)
    {
        Chosen = "RefundService(IClock)";
    }

    public RefundService(IClock clock, IAuditLog audit)
    {
        _audit = audit;
        Chosen = "RefundService(IClock, IAuditLog)";
    }

    public string Chosen { get; }

    public int AuditCount => _audit?.Count ?? 0;

    public void Refund(string paymentId, long amountMinor) =>
        _audit?.Record($"refund {paymentId} {amountMinor}");
}

// ---------------------------------------------------------------------------
public interface IPaymentGateway
{
    string Name { get; }
}

public interface ICardGateway : IPaymentGateway;

public interface IBankGateway : IPaymentGateway;

public sealed class CardGateway : ICardGateway
{
    public string Name => "CardGateway";
}

public sealed class BankGateway : IBankGateway
{
    public string Name => "BankGateway";
}

public sealed class CheckoutByInterface(ICardGateway card, IBankGateway bank)
{
    public string Describe() => $"{card.Name} + {bank.Name}";
}

public interface IGatewayFactory
{
    IPaymentGateway For(string method);
}

public sealed class GatewayFactory(CardGateway card, BankGateway bank) : IGatewayFactory
{
    public IPaymentGateway For(string method) => method switch
    {
        "card" => card,
        "bank" => bank,
        _ => throw new ArgumentOutOfRangeException(nameof(method), method, "unknown method")
    };
}

public sealed class CheckoutByFactory(IGatewayFactory gateways)
{
    public string Describe() => $"{gateways.For("card").Name} + {gateways.For("bank").Name}";
}

public sealed class CheckoutByKey(
    [FromKeyedServices("card")] IPaymentGateway card,
    [FromKeyedServices("bank")] IPaymentGateway bank)
{
    public string Describe() => $"{card.Name} + {bank.Name}";
}

// ---------------------------------------------------------------------------
public interface IReferences
{
    string Next();
}

public sealed class RandomReferences : IReferences
{
    public string Next() => $"REF-{Random.Shared.Next(100_000, 999_999)}";
}

public sealed class FixedReferences(string reference) : IReferences
{
    public string Next() => reference;
}

// Formats a receipt line. No state, no I/O, one implementation - so it is the
// dependency that should NOT be an interface.
public sealed class ReceiptFormatter
{
    public string Format(string reference, string paymentId, long amountMinor, DateTime at) =>
        $"{reference} {paymentId} {amountMinor / 100m:0.00} {at:yyyy-MM-dd HH:mm:ss}";
}

// As written: reaches statics, so nothing about it can be replaced.
public sealed class UntestableReceipt
{
    public string Issue(string paymentId, long amountMinor)
    {
        string reference = $"REF-{Random.Shared.Next(100_000, 999_999)}";

        return $"{reference} {paymentId} {amountMinor / 100m:0.00} " +
            $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}";
    }
}

// As refactored.
public sealed class TestableReceipt(IClock clock, IReferences references, ReceiptFormatter formatter)
{
    public string Issue(string paymentId, long amountMinor) =>
        formatter.Format(references.Next(), paymentId, amountMinor, clock.UtcNow);
}
