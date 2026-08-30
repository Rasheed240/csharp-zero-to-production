using System.Globalization;
using LedgerFees;

CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

// The caller does NOT pass feePercent. It relies on the library's default.
decimal charged = Fees.ApplyFee(100m);

Console.WriteLine($"library says its default is : {Fees.CurrentDefaultPercent()}%");
Console.WriteLine($"ApplyFee(100m) returned     : {charged}");
