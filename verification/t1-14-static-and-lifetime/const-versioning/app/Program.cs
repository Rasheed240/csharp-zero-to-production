using System;
using Lib;

class Program
{
    static void Main()
    {
        Console.WriteLine($"  const int     MaxRetries      = {Config.MaxRetries}");
        Console.WriteLine($"  const decimal Vat             = {Config.Vat}");
        Console.WriteLine($"  static readonly MaxRetriesField = {Config.MaxRetriesField}");
        Console.WriteLine($"  static readonly VatField        = {Config.VatField}");
    }
}
