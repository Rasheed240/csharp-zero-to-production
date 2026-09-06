// 02-filters-and-testability.cs — The two claims made loudest about each style,
// measured: filters, and whether a handler can be tested without a host.
//
// Run:  dotnet run 02-filters-and-testability.cs -c Release
//
// EXACT vs RATIO: every ordering and result here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

var order = new ConcurrentQueue<string>();
Ordering.Log = order;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();
builder.Services.AddControllers();

// [ServiceFilter<T>] resolves the filter from the container, so both filters
// and anything the controller needs must be registered.
builder.Services.AddSingleton<TraceFilter>();
builder.Services.AddSingleton<GuardFilter>();
builder.Services.AddSingleton<IPaymentStore, FakeStore>();

var app = builder.Build();

var group = app.MapGroup("/minimal")
    .AddEndpointFilter(async (context, next) =>
    {
        order.Enqueue("minimal: group filter IN");

        // Short-circuiting: RETURN a result instead of calling next. There is
        // no other way to produce a value, so the mistake the controller form
        // allows - set a result and call next anyway - cannot be written here.
        if (context.GetArgument<string>(0) == "BAD")
        {
            order.Enqueue("minimal: group filter REJECTED");
            return Results.BadRequest(new { error = "id rejected by filter" });
        }

        object? result = await next(context);
        order.Enqueue("minimal: group filter OUT");
        return result;
    });

group.MapGet("/work/{id}", (string id) =>
    {
        order.Enqueue("minimal: the handler");
        return Results.Ok(new { id, style = "minimal" });
    })
    .AddEndpointFilter(async (context, next) =>
    {
        // A filter can see the BOUND ARGUMENTS, by position.
        string? boundId = context.GetArgument<string>(0);
        order.Enqueue($"minimal: endpoint filter IN (id={boundId})");

        object? result = await next(context);

        order.Enqueue($"minimal: endpoint filter OUT (result is {result?.GetType().Name})");
        return result;
    });

app.MapControllers();

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

