// 05-minimal-example.cs — One endpoint whose binding cannot silently produce a
// wrong value, with every decision on show.
//
// Run:  dotnet run 05-minimal-example.cs -c Release
//
// EXACT vs RATIO: every status code and bound value here is deterministic.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Logging.ClearProviders();

// A rejection should be a document naming the field, not a bare status code.
// Both lines are needed, as measured in the previous module.
builder.Services.AddProblemDetails();
builder.Services.AddSingleton<IClock, SystemClock>();

var app = builder.Build();
app.UseStatusCodePages();

// Validation on the GROUP, so an endpoint added later inherits it.
var payments = app.MapGroup("/v1/payments")
    .AddEndpointFilter(ValidationFilter.Validate);

// The body is one required, validated type. Every other value is a parameter
// bound by the ordinary rules, with [FromHeader] written out because it is the
// one source that is never inferred.
payments.MapPost("/", (
    CreatePaymentRequest body,
    [FromHeader(Name = "X-Tenant")] string tenant,
    IClock clock) => Results.Created("/v1/payments/PAY-1", new
    {
        amount = body.AmountMinor,
        currency = body.Currency,
        tenant,
        at = clock.Name
    }));

// A domain type as a parameter: the handler cannot be handed an unparseable
// string, because TryParse rejected it before the handler was reached.
payments.MapGet("/quote/{amount}", (Money amount) =>
    Results.Ok(new { currency = amount.Currency, minor = amount.AmountMinor }));

await app.StartAsync();
using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

Console.WriteLine("Binding that cannot silently produce a wrong value");
Console.WriteLine();
Console.WriteLine("   request                              status   response");
Console.WriteLine("   -------                              ------   --------");

await Post(http, """{"amountMinor":123450,"currency":"GBP"}""", "acme", "valid");
await Post(http, """{"amount_minor":123450,"currency":"GBP"}""", "acme", "field renamed");
await Post(http, """{"amountMinor":0,"currency":"GBP"}""", "acme", "amount of zero");
await Post(http, """{"amountMinor":123450}""", "acme", "currency missing");
await Post(http, """{"amountMinor":123450,"currency":"GBP"}""", null, "no tenant header");
await Post(http, "", "acme", "empty body");

await Get(http, "/v1/payments/quote/GBP:5000", "a parseable Money");
await Get(http, "/v1/payments/quote/nonsense", "an unparseable Money");

Console.WriteLine();
Console.WriteLine("   The checklist this file is built from:");
Console.WriteLine();
Console.WriteLine("     - required members, so a partial body never becomes an object of");
Console.WriteLine("       defaults - and a RENAMED field is caught, because the correctly");
Console.WriteLine("       named one is then missing");
Console.WriteLine("     - validation attributes for the VALUES, because required only says");
Console.WriteLine("       the field arrived and says nothing about an amount of -5");
Console.WriteLine("     - the validation filter on the GROUP, not the endpoint");
Console.WriteLine("     - [FromHeader] written out, because it is the one source that is");
Console.WriteLine("       never inferred");
Console.WriteLine("     - a domain type with TryParse, so parsing happens once at the edge");
Console.WriteLine("       rather than at the top of every handler");
Console.WriteLine("     - AddProblemDetails and UseStatusCodePages, so every rejection is a");
Console.WriteLine("       document rather than a bare code");
Console.WriteLine();
Console.WriteLine("   NOT USED HERE: UnmappedMemberHandling.Disallow. required members");
Console.WriteLine("   already catch the renamed field, because the correctly named property");
Console.WriteLine("   is then absent - so disallowing unknown members would add only the");
Console.WriteLine("   ability to name the offender, and would break any client that ever");
Console.WriteLine("   sends an extra field.");
Console.WriteLine();
Console.WriteLine("   Turn it on for an internal API with known clients and a strong");
Console.WriteLine("   preference for strictness; leave it off for a public one, where a");
Console.WriteLine("   client adding a field should not be a breaking change.");
Console.WriteLine();
Console.WriteLine("   And the monitoring that catches what none of this does: an alert on");
Console.WriteLine("   the AVERAGE PAYMENT AMOUNT. A binding failure produces valid requests");
Console.WriteLine("   carrying wrong data, so error rate and latency stay flat throughout.");

await app.StopAsync();

// ---------------------------------------------------------------------------
static async Task Post(HttpClient http, string json, string? tenant, string note)
{
    using var content = new StringContent(json, Encoding.UTF8, "application/json");
    using var request = new HttpRequestMessage(HttpMethod.Post, "/v1/payments")
    {
        Content = content
    };

    if (tenant is not null)
    {
        request.Headers.TryAddWithoutValidation("X-Tenant", tenant);
    }

    using HttpResponseMessage response = await http.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"   POST {note,-31}{(int)response.StatusCode,6}   {Trim(body)}");
}

static async Task Get(HttpClient http, string path, string note)
{
    using HttpResponseMessage response = await http.GetAsync(path);
    string body = await response.Content.ReadAsStringAsync();

    Console.WriteLine($"   GET  {note,-31}{(int)response.StatusCode,6}   {Trim(body)}");
}

static string Trim(string body) =>
    body.Length == 0 ? "(empty)" : body.Length > 62 ? body[..62] + "..." : body;

// ---------------------------------------------------------------------------
public sealed class CreatePaymentRequest
{
    [Range(1, 1_000_000)]
    public required long AmountMinor { get; set; }

    [StringLength(3, MinimumLength = 3)]
    public required string Currency { get; set; }
}

public interface IClock
{
    string Name { get; }
}

public sealed class SystemClock : IClock
{
    public string Name => "SystemClock";
}

public readonly record struct Money(string Currency, long AmountMinor)
{
    public static bool TryParse(string? value, IFormatProvider? provider, out Money result)
    {
        result = default;

        if (value is null)
        {
            return false;
        }

        int separator = value.IndexOf(':');
        if (separator <= 0 || separator == value.Length - 1)
        {
            return false;
        }

        if (!long.TryParse(value.AsSpan(separator + 1), NumberStyles.Integer,
            CultureInfo.InvariantCulture, out long amount))
        {
            return false;
        }

        result = new Money(value[..separator], amount);
        return true;
    }
}

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

            if (Validator.TryValidateObject(argument, validationContext, errors, true))
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
