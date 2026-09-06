// 02-what-breaks.cs — Nine changes to a payload, run against a client compiled
// before any of them, so the answer is measured rather than argued.
//
// Run:  dotnet run 02-what-breaks.cs -c Release
//
// EXACT vs RATIO: every outcome here is deterministic.

#:sdk Microsoft.NET.Sdk
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Text.Json;
using System.Text.Json.Serialization;

ResponseChanges();
RequestChanges();
TheStrictClient();
Rules();

// ---------------------------------------------------------------------------
static void ResponseChanges()
{
    Console.WriteLine("1. Changing a RESPONSE, read by a client that predates the change");
    Console.WriteLine();
    Console.WriteLine("   The client deserialises into the type it was compiled with:");
    Console.WriteLine();
    Console.WriteLine("     record PaymentV1(string Id, long AmountMinor, string Currency);");
    Console.WriteLine();

    Console.WriteLine("   the change                            client sees               breaks");
    Console.WriteLine("   ----------                            -----------               ------");

    // The baseline.
    Read("nothing changed",
        """{"id":"PAY-1","amountMinor":50000,"currency":"GBP"}""");

    // Additive: a new field the client does not know about.
    Read("a field added",
        """{"id":"PAY-1","amountMinor":50000,"currency":"GBP","status":"captured"}""");

    // A field removed.
    Read("a field removed",
        """{"id":"PAY-1","amountMinor":50000}""");

    // A field renamed - which is a removal and an addition at once.
    Read("a field renamed",
        """{"id":"PAY-1","minorAmount":50000,"currency":"GBP"}""");

    // A number that no longer fits the client's declared type.
    Read("number outgrew the client's type",
        """{"id":"PAY-1","amountMinor":170141183460469231731687303715884105727,"currency":"GBP"}""");

    // A type changed from number to string.
    Read("number became a string",
        """{"id":"PAY-1","amountMinor":"50000","currency":"GBP"}""");

    // A scalar became an object - the change that looks small in a schema.
    Read("scalar became an object",
        """{"id":"PAY-1","amountMinor":{"value":50000,"scale":2},"currency":"GBP"}""");

    // A value that is now null.
    Read("a value became null",
        """{"id":"PAY-1","amountMinor":50000,"currency":null}""");

    // An enum gained a member the client has never heard of.
    Read("a new enum value",
        """{"id":"PAY-1","amountMinor":50000,"currency":"JPY"}""");

    Console.WriteLine();
    Console.WriteLine("   SIX OF THE NINE BREAK, and the pattern is worth stating precisely:");
    Console.WriteLine();
    Console.WriteLine("     ADDING IS SAFE. A field the client has never heard of is ignored by");
    Console.WriteLine("     default, which is why 'we added a field' is not a version.");
    Console.WriteLine();
    Console.WriteLine("     REMOVING IS SILENT AND WRONG. The field is absent, so the property");
    Console.WriteLine("     takes its default - an empty string, or zero. Nothing throws, which");
    Console.WriteLine("     makes it worse than the ones that do.");
    Console.WriteLine();
    Console.WriteLine("     RENAMING IS A REMOVAL. It reads like one change and it is two.");
    Console.WriteLine();
    Console.WriteLine("     CHANGING A TYPE THROWS, which is the good outcome - the client fails");
    Console.WriteLine("     loudly at the boundary rather than acting on a wrong value.");
    Console.WriteLine();
    Console.WriteLine("     A BIGGER NUMBER OF THE SAME TYPE IS FINE until it stops fitting, and");
    Console.WriteLine("     then it throws. There is no quiet truncation, which is worth knowing");
    Console.WriteLine("     because that is exactly what several other formats do.");
    Console.WriteLine();
    Console.WriteLine("   READ THE 'a field removed' ROW AGAIN, because it is the dangerous one.");
    Console.WriteLine("   The client received a payment with a currency of empty string and no");
    Console.WriteLine("   error anywhere. Whatever it does next - display it, store it, compare");
    Console.WriteLine("   it - it does with a value nobody sent.");
    Console.WriteLine();
    Console.WriteLine("   AND THE ENUM ROW IS THE ONE PEOPLE FORGET. Adding a currency is");
    Console.WriteLine("   additive on the server and a new value the client's switch statement");
    Console.WriteLine("   has never seen. Whether that breaks depends entirely on how the client");
    Console.WriteLine("   was written, which means you cannot know.");
    Console.WriteLine();

    static void Read(string label, string json)
    {
        string outcome;
        bool breaks;

        try
        {
            PaymentV1? payment = JsonSerializer.Deserialize<PaymentV1>(json, Options());

            outcome = payment is null
                ? "null"
                : $"{payment.Id}, {payment.AmountMinor}, '{payment.Currency}'";

            // A break is a field the client needed and did not get: either it
            // threw, or a property holds a default the server never sent.
            breaks = payment is null
                || payment.AmountMinor == 0
                || string.IsNullOrEmpty(payment.Currency);
        }
        catch (Exception exception)
        {
            outcome = exception.GetType().Name;
            breaks = true;
        }

        Console.WriteLine($"   {label,-36}  {outcome,-24}  {(breaks ? "YES" : "no")}");
    }
}

