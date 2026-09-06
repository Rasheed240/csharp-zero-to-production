// 05-minimal-example.cs — A minimal API with every convention [ApiController]
// would have supplied made explicit, and every handler an extracted method.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and body shape here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Text;
using Microsoft.AspNetCore.Http.HttpResults;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// The error envelope. Without this a minimal endpoint returns a bare status
// code where a controller would return a ProblemDetails document, so a client
// would have to handle two shapes.
builder.Services.AddProblemDetails();

builder.Services.AddSingleton<IPaymentStore, InMemoryStore>();

var app = builder.Build();

// AddProblemDetails() on its own is not enough. It registers the SERVICE that
// writes the document; a result like TypedResults.NotFound() writes no body at
// all, so nothing invokes it. UseStatusCodePages() is what fills a bodyless
// error response in. Measured: without it a 404 has an empty body and no
// content type; with it, application/problem+json carrying a traceId.
app.UseStatusCodePages();

// ===========================================================================
// One group carrying everything that would otherwise be per-endpoint. An
// endpoint added later inherits all of it and cannot forget any of it - which
// is the whole reason to write it here rather than in each handler.
// ===========================================================================
var payments = app.MapGroup("/v1/payments")
    .WithTags("payments")
    .AddEndpointFilter(ValidationFilter.Validate);

payments.MapGet("/{id}", PaymentEndpoints.Get);
payments.MapPost("/", PaymentEndpoints.Create);

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("A minimal API with the conventions written down");
Console.WriteLine();
Console.WriteLine("   request                                    status   body");
Console.WriteLine("   -------                                    ------   ----");

await ShowGet(http, "/health", "public");
await ShowPost(http, """{"amountMinor": 123450, "currency": "GBP"}""", "valid");
await ShowPost(http, """{"amountMinor": -5, "currency": "GBP"}""", "negative amount");
await ShowPost(http, """{"amountMinor": 100, "currency": "POUNDS"}""", "invented currency");
await ShowGet(http, "/v1/payments/PAY-0001", "found");
await ShowGet(http, "/v1/payments/PAY-9999", "not found");

Console.WriteLine();
Console.WriteLine("   Both handlers are ordinary static methods, so a test calls them with a");
Console.WriteLine("   fake store and no host at all:");
Console.WriteLine();

var store = new InMemoryStore();
store.Save(new Payment("PAY-0001", 123450, "GBP"));

Results<Ok<Payment>, NotFound> direct = PaymentEndpoints.Get("PAY-0001", store);
Results<Ok<Payment>, NotFound> absent = PaymentEndpoints.Get("PAY-9999", store);

Console.WriteLine($"     PaymentEndpoints.Get(\"PAY-0001\", store)  -> {direct.Result.GetType().Name}");
Console.WriteLine($"     PaymentEndpoints.Get(\"PAY-9999\", store)  -> {absent.Result.GetType().Name}");

if (direct.Result is Ok<Payment> ok)
{
    Console.WriteLine($"     and the value, unserialised             -> {ok.Value}");
}

Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - AddProblemDetails() AND UseStatusCodePages(), so errors have the");
Console.WriteLine("       same shape a controller would have produced - the first alone");
Console.WriteLine("       leaves a bodyless 404 bodyless");
Console.WriteLine("     - validation applied to the GROUP, so it cannot be forgotten by an");
Console.WriteLine("       endpoint added next month");
Console.WriteLine("     - every handler an extracted static method, so it is callable from a");
Console.WriteLine("       test with no host");
Console.WriteLine("     - typed results, so the response set is in the signature where the");
Console.WriteLine("       compiler checks it and OpenAPI can read it");
Console.WriteLine("     - /health outside the group, so nothing applies to it by accident");
Console.WriteLine();
Console.WriteLine("   Each of those replaces something [ApiController] would have done");
Console.WriteLine("   invisibly. That is the trade this module is about: the behaviour is");
Console.WriteLine("   the same either way, and here it is legible and per-group rather than");
Console.WriteLine("   implicit and per-attribute.");
Console.WriteLine();
Console.WriteLine("   In .NET 10 the validation filter can be replaced by the built-in:");
Console.WriteLine();
Console.WriteLine("     builder.Services.AddValidation();");
Console.WriteLine("     var payments = app.MapGroup(\"/v1/payments\").WithValidation();");
Console.WriteLine();
Console.WriteLine("   The hand-written one is kept here because the mechanism is worth seeing");
Console.WriteLine("   once, and because it is where anything the built-in does not cover");
Console.WriteLine("   would go.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task ShowGet(HttpClient http, string path, string note)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();
    Console.WriteLine($"   GET {path,-38}{(int)response.StatusCode,6}   {Trim(body)}");
    Console.WriteLine($"   {"",-42}         {note}");
}

static async Task ShowPost(HttpClient http, string json, string note)
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using HttpResponseMessage response = await http.PostAsync("/v1/payments", content);
    string body = await response.Content.ReadAsStringAsync();
    Console.WriteLine($"   POST /v1/payments {note,-24}{(int)response.StatusCode,6}   {Trim(body)}");
}

static string Trim(string body) =>
    body.Length == 0 ? "(empty)" : body.Length > 76 ? body[..76] + "..." : body;

// ---------------------------------------------------------------------------
public record Payment(string Id, long AmountMinor, string Currency);

public sealed class CreatePayment
{
    [Range(1, 1_000_000)]
    public long AmountMinor { get; set; }

    [Required]
    [StringLength(3, MinimumLength = 3)]
    public string Currency { get; set; } = "";
}

public interface IPaymentStore
{
    Payment? Find(string id);

    void Save(Payment payment);

    int Count { get; }
}

public sealed class InMemoryStore : IPaymentStore
{
    private readonly Dictionary<string, Payment> _payments = new();

    public int Count => _payments.Count;

    public Payment? Find(string id) => _payments.GetValueOrDefault(id);

    public void Save(Payment payment) => _payments[payment.Id] = payment;
}

// ---------------------------------------------------------------------------
// The handlers, as named methods. Nothing here knows about HTTP beyond the
// result type, so a test constructs a store and calls them.
public static class PaymentEndpoints
{
    public static Results<Ok<Payment>, NotFound> Get(string id, IPaymentStore store) =>
        store.Find(id) is { } payment
            ? TypedResults.Ok(payment)
            : TypedResults.NotFound();

    public static Results<Created<Payment>, ValidationProblem> Create(
        CreatePayment body, IPaymentStore store)
    {
        var payment = new Payment($"PAY-{store.Count + 1:D4}", body.AmountMinor, body.Currency);
        store.Save(payment);
        return TypedResults.Created($"/v1/payments/{payment.Id}", payment);
    }
}

// ---------------------------------------------------------------------------
// What [ApiController] would have done invisibly, written down once and
// applied to a group.
public static class ValidationFilter
{
    public static async ValueTask<object?> Validate(EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        foreach (object? argument in context.Arguments)
        {
            if (argument is null)
            {
                continue;
            }

            var validationContext = new ValidationContext(argument);
            var errors = new List<ValidationResult>();

            if (Validator.TryValidateObject(argument, validationContext, errors,
                validateAllProperties: true))
            {
                continue;
            }

            return Results.ValidationProblem(errors.ToDictionary(
                error => error.MemberNames.FirstOrDefault() ?? "request",
                error => new[] { error.ErrorMessage ?? "invalid" }));
        }

        return await next(context);
    }
}
