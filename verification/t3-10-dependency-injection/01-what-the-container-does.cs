// 01-what-the-container-does.cs — The resolution rules, measured. Several of
// them are not what people assume, and two of them are silent.
//
// Run:  dotnet run 01-what-the-container-does.cs -c Release
//
// EXACT vs RATIO: every type name and exception name here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

// This file studies the container itself, so it builds providers directly
// rather than letting a WebApplication do it. ASP0000 warns about exactly that,
// and is correct about application code - see 02-composition-root.cs for why.
#pragma warning disable ASP0000

WhichConstructor();
DuplicateRegistrations();
Collections();
OpenGenerics();
Keyed();
WhenItCannot();

// ---------------------------------------------------------------------------
static void WhichConstructor()
{
    Console.WriteLine("1. Which constructor it picks");
    Console.WriteLine();
    Console.WriteLine("   Gateway has three constructors: one taking nothing, one taking a clock,");
    Console.WriteLine("   and one taking a clock and a retry policy.");
    Console.WriteLine();

    foreach ((string label, Action<IServiceCollection> register) in new[]
    {
        ("nothing else registered", (Action<IServiceCollection>)(s => { })),
        ("IClock registered", s => s.AddSingleton<IClock, SystemClock>()),
        ("IClock and IRetryPolicy", s => { s.AddSingleton<IClock, SystemClock>();
                                           s.AddSingleton<IRetryPolicy, FixedRetry>(); })
    })
    {
        var services = new ServiceCollection();
        register(services);
        services.AddSingleton<Gateway>();

        using ServiceProvider provider = services.BuildServiceProvider();
        Gateway gateway = provider.GetRequiredService<Gateway>();

        Console.WriteLine($"   {label,-26}  ->  {gateway.Chosen}");
    }

    Console.WriteLine();
    Console.WriteLine("   IT PICKS THE GREEDIEST CONSTRUCTOR IT CAN SATISFY - the one with the");
    Console.WriteLine("   most parameters, all of which it can resolve. Register one more");
    Console.WriteLine("   service and a different constructor runs, with no change to the");
    Console.WriteLine("   class and nothing in the output to say so.");
    Console.WriteLine();
    Console.WriteLine("   THE PRACTICAL RULE: give an injectable class ONE constructor. Two");
    Console.WriteLine("   constructors means the behaviour of your class depends on a");
    Console.WriteLine("   registration in a different file, which is a coupling nobody can see");
    Console.WriteLine("   from either end.");
    Console.WriteLine();
    Console.WriteLine("   A second constructor for tests is the usual reason people add one, and");
    Console.WriteLine("   it is the case where the risk is highest: the constructor that never");
    Console.WriteLine("   runs in production is the one that runs when a registration is");
    Console.WriteLine("   removed.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void DuplicateRegistrations()
{
    Console.WriteLine("2. Registering the same interface twice");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddSingleton<IClock, SystemClock>();
    services.AddSingleton<IClock, FixedClock>();

    using ServiceProvider provider = services.BuildServiceProvider();

    Console.WriteLine($"   GetRequiredService<IClock>()   {provider.GetRequiredService<IClock>().GetType().Name}");
    Console.WriteLine($"   GetServices<IClock>() count    {provider.GetServices<IClock>().Count()}");
    Console.WriteLine();
    Console.WriteLine("   LAST REGISTRATION WINS for a single resolve, and NOTHING IS LOST -");
    Console.WriteLine("   both are still there and both come back as a collection.");
    Console.WriteLine();
    Console.WriteLine("   No warning, no error. A second AddSingleton in a library's extension");
    Console.WriteLine("   method silently replaces yours if it runs later, and silently loses");
    Console.WriteLine("   if it runs earlier.");
    Console.WriteLine();

    var tried = new ServiceCollection();
    tried.AddSingleton<IClock, SystemClock>();
    tried.TryAddSingleton<IClock, FixedClock>();

    using ServiceProvider triedProvider = tried.BuildServiceProvider();

    Console.WriteLine($"   after TryAddSingleton          {triedProvider.GetRequiredService<IClock>().GetType().Name}");
    Console.WriteLine($"   registrations                  {triedProvider.GetServices<IClock>().Count()}");
    Console.WriteLine();
    Console.WriteLine("   TryAdd REGISTERS ONLY IF NOTHING IS REGISTERED FOR THAT TYPE YET. It");
    Console.WriteLine("   is what a library should use for its own defaults, so that an");
    Console.WriteLine("   application registering its own implementation keeps it whichever");
    Console.WriteLine("   order the two lines run in.");
    Console.WriteLine();
    Console.WriteLine("   READ IT AS A STATEMENT OF INTENT. Add says 'this is the one'. TryAdd");
    Console.WriteLine("   says 'this will do if nobody has a better idea'.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Collections()
{
    Console.WriteLine("3. Asking for all of them");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddSingleton<IReceiptRule, AmountRule>();
    services.AddSingleton<IReceiptRule, CurrencyRule>();
    services.AddSingleton<IReceiptRule, ReferenceRule>();
    services.AddSingleton<ReceiptValidator>();

    using ServiceProvider provider = services.BuildServiceProvider();
    ReceiptValidator validator = provider.GetRequiredService<ReceiptValidator>();

    Console.WriteLine($"   rules injected   {validator.RuleCount}");
    Console.WriteLine($"   in order         {validator.Names}");
    Console.WriteLine();
    Console.WriteLine("   A CONSTRUCTOR PARAMETER OF TYPE IEnumerable<T> GETS EVERY");
    Console.WriteLine("   REGISTRATION, in registration order. Nothing extra is required to");
    Console.WriteLine("   make that work.");
    Console.WriteLine();
    Console.WriteLine("   This is the plug-in shape, and it is the reason multiple");
    Console.WriteLine("   registrations are allowed at all. A new rule is one AddSingleton and");
    Console.WriteLine("   no edit to the validator.");
    Console.WriteLine();
    Console.WriteLine("   THE ORDER IS THE REGISTRATION ORDER, which means it is a real part of");
    Console.WriteLine("   your configuration. If the order matters - a pipeline of handlers, a");
    Console.WriteLine("   chain of rules where one short-circuits - it is being decided in the");
    Console.WriteLine("   file where the lines happen to sit.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void OpenGenerics()
{
    Console.WriteLine("4. One registration for every closed type");
    Console.WriteLine();

    var services = new ServiceCollection();

    // No angle-bracket arguments: this registers the shape, not one type.
    services.AddSingleton(typeof(IRepository<>), typeof(InMemoryRepository<>));

    using ServiceProvider provider = services.BuildServiceProvider();

    IRepository<Payment> payments = provider.GetRequiredService<IRepository<Payment>>();
    IRepository<Invoice> invoices = provider.GetRequiredService<IRepository<Invoice>>();

    Console.WriteLine($"   IRepository<Payment>   {payments.GetType().Name} of {payments.ItemType.Name}");
    Console.WriteLine($"   IRepository<Invoice>   {invoices.GetType().Name} of {invoices.ItemType.Name}");
    Console.WriteLine();
    Console.WriteLine("   AN OPEN GENERIC REGISTRATION COVERS EVERY CLOSED FORM. One line, and");
    Console.WriteLine("   a repository for a type nobody has written yet resolves.");
    Console.WriteLine();
    Console.WriteLine("   It is also where the convenience stops being obvious: a type that");
    Console.WriteLine("   should NOT have a repository now has one, and the mistake is a");
    Console.WriteLine("   successful resolve rather than a compile error.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Keyed()
{
    Console.WriteLine("5. Two implementations, both wanted");
    Console.WriteLine();

    var services = new ServiceCollection();

    // .NET 8 and later. The key is part of the registration and part of the ask.
    services.AddKeyedSingleton<IPaymentGateway, CardGateway>("card");
    services.AddKeyedSingleton<IPaymentGateway, BankGateway>("bank");
    services.AddSingleton<Checkout>();

    using ServiceProvider provider = services.BuildServiceProvider();
    Checkout checkout = provider.GetRequiredService<Checkout>();

    Console.WriteLine($"   checkout.Card   {checkout.Card.Name}");
    Console.WriteLine($"   checkout.Bank   {checkout.Bank.Name}");
    Console.WriteLine();
    Console.WriteLine($"   unkeyed resolve of IPaymentGateway   " +
        $"{provider.GetService<IPaymentGateway>()?.Name ?? "(null - keyed registrations are separate)"}");
    Console.WriteLine();
    Console.WriteLine("   KEYED SERVICES SOLVE THE CASE THE CONTAINER OTHERWISE CANNOT: two");
    Console.WriteLine("   implementations of one interface, both needed, chosen by name rather");
    Console.WriteLine("   than by position.");
    Console.WriteLine();
    Console.WriteLine("   Before .NET 8 this was a factory delegate or two interfaces that");
    Console.WriteLine("   existed only to be different types, and you will find both in code");
    Console.WriteLine("   written earlier.");
    Console.WriteLine();
    Console.WriteLine("   NOTE THE LAST LINE. A keyed registration does NOT answer an unkeyed");
    Console.WriteLine("   request. They are separate namespaces, so adding a key to an existing");
    Console.WriteLine("   registration breaks every consumer that was not updated - and breaks");
    Console.WriteLine("   it at resolve time, not at compile time.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void WhenItCannot()
{
    Console.WriteLine("6. When it cannot build what you asked for");
    Console.WriteLine();

    // Missing registration.
    var missing = new ServiceCollection();
    missing.AddSingleton<ReceiptWriter>();

    using (ServiceProvider provider = missing.BuildServiceProvider())
    {
        Console.WriteLine("   a. a dependency that was never registered");
        Console.WriteLine($"      {Describe(() => provider.GetRequiredService<ReceiptWriter>())}");
    }

    // Circular dependency.
    var circular = new ServiceCollection();
    circular.AddSingleton<Ping>();
    circular.AddSingleton<Pong>();

    using (ServiceProvider provider = circular.BuildServiceProvider())
    {
        Console.WriteLine();
        Console.WriteLine("   b. two services that need each other");
        Console.WriteLine($"      {Describe(() => provider.GetRequiredService<Ping>())}");
    }

    // The same missing registration, caught at build time instead.
    var validated = new ServiceCollection();
    validated.AddSingleton<ReceiptWriter>();

    Console.WriteLine();
    Console.WriteLine("   c. the same missing registration, with ValidateOnBuild");
    Console.WriteLine($"      {Describe(() => validated.BuildServiceProvider(
        new ServiceProviderOptions { ValidateOnBuild = true }))}");

    Console.WriteLine();
    Console.WriteLine("   d. the same missing registration inside a real WebApplication");
    Console.WriteLine();

    foreach (string environment in new[] { "Development", "Production" })
    {
        var web = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            EnvironmentName = environment
        });

        web.WebHost.UseUrls("http://127.0.0.1:0");
        web.Logging.ClearProviders();
        web.Services.AddSingleton<ReceiptWriter>();

        string atBuild = "built without complaint";
        string atResolve = "-";
        WebApplication? built = null;

        try
        {
            built = web.Build();
        }
        catch (Exception exception)
        {
            atBuild = $"Build() threw {exception.GetType().Name}";
        }

        if (built is not null)
        {
            atResolve = Describe(() => built.Services.GetRequiredService<ReceiptWriter>());
        }

        Console.WriteLine($"      {environment,-12}  {atBuild}");
        Console.WriteLine($"      {"",-12}  first resolve: {atResolve}");
    }

    Console.WriteLine();
    Console.WriteLine("   THE MESSAGES ARE GOOD, AND THE TIMING IS THE PROBLEM. Without");
    Console.WriteLine("   validation, a missing registration is discovered when something first");
    Console.WriteLine("   asks for that service - which for a rarely-used endpoint means in");
    Console.WriteLine("   production, on the request that needed it.");
    Console.WriteLine();
    Console.WriteLine("   ValidateOnBuild WALKS EVERY REGISTRATION AT STARTUP and fails there");
    Console.WriteLine("   instead. A process that will not start is a deployment that rolls");
    Console.WriteLine("   back; a 500 on one endpoint is an incident.");
    Console.WriteLine();
    Console.WriteLine("   READ PART d AGAIN. WebApplication.CreateBuilder turns validation on");
    Console.WriteLine("   in Development and leaves it off in Production, so the check that");
    Console.WriteLine("   matters most is absent in the environment that matters most - unless");
    Console.WriteLine("   you ask for it:");
    Console.WriteLine();
    Console.WriteLine("     builder.Host.UseDefaultServiceProvider(options =>");
    Console.WriteLine("     {");
    Console.WriteLine("         options.ValidateOnBuild = true;");
    Console.WriteLine("         options.ValidateScopes = true;");
    Console.WriteLine("     });");
    Console.WriteLine();
    Console.WriteLine("   The argument against is startup cost, and it is measured in");
    Console.WriteLine("   milliseconds against a process that is about to run for weeks.");
    Console.WriteLine();
    Console.WriteLine("   A CIRCULAR DEPENDENCY IS A DESIGN MESSAGE, not a container problem.");
    Console.WriteLine("   Two classes that each need the other are one class, or they need a");
    Console.WriteLine("   third that both depend on. Breaking the cycle with a lazy resolve");
    Console.WriteLine("   hides it rather than fixing it.");
}

// ---------------------------------------------------------------------------
static string Describe(Action action)
{
    try
    {
        action();
        return "(no exception)";
    }
    catch (Exception exception)
    {
        string message = exception.Message.Split('\n')[0];

        return $"{exception.GetType().Name}: {(message.Length > 150 ? message[..150] + "..." : message)}";
    }
}

// ---------------------------------------------------------------------------
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public sealed class FixedClock : IClock
{
    public DateTime UtcNow => new(2026, 1, 1, 9, 0, 0);
}

public interface IRetryPolicy
{
    int Attempts { get; }
}

public sealed class FixedRetry : IRetryPolicy
{
    public int Attempts => 3;
}

// Three constructors, so the container has a choice to make.
public sealed class Gateway
{
    public Gateway() => Chosen = "Gateway()";

    public Gateway(IClock clock) => Chosen = "Gateway(IClock)";

    public Gateway(IClock clock, IRetryPolicy retry) => Chosen = "Gateway(IClock, IRetryPolicy)";

    public string Chosen { get; }
}

public sealed class ReceiptWriter(IClock clock)
{
    public string Write(string reference) => $"{reference} at {clock.UtcNow:O}";
}

public interface IReceiptRule
{
    string Name { get; }
}

public sealed class AmountRule : IReceiptRule
{
    public string Name => "amount";
}

public sealed class CurrencyRule : IReceiptRule
{
    public string Name => "currency";
}

public sealed class ReferenceRule : IReceiptRule
{
    public string Name => "reference";
}

// One parameter, every registration.
public sealed class ReceiptValidator(IEnumerable<IReceiptRule> rules)
{
    public int RuleCount { get; } = rules.Count();

    public string Names { get; } = string.Join(", ", rules.Select(rule => rule.Name));
}

public sealed record Payment(string Id);

public sealed record Invoice(string Id);

public interface IRepository<T>
{
    Type ItemType { get; }
}

public sealed class InMemoryRepository<T> : IRepository<T>
{
    public Type ItemType => typeof(T);
}

public interface IPaymentGateway
{
    string Name { get; }
}

public sealed class CardGateway : IPaymentGateway
{
    public string Name => "CardGateway";
}

public sealed class BankGateway : IPaymentGateway
{
    public string Name => "BankGateway";
}

public sealed class Checkout(
    [FromKeyedServices("card")] IPaymentGateway card,
    [FromKeyedServices("bank")] IPaymentGateway bank)
{
    public IPaymentGateway Card { get; } = card;

    public IPaymentGateway Bank { get; } = bank;
}

public sealed class Ping(Pong pong)
{
    public Pong Pong { get; } = pong;
}

public sealed class Pong(Ping ping)
{
    public Ping Ping { get; } = ping;
}