await FilterOrdering(http, order);
await ShortCircuiting(http);
Testability();
await TestingWithoutAHost();

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task FilterOrdering(HttpClient http, ConcurrentQueue<string> order)
{
    Console.WriteLine("1. Filters, both styles");
    Console.WriteLine();

    order.Clear();
    await http.GetStringAsync("/minimal/work/PAY-1");
    var minimal = order.ToArray();

    order.Clear();
    await http.GetStringAsync("/mvc/work/PAY-1");
    var mvc = order.ToArray();

    Console.WriteLine("   MINIMAL API");
    foreach (string step in minimal)
    {
        Console.WriteLine($"     {step}");
    }

    Console.WriteLine();
    Console.WriteLine("   CONTROLLER");
    foreach (string step in mvc)
    {
        Console.WriteLine($"     {step}");
    }

    Console.WriteLine();
    Console.WriteLine("   Both nest the same way - outermost registered runs first in, last");
    Console.WriteLine("   out - and the two mechanisms are otherwise different in three ways.");
    Console.WriteLine();
    Console.WriteLine("   THE INTERFACE:");
    Console.WriteLine();
    Console.WriteLine("     minimal    IEndpointFilter, one method:");
    Console.WriteLine("                ValueTask<object?> InvokeAsync(");
    Console.WriteLine("                    EndpointFilterInvocationContext context,");
    Console.WriteLine("                    EndpointFilterDelegate next)");
    Console.WriteLine();
    Console.WriteLine("     controller IActionFilter (sync), IAsyncActionFilter, plus separate");
    Console.WriteLine("                interfaces for resource, result, exception and");
    Console.WriteLine("                authorisation stages - five filter TYPES, each with its");
    Console.WriteLine("                own position in a fixed pipeline.");
    Console.WriteLine();
    Console.WriteLine("   THE MENTAL MODEL. A minimal filter is one wrapper and you compose");
    Console.WriteLine("   them; MVC's filters are five named stages you slot into. The MVC");
    Console.WriteLine("   model is more powerful - an exception filter genuinely cannot be");
    Console.WriteLine("   expressed as a plain wrapper - and it is more to hold in your head.");
    Console.WriteLine();
    Console.WriteLine("   WHAT THEY SEE. Both see the bound arguments. The minimal one gets");
    Console.WriteLine("   them BY POSITION - context.GetArgument<string>(0) - which is not");
    Console.WriteLine("   checked at compile time and breaks silently when somebody reorders");
    Console.WriteLine("   the handler's parameters. MVC's ActionArguments is a dictionary");
    Console.WriteLine("   keyed by NAME, which breaks silently when somebody renames one.");
    Console.WriteLine();
    Console.WriteLine("   Neither is safe. Both are string-or-integer indexed access into");
    Console.WriteLine("   somebody else's signature.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task ShortCircuiting(HttpClient http)
{
    Console.WriteLine("2. A filter that rejects the request");
    Console.WriteLine();

    Console.WriteLine("   request                          status   body");
    Console.WriteLine("   -------                          ------   ----");

    foreach (string path in new[]
    {
        "/minimal/work/PAY-1", "/minimal/work/BAD",
        "/mvc/work/PAY-1", "/mvc/work/BAD"
    })
    {
        using HttpResponseMessage response = await http.GetAsync(path);
        string body = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"   {path,-30}   {(int)response.StatusCode,6}   " +
            $"{(body.Length == 0 ? "(empty)" : body)}");
    }

    Console.WriteLine();
    Console.WriteLine("   Both styles can refuse before the handler runs, and both do it by");
    Console.WriteLine("   returning a result instead of calling next.");
    Console.WriteLine();
    Console.WriteLine("     minimal      return Results.BadRequest(...);");
    Console.WriteLine("     controller   context.Result = new BadRequestObjectResult(...);");
    Console.WriteLine();
    Console.WriteLine("   The controller form is the one to watch: setting Result and then");
    Console.WriteLine("   ALSO calling next() runs the action anyway and discards your result.");
    Console.WriteLine("   The minimal form cannot express that mistake, because returning is");
    Console.WriteLine("   the only way to produce a value.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Testability()
{
    Console.WriteLine("3. Testability: the claim, and what is actually true");
    Console.WriteLine();
    Console.WriteLine("   The claim usually made is that controllers are testable and minimal");
    Console.WriteLine("   APIs are not. That is true of ONE way of writing minimal APIs and");
    Console.WriteLine("   false of the others.");
    Console.WriteLine();
    Console.WriteLine("   A LAMBDA IS NOT REACHABLE FROM A TEST:");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/payments/{id}\", (string id, IPaymentStore store) =>");
    Console.WriteLine("         store.Find(id) is { } p ? Results.Ok(p) : Results.NotFound());");
    Console.WriteLine();
    Console.WriteLine("   There is no name to call. The only way to exercise it is to start a");
    Console.WriteLine("   host and send a request.");
    Console.WriteLine();
    Console.WriteLine("   A NAMED METHOD IS AN ORDINARY METHOD:");
    Console.WriteLine();
    Console.WriteLine("     app.MapGet(\"/payments/{id}\", PaymentEndpoints.Get);");
    Console.WriteLine();
    Console.WriteLine("     public static IResult Get(string id, IPaymentStore store) =>");
    Console.WriteLine("         store.Find(id) is { } p ? Results.Ok(p) : Results.NotFound();");
    Console.WriteLine();
    Console.WriteLine("   That is a public static method taking two arguments. A test calls it");
    Console.WriteLine("   with a fake store and asserts on the returned IResult - no host, no");
    Console.WriteLine("   HTTP, no serialisation. Section 4 does exactly that.");
    Console.WriteLine();
    Console.WriteLine("   A CONTROLLER ACTION is also an ordinary method, on a class you can");
    Console.WriteLine("   construct with fakes. The difference is that ControllerBase brings");
    Console.WriteLine("   HttpContext, ModelState, User and the Url helper with it, and an");
    Console.WriteLine("   action touching any of them needs those populated in the test.");
    Console.WriteLine();
    Console.WriteLine("   SO THE HONEST COMPARISON IS:");
    Console.WriteLine();
    Console.WriteLine("     minimal lambda    not unit-testable at all");
    Console.WriteLine("     minimal method    testable, with nothing to arrange");
    Console.WriteLine("     controller action testable, with a base class to arrange if the");
    Console.WriteLine("                       action uses any of what it inherits");
    Console.WriteLine();
    Console.WriteLine("   Extracting the method is one line and it removes the only real");
    Console.WriteLine("   testability difference. The fact that most minimal-API code in the");
    Console.WriteLine("   wild does not do it is a fact about habits rather than about the");
    Console.WriteLine("   style.");
    Console.WriteLine();
    Console.WriteLine("   And the caveat that applies to both: a unit test of a handler does");
    Console.WriteLine("   not test routing, model binding, filters, validation or");
    Console.WriteLine("   serialisation. Everything this module has measured so far lives");
    Console.WriteLine("   OUTSIDE the handler, so the tests that catch those bugs are");
    Console.WriteLine("   integration tests either way.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static async Task TestingWithoutAHost()
{
    Console.WriteLine("4. Calling both handlers directly, with no host");
    Console.WriteLine();

    var store = new FakeStore();
    store.Add(new Payment("PAY-1", 123450));

    // The minimal handler: a static method, called like any other.
    IResult found = PaymentEndpoints.Get("PAY-1", store);
    IResult missing = PaymentEndpoints.Get("PAY-9", store);

    // The controller action: construct the controller with the same fake.
    var controller = new WorkController(store);
    IActionResult mvcFound = controller.Find("PAY-1");
    IActionResult mvcMissing = controller.Find("PAY-9");

    Console.WriteLine("   call                                          returned");
    Console.WriteLine("   ----                                          --------");
    Console.WriteLine($"   PaymentEndpoints.Get(\"PAY-1\", store)          {found.GetType().Name}");
    Console.WriteLine($"   PaymentEndpoints.Get(\"PAY-9\", store)          {missing.GetType().Name}");
    Console.WriteLine($"   new WorkController(store).Find(\"PAY-1\")       {mvcFound.GetType().Name}");
    Console.WriteLine($"   new WorkController(store).Find(\"PAY-9\")       {mvcMissing.GetType().Name}");
    Console.WriteLine();
    Console.WriteLine("   No web server was started for any of those four lines. Both are");
    Console.WriteLine("   ordinary method calls returning ordinary objects.");
    Console.WriteLine();
    Console.WriteLine("   Note what you assert on, because it differs:");
    Console.WriteLine();
    Console.WriteLine("     minimal      the IResult type, and its properties. Ok<T> exposes");
    Console.WriteLine("                  Value, so a typed result gives you the payload");
    Console.WriteLine("                  without serialising. Use Results<Ok<T>, NotFound> as");
    Console.WriteLine("                  the return type and the compiler checks the set.");
    Console.WriteLine();
    Console.WriteLine("     controller   the IActionResult type, and cast to read Value.");
    Console.WriteLine();
    Console.WriteLine("   The typed-results option is worth knowing:");
    Console.WriteLine();
    Console.WriteLine("     public static Results<Ok<Payment>, NotFound> Get(");
    Console.WriteLine("         string id, IPaymentStore store) =>");
    Console.WriteLine("         store.Find(id) is { } p");
    Console.WriteLine("             ? TypedResults.Ok(p)");
    Console.WriteLine("             : TypedResults.NotFound();");
    Console.WriteLine();
    Console.WriteLine("   It documents the endpoint's responses in the signature, feeds OpenAPI");
    Console.WriteLine("   without attributes, and makes a test assert on a type the compiler");
    Console.WriteLine("   already checked. Controllers have no equivalent - IActionResult says");
    Console.WriteLine("   nothing, and [ProducesResponseType] is a separate claim nobody");
    Console.WriteLine("   verifies against the code.");
    Console.WriteLine();

    await Task.CompletedTask;
}

// ---------------------------------------------------------------------------
static class Ordering
{
    public static ConcurrentQueue<string> Log { get; set; } = new();
}

public record Payment(string Id, long AmountMinor);

public interface IPaymentStore
{
    Payment? Find(string id);
}

public sealed class FakeStore : IPaymentStore
{
    private readonly Dictionary<string, Payment> _payments = new();

    public void Add(Payment payment) => _payments[payment.Id] = payment;

    public Payment? Find(string id) => _payments.GetValueOrDefault(id);
}

// The extracted minimal handler: an ordinary static method.
public static class PaymentEndpoints
{
    public static IResult Get(string id, IPaymentStore store) =>
        store.Find(id) is { } payment ? Results.Ok(payment) : Results.NotFound();
}

// ---------------------------------------------------------------------------
public sealed class TraceFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context,
        ActionExecutionDelegate next)
    {
        context.ActionArguments.TryGetValue("id", out object? id);
        Ordering.Log.Enqueue($"mvc: action filter IN (id={id})");

        ActionExecutedContext executed = await next();

        Ordering.Log.Enqueue($"mvc: action filter OUT (result is {executed.Result?.GetType().Name})");
    }
}

public sealed class GuardFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context,
        ActionExecutionDelegate next)
    {
        Ordering.Log.Enqueue("mvc: guard filter IN");

        if (context.ActionArguments.TryGetValue("id", out object? guarded) && guarded is "BAD")
        {
            // Setting Result and NOT calling next is how a controller filter
            // short-circuits.
            context.Result = new BadRequestObjectResult(new { error = "id rejected by filter" });
            return;
        }

        await next();
        Ordering.Log.Enqueue("mvc: guard filter OUT");
    }
}

[ApiController]
[Route("mvc")]
[ServiceFilter<GuardFilter>]
public sealed class WorkController : ControllerBase
{
    private readonly IPaymentStore _store;

    public WorkController(IPaymentStore store) => _store = store;

    [HttpGet("work/{id}")]
    [ServiceFilter<TraceFilter>]
    public IActionResult Work(string id)
    {
        Ordering.Log.Enqueue("mvc: the action");
        return Ok(new { id, style = "controller" });
    }

    // Not routed - present so section 4 can call it directly.
    [NonAction]
    public IActionResult Find(string id) =>
        _store.Find(id) is { } payment ? Ok(payment) : NotFound();
}