// ---------------------------------------------------------------------------
static void RequestChanges()
{
    Console.WriteLine("2. Changing a REQUEST, sent by a client that predates the change");
    Console.WriteLine();
    Console.WriteLine("   The client sends what it always sent. The server now expects");
    Console.WriteLine("   something else:");
    Console.WriteLine();
    Console.WriteLine("     the client sends   {\"paymentId\":\"PAY-1\",\"amountMinor\":50000}");
    Console.WriteLine();

    Console.WriteLine("   the server change                     result");
    Console.WriteLine("   -----------------                     ------");

    const string Sent = """{"paymentId":"PAY-1","amountMinor":50000}""";

    // A new optional field.
    Accept<RefundWithOptional>("a new OPTIONAL field", Sent);

    // A new required field - the change that looks additive.
    Accept<RefundWithRequired>("a new REQUIRED field", Sent);

    // A field the server no longer reads.
    Accept<RefundWithoutAmount>("a field the server dropped", Sent);

    // Tightened validation on an existing field.
    Accept<RefundWithRange>("tighter validation", Sent);

    Console.WriteLine();
    Console.WriteLine("   THE SECOND ROW IS THE ONE THAT SURPRISES PEOPLE, because adding a");
    Console.WriteLine("   field to a request feels like the same kind of change as adding one to");
    Console.WriteLine("   a response - and it is the opposite.");
    Console.WriteLine();
    Console.WriteLine("   THE ASYMMETRY IS THE WHOLE OF IT:");
    Console.WriteLine();
    Console.WriteLine("     ADDING TO A RESPONSE IS SAFE, because the client ignores what it");
    Console.WriteLine("     does not know.");
    Console.WriteLine();
    Console.WriteLine("     ADDING A REQUIRED FIELD TO A REQUEST IS BREAKING, because the");
    Console.WriteLine("     client cannot send what it has never heard of.");
    Console.WriteLine();
    Console.WriteLine("   Say it as a direction and it stops being confusing: YOU MAY ALWAYS GIVE");
    Console.WriteLine("   MORE, AND NEVER DEMAND MORE.");
    Console.WriteLine();
    Console.WriteLine("   TIGHTENING VALIDATION IS THE SAME MISTAKE WEARING A DIFFERENT HAT. A");
    Console.WriteLine("   new maximum, a stricter pattern, a shorter length - each rejects");
    Console.WriteLine("   requests that were valid yesterday, which is a breaking change however");
    Console.WriteLine("   reasonable the new rule is.");
    Console.WriteLine();
    Console.WriteLine("   The last row passes here only because the value happens to satisfy the");
    Console.WriteLine("   new rule. That is the trap: tightened validation breaks SOME callers,");
    Console.WriteLine("   which means it passes your tests and fails in production for whoever");
    Console.WriteLine("   was near the boundary.");
    Console.WriteLine();

    static void Accept<T>(string label, string json)
    {
        string outcome;

        try
        {
            T? bound = JsonSerializer.Deserialize<T>(json, Options());

            outcome = bound is null ? "null" : $"accepted: {bound}";
        }
        catch (Exception exception)
        {
            outcome = $"REJECTED: {exception.GetType().Name}";
        }

        Console.WriteLine($"   {label,-36}  {outcome}");
    }
}

