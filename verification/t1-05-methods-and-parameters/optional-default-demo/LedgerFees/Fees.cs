namespace LedgerFees;

public static class Fees
{
    // The default fee is 2%. Version 2 of this library changes it to 5%.
    public static decimal ApplyFee(decimal amount, int feePercent = 2)
    {
        return amount + (amount * feePercent / 100m);
    }

    public static int CurrentDefaultPercent() => 2;
}
