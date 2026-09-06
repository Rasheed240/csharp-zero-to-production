// 02-composition-root.cs — Where the wiring goes, and what happens to a
// codebase when it goes everywhere else instead.
//
// Run:  dotnet run 02-composition-root.cs -c Release
//
// EXACT vs RATIO: every exception name and count here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using Microsoft.Extensions.DependencyInjection;

// Same reason as 01: this file builds providers directly to compare them.
#pragma warning disable ASP0000

WhereWiringGoes();
ServiceLocation();
NoContainerNeeded();
TheRule();

// ---------------------------------------------------------------------------
static void WhereWiringGoes()
{
    Console.WriteLine("1. The composition root");
    Console.WriteLine();
    Console.WriteLine("   A settlement run touches five classes. Each needs the one below it.");
    Console.WriteLine();
    Console.WriteLine("     SettlementRun -> IPaymentGateway -> IHttpAdapter -> IClock");
    Console.WriteLine("                   -> ILedger         -> IClock");
    Console.WriteLine();
    Console.WriteLine("   Built by hand, at the one place that runs it:");
    Console.WriteLine();

    IClock clock = new SystemClock();
    var run = new SettlementRun(
        new CardGateway(new HttpAdapter(clock)),
        new Ledger(clock));

    Console.WriteLine($"     {run.Settle("PAY-1", 50_000)}");
    Console.WriteLine();
    Console.WriteLine("   Built by the container, from the same information:");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddSingleton<IClock, SystemClock>();
    services.AddSingleton<IHttpAdapter, HttpAdapter>();
    services.AddSingleton<IPaymentGateway, CardGateway>();
    services.AddSingleton<ILedger, Ledger>();
    services.AddSingleton<SettlementRun>();

    using ServiceProvider provider = services.BuildServiceProvider();

    Console.WriteLine($"     {provider.GetRequiredService<SettlementRun>().Settle("PAY-1", 50_000)}");
    Console.WriteLine();
    Console.WriteLine("   THE CONTAINER IS NOT THE POINT. Both versions do the same thing, and");
    Console.WriteLine("   the hand-built one is arguably clearer at this size. What matters is");
    Console.WriteLine("   that in both, the decisions live in ONE PLACE.");
    Console.WriteLine();
    Console.WriteLine("   That place has a name: the COMPOSITION ROOT. It is the only part of");
    Console.WriteLine("   the program that knows which concrete types exist. Everything else");
    Console.WriteLine("   names interfaces and is handed instances.");
    Console.WriteLine();
    Console.WriteLine("   The container earns its place when the graph gets deep, because it");
    Console.WriteLine("   removes the part of hand-wiring that actually hurts: constructing the");
    Console.WriteLine("   same object four times, and re-editing every call site when a class");
    Console.WriteLine("   gains a dependency.");
    Console.WriteLine();
    Console.WriteLine("   IN AN ASP.NET CORE APPLICATION THE COMPOSITION ROOT IS Program.cs -");
    Console.WriteLine("   specifically, everything between CreateBuilder and Build. A registration");
    Console.WriteLine("   anywhere else is a second root, and two roots is no root.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void ServiceLocation()
{
    Console.WriteLine("2. The version that asks the container itself");
    Console.WriteLine();
    Console.WriteLine("   Same class, one difference: instead of declaring what it needs, it");
    Console.WriteLine("   takes the container and looks things up.");
    Console.WriteLine();

    var services = new ServiceCollection();
    services.AddSingleton<IClock, SystemClock>();
    services.AddSingleton<ILedger, Ledger>();

    // IPaymentGateway is NOT registered - somebody deleted the line, or it
    // lives in a registration method this application forgot to call. Both
    // reports below need it.
    services.AddSingleton<InjectedReport>();
    services.AddSingleton<LocatingReport>();

    using ServiceProvider provider = services.BuildServiceProvider();

    Console.WriteLine("   what happens when a dependency is missing:");
    Console.WriteLine();
    Console.WriteLine($"     constructor injection   {Describe(() => provider.GetRequiredService<InjectedReport>())}");
    Console.WriteLine($"     service location        {Describe(() => provider.GetRequiredService<LocatingReport>())}");
    Console.WriteLine();

    var located = provider.GetRequiredService<LocatingReport>();
    Console.WriteLine($"     ... and when it is used  {DescribeUse(() => located.Run())}");

    Console.WriteLine();
    Console.WriteLine("   THE FAILURE MOVED. Constructor injection failed the moment anything");
    Console.WriteLine("   tried to build the object. Service location built happily and failed");
    Console.WriteLine("   later, on the code path that needed the missing service.");
    Console.WriteLine();
    Console.WriteLine("   That difference is the entire argument, and it has three parts:");
    Console.WriteLine();
    Console.WriteLine("     1. THE DEPENDENCIES ARE INVISIBLE. LocatingReport's constructor says");
    Console.WriteLine("        it needs a container, which is true of every class and therefore");
    Console.WriteLine("        tells you nothing. Reading the signature no longer tells you what");
    Console.WriteLine("        the class talks to; you have to read every method.");
    Console.WriteLine();
    Console.WriteLine("     2. VALIDATION CANNOT SEE THEM EITHER. ValidateOnBuild walks");
    Console.WriteLine("        constructors, so a service located at runtime is invisible to it.");
    Console.WriteLine("        The startup check you turned on covers less than you think.");
    Console.WriteLine();
    Console.WriteLine("     3. TESTING GETS WORSE. To test the injected version you pass fakes.");
    Console.WriteLine("        To test the locating version you build a container, which means");
    Console.WriteLine("        every test knows the registration rules of the application.");
    Console.WriteLine();
    Console.WriteLine("   THE NAME FOR THIS IS SERVICE LOCATION, and it is usually called an");
    Console.WriteLine("   anti-pattern without the reason attached. The reason is that it");
    Console.WriteLine("   converts a compile-time-adjacent, startup-time failure into a runtime");
    Console.WriteLine("   one, and hides the information a reader needs.");
    Console.WriteLine();
    Console.WriteLine("   WHERE IT IS LEGITIMATE, because there are places:");
    Console.WriteLine();
    Console.WriteLine("     - the composition root itself, which is allowed to know about the");
    Console.WriteLine("       container because it IS the container's configuration;");
    Console.WriteLine("     - resolving a service whose type is only known at runtime, from a");
    Console.WriteLine("       message type or a route value, behind a factory that is itself");
    Console.WriteLine("       injected;");
    Console.WriteLine("     - creating a scope for work that outlives a request, which is the");
    Console.WriteLine("       subject of the next module.");
    Console.WriteLine();
    Console.WriteLine("   The test: IS THE CONTAINER AN IMPLEMENTATION DETAIL OF THIS CLASS, OR");
    Console.WriteLine("   ITS SUBJECT? A factory whose job is to build things by name may hold");
    Console.WriteLine("   one. A report that needs a gateway may not.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void NoContainerNeeded()
{
    Console.WriteLine("3. The test that needs no container at all");
    Console.WriteLine();

    // No ServiceCollection, no provider, no framework.
    var report = new InjectedReport(
        new FixedClock(new DateTime(2026, 1, 1)),
        new RecordingGateway());

    string first = report.Run();
    string second = report.Run();

    Console.WriteLine($"   first call    {first}");
    Console.WriteLine($"   second call   {second}");
    Console.WriteLine($"   identical     {first == second}");
    Console.WriteLine();
    Console.WriteLine("   THIS IS THE PAYOFF, and it is worth being precise about what produced");
    Console.WriteLine("   it. Not the container - there is no container in those three lines.");
    Console.WriteLine("   What produced it is that the class states its dependencies as");
    Console.WriteLine("   parameters, so a caller can supply different ones.");
    Console.WriteLine();
    Console.WriteLine("   INVERSION OF CONTROL IS THE DESIGN. A CONTAINER IS ONE WAY TO DO THE");
    Console.WriteLine("   WIRING. Codebases conflate them constantly, and the conflation is why");
    Console.WriteLine("   people end up registering things in the container in order to test");
    Console.WriteLine("   them, which is the opposite of the benefit.");
    Console.WriteLine();
    Console.WriteLine("   A useful check on any class you have just written: COULD I CONSTRUCT");
    Console.WriteLine("   THIS IN A TEST WITH new AND NOTHING ELSE? If not, the dependency you");
    Console.WriteLine("   cannot supply is one it took without saying so.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void TheRule()
{
    Console.WriteLine("4. What to inject, and what not to");
    Console.WriteLine();
    Console.WriteLine("   inject                                     do not inject");
    Console.WriteLine("   ------                                     -------------");
    Console.WriteLine("   things that talk to the outside world      values and configuration");
    Console.WriteLine("     a gateway, a repository, a clock,          a connection string, a");
    Console.WriteLine("     a message publisher, a file system         timeout, a feature flag");
    Console.WriteLine();
    Console.WriteLine("   things with more than one implementation    pure functions");
    Console.WriteLine("     a pricing strategy, a rule set             a formatter, a parser");
    Console.WriteLine();
    Console.WriteLine("   things you need to fake in a test           data");
    Console.WriteLine("                                                a request, an invoice");
    Console.WriteLine();
    Console.WriteLine("   THE VALUES ROW SURPRISES PEOPLE. A timeout is not a dependency, it is");
    Console.WriteLine("   a setting - it belongs in an options type read from configuration,");
    Console.WriteLine("   not as its own registration. Registering a string in a container");
    Console.WriteLine("   means any class asking for a string gets that one.");
    Console.WriteLine();
    Console.WriteLine("   THE PURE FUNCTION ROW IS THE COMMONER MISTAKE. An interface with one");
    Console.WriteLine("   implementation, no state and no I/O adds a registration, an");
    Console.WriteLine("   indirection and a file, and buys a substitution nobody will make. A");
    Console.WriteLine("   static method is a better answer, and it can become an interface the");
    Console.WriteLine("   day a second implementation exists.");
    Console.WriteLine();
    Console.WriteLine("   The question is not 'could this be injected'. Everything could. It is");
    Console.WriteLine("   WOULD I EVER WANT TO SUBSTITUTE THIS, IN PRODUCTION OR IN A TEST?");
}

// ---------------------------------------------------------------------------
static string Describe(Func<object> action)
{
    try
    {
        object result = action();
        return $"built: {result.GetType().Name}";
    }
    catch (Exception exception)
    {
        string message = exception.Message.Split('\n')[0];

        return $"{exception.GetType().Name}: {(message.Length > 88 ? message[..88] + "..." : message)}";
    }
}

static string DescribeUse(Action action)
{
    try
    {
        action();
        return "(no exception)";
    }
    catch (Exception exception)
    {
        string message = exception.Message.Split('\n')[0];

        return $"{exception.GetType().Name}: {(message.Length > 88 ? message[..88] + "..." : message)}";
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

public sealed class FixedClock(DateTime fixedTime) : IClock
{
    public DateTime UtcNow => fixedTime;
}

public interface IHttpAdapter
{
    string Post(string path, long amountMinor);
}

public sealed class HttpAdapter(IClock clock) : IHttpAdapter
{
    public string Post(string path, long amountMinor) =>
        $"POST {path} {amountMinor} at {clock.UtcNow:yyyy-MM-dd}";
}

public interface IPaymentGateway
{
    string Capture(string paymentId, long amountMinor);
}

public sealed class CardGateway(IHttpAdapter http) : IPaymentGateway
{
    public string Capture(string paymentId, long amountMinor) =>
        http.Post($"/capture/{paymentId}", amountMinor);
}

public interface ILedger
{
    string Record(string paymentId, long amountMinor);
}

public sealed class Ledger(IClock clock) : ILedger
{
    public string Record(string paymentId, long amountMinor) =>
        $"recorded {paymentId} {amountMinor} on {clock.UtcNow:yyyy-MM-dd}";
}

// A ledger that records nothing and says the same thing every time, so a test
// can assert on the output.
public sealed class RecordingLedger : ILedger
{
    public string Record(string paymentId, long amountMinor) => $"recorded {paymentId}";
}

// The same idea for the gateway: no network, one predictable answer.
public sealed class RecordingGateway : IPaymentGateway
{
    public string Capture(string paymentId, long amountMinor) => $"captured {paymentId}";
}

public sealed class SettlementRun(IPaymentGateway gateway, ILedger ledger)
{
    public string Settle(string paymentId, long amountMinor)
    {
        string captured = gateway.Capture(paymentId, amountMinor);

        return $"{captured} | {ledger.Record(paymentId, amountMinor)}";
    }
}

// States what it needs. Cannot be constructed without it.
public sealed class InjectedReport(IClock clock, IPaymentGateway gateway)
{
    public string Run() =>
        $"{gateway.Capture("PAY-1", 50_000)} at {clock.UtcNow:yyyy-MM-dd}";
}

// Takes the container. Its constructor tells you nothing about what it uses,
// and it builds successfully whether or not those services exist.
public sealed class LocatingReport(IServiceProvider services)
{
    public string Run()
    {
        var gateway = services.GetRequiredService<IPaymentGateway>();

        return gateway.Capture("PAY-1", 50_000);
    }
}