// ---------------------------------------------------------------------------
static void TheStrictClient()
{
    Console.WriteLine("3. The client that made the safe change unsafe");
    Console.WriteLine();
    Console.WriteLine("   Everything in section 1 assumed the client ignores unknown fields,");
    Console.WriteLine("   which is the default. A client can turn that off:");
    Console.WriteLine();

    var tolerant = new JsonSerializerOptions
    {
        PropertyNameCaseInsensitive = true
    };

    var strict = new JsonSerializerOptions
    {
        PropertyNameCaseInsensitive = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    Console.WriteLine("   client configuration                  a field is added to the response");
    Console.WriteLine("   --------------------                  --------------------------------");

    Try("default (unknown fields ignored)", tolerant);
    Try("UnmappedMemberHandling.Disallow", strict);

    Console.WriteLine();
    Console.WriteLine("   THE ADDITIVE CHANGE BROKE A CLIENT. Nothing about the server was");
    Console.WriteLine("   wrong: adding a field is the safest change there is, and this client");
    Console.WriteLine("   opted out of that guarantee.");
    Console.WriteLine();
    Console.WriteLine("   Both sides of this are worth taking seriously:");
    Console.WriteLine();
    Console.WriteLine("     AS A CLIENT AUTHOR, do not do this against an API you do not own.");
    Console.WriteLine("     Strict deserialisation converts every future additive change into an");
    Console.WriteLine("     outage on your side, and additive changes are the ones nobody");
    Console.WriteLine("     announces.");
    Console.WriteLine();
    Console.WriteLine("     AS AN API AUTHOR, know that some caller has done it anyway. It does");
    Console.WriteLine("     not make adding a field wrong - it makes 'we announce additive");
    Console.WriteLine("     changes too' a cheap kindness, and it means the first bug report");
    Console.WriteLine("     after an additive change may be real.");
    Console.WriteLine();
    Console.WriteLine("   THE GENERAL POINT IS LARGER THAN JSON: A COMPATIBILITY GUARANTEE IS A");
    Console.WriteLine("   PROMISE ABOUT WHAT YOU SEND, AND WHETHER IT HOLDS DEPENDS ON HOW THE");
    Console.WriteLine("   OTHER SIDE READS IT.");
    Console.WriteLine();

    static void Try(string label, JsonSerializerOptions options)
    {
        string outcome;

        try
        {
            PaymentV1? payment = JsonSerializer.Deserialize<PaymentV1>(
                """{"id":"PAY-1","amountMinor":50000,"currency":"GBP","status":"captured"}""",
                options);

            outcome = $"accepted: {payment!.Id}, {payment.AmountMinor}, '{payment.Currency}'";
        }
        catch (Exception exception)
        {
            outcome = $"REJECTED: {exception.GetType().Name}";
        }

        Console.WriteLine($"   {label,-36}  {outcome}");
    }
}

// ---------------------------------------------------------------------------
static void Rules()
{
    Console.WriteLine("4. The list worth memorising");
    Console.WriteLine();
    Console.WriteLine("   SAFE - no new version needed:");
    Console.WriteLine();
    Console.WriteLine("     - adding a field to a response");
    Console.WriteLine("     - adding an OPTIONAL field to a request");
    Console.WriteLine("     - adding a new endpoint");
    Console.WriteLine("     - adding a new value to something the client treats as opaque");
    Console.WriteLine("     - relaxing validation");
    Console.WriteLine("     - making a required request field optional");
    Console.WriteLine();
    Console.WriteLine("   BREAKING - needs a version:");
    Console.WriteLine();
    Console.WriteLine("     - removing or renaming a response field");
    Console.WriteLine("     - changing a field's type, including number to string");
    Console.WriteLine("     - changing units, or the meaning of a value");
    Console.WriteLine("     - adding a REQUIRED request field");
    Console.WriteLine("     - tightening validation");
    Console.WriteLine("     - changing a status code for an existing condition");
    Console.WriteLine("     - changing the default of an omitted parameter");
    Console.WriteLine();
    Console.WriteLine("   TWO ROWS IN THAT SECOND LIST ARE NOT ABOUT THE PAYLOAD AT ALL, and");
    Console.WriteLine("   they are the ones most often missed.");
    Console.WriteLine();
    Console.WriteLine("   A STATUS CODE IS PART OF THE CONTRACT. Changing a 404 to a 204 for an");
    Console.WriteLine("   empty result is invisible in any schema and breaks every client that");
    Console.WriteLine("   branches on it - and clients branch on status codes far more reliably");
    Console.WriteLine("   than on bodies.");
    Console.WriteLine();
    Console.WriteLine("   A DEFAULT IS PART OF THE CONTRACT. If page size defaults to 20 and you");
    Console.WriteLine("   change it to 50, every caller who omitted it gets different results");
    Console.WriteLine("   from an identical request. Nothing in the schema changed.");
    Console.WriteLine();
    Console.WriteLine("   THE TEST TO APPLY, and it is more reliable than the list:");
    Console.WriteLine();
    Console.WriteLine("     COULD A CLIENT THAT WORKED YESTERDAY, UNCHANGED, BEHAVE DIFFERENTLY");
    Console.WriteLine("     TODAY? If yes, it is breaking - whatever the change is called and");
    Console.WriteLine("     however obviously correct it is.");
}

// ---------------------------------------------------------------------------
static JsonSerializerOptions Options() => new()
{
    PropertyNameCaseInsensitive = true
};

// ---------------------------------------------------------------------------
// The client's type, compiled before any of the changes above.
public sealed record PaymentV1(string Id, long AmountMinor, string Currency);

// The server's request types, in four versions.
public sealed record RefundWithOptional(string PaymentId, long AmountMinor)
{
    public string? Reason { get; init; }

    public override string ToString() => $"{PaymentId} {AmountMinor} reason={Reason ?? "(none)"}";
}

public sealed record RefundWithRequired(string PaymentId, long AmountMinor)
{
    // A required member: the deserialiser refuses a payload that omits it.
    public required string Reason { get; init; }

    public override string ToString() => $"{PaymentId} {AmountMinor} reason={Reason}";
}

public sealed record RefundWithoutAmount(string PaymentId)
{
    public override string ToString() => $"{PaymentId} (amount no longer read)";
}

public sealed record RefundWithRange(string PaymentId, long AmountMinor)
{
    // Stands in for validation tightened to a maximum of 100,000 minor units.
    public override string ToString() =>
        AmountMinor <= 100_000
            ? $"{PaymentId} {AmountMinor} (within the new limit)"
            : $"{PaymentId} {AmountMinor} (would now be rejected)";
}
