// 04-exercises.cs — Every answer claimed in the module, measured here.
//
// Run:  dotnet run 04-exercises.cs -c Release

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

await Exercise1();
await Exercise2();
Exercise3();
await Exercise4();
Exercise5();

// ---------------------------------------------------------------------------
// 1. EASY — the same invalid body, both styles.
// ---------------------------------------------------------------------------
static async Task Exercise1()
{
    Console.WriteLine("Exercise 1: the same request type, the same invalid body, both styles.");
    Console.WriteLine("            What does each return?");
    Console.WriteLine();
    Console.WriteLine("     [Range(1, 1_000_000)] public long AmountMinor { get; set; }");
    Console.WriteLine("     [Required, StringLength(3, MinimumLength = 3)]");
    Console.WriteLine("     public string Currency { get; set; } = \"\";");
    Console.WriteLine();
    Console.WriteLine("     POST {\"amountMinor\": -5, \"currency\": \"POUNDS\"}");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    builder.Services.AddControllers();

    var app = builder.Build();
    app.MapPost("/minimal", (CreatePayment body) => Results.Ok(new { got = body.AmountMinor }));
    app.MapControllers();

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

    foreach (string path in new[] { "/minimal", "/mvc" })
    {
        using var content = new StringContent("""{"amountMinor": -5, "currency": "POUNDS"}""",
            Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.PostAsync(path, content);
        string body = await response.Content.ReadAsStringAsync();
        Console.WriteLine($"   {path,-10} {(int)response.StatusCode}  " +
            $"{(body.Length > 90 ? body[..90] + "..." : body)}");
    }

    await app.StopAsync();

    Console.WriteLine();
    Console.WriteLine("   THE MINIMAL ENDPOINT ACCEPTS IT. The attributes are on the type, the");
    Console.WriteLine("   values violate them, and nothing reads them.");
    Console.WriteLine();
    Console.WriteLine("   The controller rejects it with 400 and a ValidationProblemDetails");
    Console.WriteLine("   body - and no line of the controller does that. [ApiController]");
    Console.WriteLine("   does, along with four other behaviours: binding source inference,");
    Console.WriteLine("   ProblemDetails for error codes, required attribute routing, and");
    Console.WriteLine("   multipart inference for IFormFile.");
    Console.WriteLine();
    Console.WriteLine("   This is a difference in DEFAULTS, not in what is possible. .NET 10");
    Console.WriteLine("   ships builder.Services.AddValidation() for minimal APIs - but you");
    Console.WriteLine("   have to ask, and a team arriving from controllers does not know to.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 2. EASY — filter ordering.
// ---------------------------------------------------------------------------
static async Task Exercise2()
{
    Console.WriteLine("Exercise 2: a group filter and an endpoint filter. In what order do");
    Console.WriteLine("            they run, and what can each see?");
    Console.WriteLine();

    var log = new List<string>();

    var builder = WebApplication.CreateBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Logging.ClearProviders();
    var app = builder.Build();

    var group = app.MapGroup("/work").AddEndpointFilter(async (context, next) =>
    {
        log.Add("group IN");
        object? result = await next(context);
        log.Add("group OUT");
        return result;
    });

    group.MapGet("/{id}", (string id) => { log.Add("handler"); return Results.Ok(id); })
        .AddEndpointFilter(async (context, next) =>
        {
            log.Add($"endpoint IN (arg 0 = {context.GetArgument<string>(0)})");
            object? result = await next(context);
            log.Add($"endpoint OUT (result = {result?.GetType().Name})");
            return result;
        });

    await app.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
    await http.GetStringAsync("/work/PAY-1");
    await app.StopAsync();

    foreach (string step in log)
    {
        Console.WriteLine($"     {step}");
    }

    Console.WriteLine();
    Console.WriteLine("   The group filter is OUTSIDE the endpoint filter - they nest exactly");
    Console.WriteLine("   like middleware, outermost registered first in and last out.");
    Console.WriteLine();
    Console.WriteLine("   Each sees the BOUND ARGUMENTS and the RESULT. That is the difference");
    Console.WriteLine("   from middleware, which sees neither: middleware runs before binding");
    Console.WriteLine("   and receives an HttpContext, while a filter runs after binding and");
    Console.WriteLine("   receives the values themselves.");
    Console.WriteLine();
    Console.WriteLine("   The access is BY POSITION - GetArgument<string>(0) - which is not");
    Console.WriteLine("   checked at compile time and breaks silently when somebody reorders");
    Console.WriteLine("   the handler's parameters. MVC's equivalent is keyed by NAME and");
    Console.WriteLine("   breaks silently on a rename. Neither is safe.");
    Console.WriteLine();
    Console.WriteLine("   To short-circuit, RETURN a result instead of calling next. In a");
    Console.WriteLine("   controller filter you set context.Result instead - and setting it");
    Console.WriteLine("   and then calling next() anyway runs the action and discards your");
    Console.WriteLine("   result, which is a mistake the minimal form cannot express.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 3. MEDIUM — the testability claim.
// ---------------------------------------------------------------------------
static void Exercise3()
{
    Console.WriteLine("Exercise 3: 'controllers are testable and minimal APIs are not.'");
    Console.WriteLine("            Is that true?");
    Console.WriteLine();

    var store = new FakeStore();
    store.Add(new Payment("PAY-1", 123450));

    Results<Ok<Payment>, NotFound> found = PaymentEndpoints.Get("PAY-1", store);
    Results<Ok<Payment>, NotFound> missing = PaymentEndpoints.Get("PAY-9", store);

    var controller = new PaymentsController();
    IActionResult mvcFound = controller.Find("PAY-1", store);

    Console.WriteLine("   called directly, with no host running:");
    Console.WriteLine();
    Console.WriteLine($"     PaymentEndpoints.Get(\"PAY-1\", store)   {found.Result.GetType().Name}");
    Console.WriteLine($"     PaymentEndpoints.Get(\"PAY-9\", store)   {missing.Result.GetType().Name}");
    Console.WriteLine($"     controller.Find(\"PAY-1\", store)        {mvcFound.GetType().Name}");
    Console.WriteLine();

    if (found.Result is Ok<Payment> ok)
    {
        Console.WriteLine($"     and the payload, without serialising: {ok.Value}");
        Console.WriteLine();
    }

    Console.WriteLine("   IT IS TRUE OF ONE WAY OF WRITING MINIMAL APIS AND FALSE OF THE");
    Console.WriteLine("   OTHERS.");
    Console.WriteLine();
    Console.WriteLine("     a lambda            not reachable from a test - there is no name");
    Console.WriteLine("                         to call, so the only option is to start a host");
    Console.WriteLine("     a named method      an ordinary static method. Call it with fakes");
    Console.WriteLine("     a controller action an ordinary method on a class you construct -");
    Console.WriteLine("                         but ControllerBase brings HttpContext,");
    Console.WriteLine("                         ModelState, User and Url with it, and an");
    Console.WriteLine("                         action touching any of them needs them");
    Console.WriteLine("                         arranged");
    Console.WriteLine();
    Console.WriteLine("   Extracting the method is one line and removes the only real");
    Console.WriteLine("   difference. That most minimal-API code does not do it is a fact");
    Console.WriteLine("   about habits, not about the style.");
    Console.WriteLine();
    Console.WriteLine("   NOTE THE RETURN TYPE. Results<Ok<Payment>, NotFound> states the two");
    Console.WriteLine("   possible responses in the signature, so the compiler checks the set,");
    Console.WriteLine("   OpenAPI gets them without attributes, and a test asserts on a type.");
    Console.WriteLine("   Controllers have no equivalent - IActionResult says nothing, and");
    Console.WriteLine("   [ProducesResponseType] is a separate claim nobody verifies against");
    Console.WriteLine("   the code.");
    Console.WriteLine();
    Console.WriteLine("   AND THE CAVEAT THAT APPLIES TO BOTH: a unit test of a handler tests");
    Console.WriteLine("   no routing, no binding, no filters, no validation and no");
    Console.WriteLine("   serialisation. Every bug in this module lives outside the handler,");
    Console.WriteLine("   so the tests that catch them are integration tests either way.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
// 4. MEDIUM — the port that lost validation.
// ---------------------------------------------------------------------------
static async Task Exercise4()
{
    Console.WriteLine("Exercise 4: an endpoint is ported from a controller to a minimal API.");
    Console.WriteLine("            The request type and its attributes are untouched. What");
    Console.WriteLine("            breaks, and what would have caught it?");
    Console.WriteLine();

    (string Label, string Json)[] requests =
    [
        ("valid", """{"amountMinor": 123450, "currency": "GBP"}"""),
        ("negative amount", """{"amountMinor": -5, "currency": "GBP"}"""),
        ("amount of zero", """{"amountMinor": 0, "currency": "GBP"}"""),
        ("invented currency", """{"amountMinor": 100, "currency": "POUNDS"}"""),
        ("missing currency", """{"amountMinor": 100}""")
    ];

    Console.WriteLine("   version                          accepted   rejected");
    Console.WriteLine("   -------                          --------   --------");
    Console.WriteLine($"   controller                       {await CountAsync(requests, useFilter: false, controller: true)}");
    Console.WriteLine($"   ported, as written               {await CountAsync(requests, useFilter: false, controller: false)}");
    Console.WriteLine($"   ported, validated in a filter    {await CountAsync(requests, useFilter: true, controller: false)}");
    Console.WriteLine();
    Console.WriteLine("   Of the five, ONE is valid. THE PORTED VERSION ACCEPTS ALL FIVE.");
    Console.WriteLine();
    Console.WriteLine("   The port was not wrong - every line is a correct translation. What");
    Console.WriteLine("   was lost is not in either file: it is a behaviour [ApiController]");
    Console.WriteLine("   contributed, with no representation in the code being ported.");
    Console.WriteLine();
    Console.WriteLine("   A DEFAULT WAS REMOVED BY A CHANGE THAT DID NOT MENTION IT. The diff");
    Console.WriteLine("   cannot show it, and a review of the diff cannot catch it. That");
    Console.WriteLine("   generalises: any migration loses whatever the old framework did by");
    Console.WriteLine("   default and the new one does not.");
    Console.WriteLine();
    Console.WriteLine("   WHAT WOULD HAVE CAUGHT IT, in increasing order of value:");
    Console.WriteLine();
    Console.WriteLine("   1. A TEST THAT POSTS AN INVALID BODY and asserts 400. Three lines,");
    Console.WriteLine("      fails on the port, and the only item here that would have caught");
    Console.WriteLine("      it on the day.");
    Console.WriteLine();
    Console.WriteLine("   2. VALIDATION APPLIED TO A GROUP rather than per endpoint, so that");
    Console.WriteLine("      'does this endpoint validate?' has one answer for the whole group.");
    Console.WriteLine("      In .NET 10 that is AddValidation() plus WithValidation().");
    Console.WriteLine();
    Console.WriteLine("   3. A DATABASE CONSTRAINT - amount_minor > 0, a currency foreign key.");
    Console.WriteLine("      It would have rejected all four regardless of framework.");
    Console.WriteLine();
    Console.WriteLine("   The third is the one people skip because the first two feel like");
    Console.WriteLine("   enough. Both of the first two are things a change can silently");
    Console.WriteLine("   remove; a CHECK constraint is not.");
    Console.WriteLine();

    static async Task<string> CountAsync((string Label, string Json)[] requests,
        bool useFilter, bool controller)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddControllers();

        var app = builder.Build();

        if (controller)
        {
            app.MapControllers();
        }
        else if (useFilter)
        {
            app.MapGroup("/").AddEndpointFilter(async (context, next) =>
            {
                foreach (object? argument in context.Arguments)
                {
                    if (argument is not CreatePayment candidate)
                    {
                        continue;
                    }

                    var validationContext = new ValidationContext(candidate);
                    var errors = new List<ValidationResult>();

                    if (!Validator.TryValidateObject(candidate, validationContext, errors, true))
                    {
                        return Results.ValidationProblem(errors.ToDictionary(
                            e => e.MemberNames.FirstOrDefault() ?? "request",
                            e => new[] { e.ErrorMessage ?? "invalid" }));
                    }
                }

                return await next(context);
            }).MapPost("/mvc", (CreatePayment body) => Results.Ok(new { got = body.AmountMinor }));
        }
        else
        {
            app.MapPost("/mvc", (CreatePayment body) => Results.Ok(new { got = body.AmountMinor }));
        }

        await app.StartAsync();
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        int accepted = 0;
        int rejected = 0;

        foreach ((string _, string json) in requests)
        {
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using HttpResponseMessage response = await http.PostAsync("/mvc", content);

            if (response.IsSuccessStatusCode)
            {
                accepted++;
            }
            else
            {
                rejected++;
            }
        }

        await app.StopAsync();
        return $"{accepted,8}   {rejected,8}";
    }
}

// ---------------------------------------------------------------------------
// 5. HARD — choosing, and defending the choice.
// ---------------------------------------------------------------------------
static void Exercise5()
{
    Console.WriteLine("Exercise 5: you are starting a new payments API. Pick a style and");
    Console.WriteLine("            defend it. Then say what you would do if the team had");
    Console.WriteLine("            already written forty controllers.");
    Console.WriteLine();
    Console.WriteLine("   THE RECOMMENDATION: MINIMAL APIS, with the cross-cutting behaviour");
    Console.WriteLine("   applied to route groups, and every handler an extracted named");
    Console.WriteLine("   method rather than a lambda.");
    Console.WriteLine();
    Console.WriteLine("   The defence, in the order the reasons actually matter:");
    Console.WriteLine();
    Console.WriteLine("   1. THE BEHAVIOUR IS VISIBLE. Everything [ApiController] does");
    Console.WriteLine("      invisibly - validation, ProblemDetails, binding inference - is a");
    Console.WriteLine("      line you wrote and can read. That is worth more than it sounds:");
    Console.WriteLine("      the incident in this module is entirely about a behaviour nobody");
    Console.WriteLine("      could see.");
    Console.WriteLine();
    Console.WriteLine("   2. TYPED RESULTS. Results<Ok<T>, NotFound, ValidationProblem> puts");
    Console.WriteLine("      the response set in the signature, where the compiler checks it");
    Console.WriteLine("      and OpenAPI reads it. Controllers have nothing equivalent.");
    Console.WriteLine();
    Console.WriteLine("   3. ONE FILTER CONCEPT instead of five, and no base class to inherit");
    Console.WriteLine("      or to arrange in a test.");
    Console.WriteLine();
    Console.WriteLine("   4. IT IS WHERE THE FRAMEWORK IS GOING. Validation in .NET 10,");
    Console.WriteLine("      OpenAPI, and the AOT-friendly request-delegate generator all");
    Console.WriteLine("      arrived for minimal APIs first.");
    Console.WriteLine();
    Console.WriteLine("   THE HONEST COSTS:");
    Console.WriteLine();
    Console.WriteLine("     - You must remember the things controllers do for you. If nobody");
    Console.WriteLine("       on the team has read this module, controllers are safer.");
    Console.WriteLine();
    Console.WriteLine("     - Organising sixty endpoints across files is a convention you have");
    Console.WriteLine("       to invent. Controllers give you one for free, and a class per");
    Console.WriteLine("       resource is a genuinely good default that minimal APIs make you");
    Console.WriteLine("       recreate.");
    Console.WriteLine();
    Console.WriteLine("     - Some things are still MVC-only or MVC-first: model binders,");
    Console.WriteLine("       output formatters, views, and anything a library ships as an");
    Console.WriteLine("       IActionFilter.");
    Console.WriteLine();
    Console.WriteLine("   IF FORTY CONTROLLERS ALREADY EXIST: KEEP THEM.");
    Console.WriteLine();
    Console.WriteLine("   This is the part where the honest answer is boring. A port buys");
    Console.WriteLine("   nothing a customer can see, and this module measured what it costs -");
    Console.WriteLine("   four bad rows out of five requests, from a diff that read correctly.");
    Console.WriteLine();
    Console.WriteLine("   Both styles run side by side in one application; the module's first");
    Console.WriteLine("   file does exactly that. So write NEW endpoints minimally, leave the");
    Console.WriteLine("   forty alone, and port one only when you are already rewriting it for");
    Console.WriteLine("   a reason of its own.");
    Console.WriteLine();
    Console.WriteLine("   The one thing worth doing across both: make the error envelope the");
    Console.WriteLine("   same. AddProblemDetails() gives minimal endpoints the shape");
    Console.WriteLine("   [ApiController] already produces, so a client sees one contract");
    Console.WriteLine("   regardless of which style answered.");
}

// ---------------------------------------------------------------------------
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

public static class PaymentEndpoints
{
    // The response set is in the signature: the compiler checks it and OpenAPI
    // reads it without any attribute.
    public static Results<Ok<Payment>, NotFound> Get(string id, IPaymentStore store) =>
        store.Find(id) is { } payment
            ? TypedResults.Ok(payment)
            : TypedResults.NotFound();
}

public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}

[ApiController]
[Route("/")]
public sealed class PaymentsController : ControllerBase
{
    [HttpPost("mvc")]
    public IActionResult Create(CreatePayment body) => Ok(new { got = body.AmountMinor });

    [NonAction]
    public IActionResult Find(string id, IPaymentStore store) =>
        store.Find(id) is { } payment ? Ok(payment) : NotFound();
}
