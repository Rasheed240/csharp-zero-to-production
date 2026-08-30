// Demo 8 — DateTime loses the one piece of information you need to reconstruct
// when something happened. DateTimeOffset does not.
using System.Globalization;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

DateTime unspecified = new DateTime(2026, 3, 29, 1, 30, 0);
DateTime asUtc = new DateTime(2026, 3, 29, 1, 30, 0, DateTimeKind.Utc);
DateTime asLocal = new DateTime(2026, 3, 29, 1, 30, 0, DateTimeKind.Local);

Console.WriteLine("Three DateTime values, printed the usual way:");
Console.WriteLine($"  unspecified  {unspecified}");
Console.WriteLine($"  utc          {asUtc}");
Console.WriteLine($"  local        {asLocal}");
Console.WriteLine("  ...indistinguishable.");
Console.WriteLine();
Console.WriteLine("The same three with the round-trip format O:");
Console.WriteLine($"  unspecified  {unspecified:O}   Kind = {unspecified.Kind}");
Console.WriteLine($"  utc          {asUtc:O}   Kind = {asUtc.Kind}");
Console.WriteLine($"  local        {asLocal:O}   Kind = {asLocal.Kind}");
Console.WriteLine();
Console.WriteLine("Only the round-trip format 'O' reveals the difference. Store any of these");
Console.WriteLine("in a database column that drops the Kind, read it back, and you cannot tell");
Console.WriteLine("which instant it referred to.");
Console.WriteLine();

// DateTimeOffset carries the offset with it, so the instant is unambiguous.
DateTimeOffset withOffset = new DateTimeOffset(2026, 3, 29, 1, 30, 0, TimeSpan.FromHours(1));
Console.WriteLine("DateTimeOffset keeps the offset:");
Console.WriteLine($"  value        {withOffset:O}");
Console.WriteLine($"  as UTC       {withOffset.ToUniversalTime():O}");
Console.WriteLine($"  UtcTicks     {withOffset.UtcTicks}");
Console.WriteLine();

// Two different local times that are the SAME instant.
DateTimeOffset london = new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.FromHours(1));
DateTimeOffset lagos = new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.FromHours(1));
DateTimeOffset newYork = new DateTimeOffset(2026, 6, 1, 7, 0, 0, TimeSpan.FromHours(-4));

Console.WriteLine("Comparing instants across zones:");
Console.WriteLine($"  London  {london:O}");
Console.WriteLine($"  Lagos   {lagos:O}");
Console.WriteLine($"  NewYork {newYork:O}");
Console.WriteLine($"  london == newYork (same instant?) -> {london == newYork}");
Console.WriteLine($"  london.EqualsExact(newYork)       -> {london.EqualsExact(newYork)}");
Console.WriteLine();

// A date with no time is its own type, and should be.
DateOnly invoiceDate = new DateOnly(2026, 3, 29);
TimeOnly cutOff = new TimeOnly(17, 0);
Console.WriteLine("When there is genuinely no time or no date:");
Console.WriteLine($"  DateOnly invoiceDate -> {invoiceDate:O}");
Console.WriteLine($"  TimeOnly cutOff      -> {cutOff:O}");
Console.WriteLine();
Console.WriteLine("An invoice date is a date. Modelling it as DateTime invites a midnight");
Console.WriteLine("value that shifts to the previous day when someone converts time zones.");
