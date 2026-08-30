namespace Contracts;

// VERSION 3 — the payoff. The accessor gains validation and a side effect.
// The public surface is unchanged, so App.exe keeps working uncompiled.
public class PricingConfig
{
    private decimal _markup;

    public decimal Markup
    {
        get
        {
            System.Console.WriteLine("   [Contracts v3] Markup getter ran");
            return _markup;
        }
        set
        {
            if (value < 1m)
                throw new System.ArgumentOutOfRangeException(
                    nameof(value), value, "Markup below 1.0 would sell at a loss.");
            _markup = value;
        }
    }

    public PricingConfig(decimal markup) => Markup = markup;
}
