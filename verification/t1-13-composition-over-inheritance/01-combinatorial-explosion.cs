// 01-combinatorial-explosion.cs — why a hierarchy that models "kinds of thing"
// stops working once things vary along more than one axis.
// .NET 10.0.400. Run: dotnet run 01-combinatorial-explosion.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ---- THE INHERITANCE VERSION ----------------------------------------------
// Three axes: destination (email/sms), retry (yes/no), encryption (yes/no).
// Every combination needs its own class, because a class has one base.
abstract class Sender { public abstract string Send(string msg); }

class EmailSender : Sender { public override string Send(string m) => $"email({m})"; }
class SmsSender : Sender { public override string Send(string m) => $"sms({m})"; }

class RetryingEmailSender : EmailSender
{
    public override string Send(string m) => $"retry[{base.Send(m)}]";
}
class RetryingSmsSender : SmsSender
{
    public override string Send(string m) => $"retry[{base.Send(m)}]";
}
class EncryptedEmailSender : EmailSender
{
    public override string Send(string m) => $"enc[{base.Send(m)}]";
}
class EncryptedSmsSender : SmsSender
{
    public override string Send(string m) => $"enc[{base.Send(m)}]";
}
class RetryingEncryptedEmailSender : EncryptedEmailSender
{
    public override string Send(string m) => $"retry[{base.Send(m)}]";
}
class RetryingEncryptedSmsSender : EncryptedSmsSender
{
    public override string Send(string m) => $"retry[{base.Send(m)}]";
}
// Adding "compressed" as a fourth behaviour doubles this list again.

// ---- THE COMPOSITION VERSION ----------------------------------------------
interface ISender { string Send(string message); }

sealed class Email : ISender { public string Send(string m) => $"email({m})"; }
sealed class Sms : ISender { public string Send(string m) => $"sms({m})"; }

// Each behaviour is a wrapper that holds another ISender and adds one thing.
sealed class Retrying : ISender
{
    private readonly ISender _inner;
    public Retrying(ISender inner) => _inner = inner;
    public string Send(string m) => $"retry[{_inner.Send(m)}]";
}

sealed class Encrypted : ISender
{
    private readonly ISender _inner;
    public Encrypted(ISender inner) => _inner = inner;
    public string Send(string m) => $"enc[{_inner.Send(m)}]";
}

sealed class Compressed : ISender
{
    private readonly ISender _inner;
    public Compressed(ISender inner) => _inner = inner;
    public string Send(string m) => $"gz[{_inner.Send(m)}]";
}

class Program
{
    static void Main()
    {
        Console.WriteLine("--- inheritance: one class per combination ---");
        Sender[] byInheritance =
        {
            new EmailSender(), new SmsSender(),
            new RetryingEmailSender(), new RetryingSmsSender(),
            new EncryptedEmailSender(), new EncryptedSmsSender(),
            new RetryingEncryptedEmailSender(), new RetryingEncryptedSmsSender()
        };
        foreach (var s in byInheritance)
            Console.WriteLine($"  {s.GetType().Name,-32} {s.Send("hi")}");

        int destinations = 2;
        Console.WriteLine();
        Console.WriteLine("  classes needed as behaviours are added:");
        for (int b = 0; b <= 4; b++)
            Console.WriteLine($"    {destinations} destinations x {b} behaviours -> " +
                              $"{destinations * (int)Math.Pow(2, b),3} classes");

        Console.WriteLine();
        Console.WriteLine("--- composition: one class per behaviour, combined at run time ---");
        ISender[] byComposition =
        {
            new Email(),
            new Sms(),
            new Retrying(new Email()),
            new Retrying(new Sms()),
            new Encrypted(new Email()),
            new Encrypted(new Sms()),
            new Retrying(new Encrypted(new Email())),
            new Retrying(new Encrypted(new Sms())),
            // combinations the inheritance version has no class for:
            new Compressed(new Retrying(new Encrypted(new Email()))),
            new Encrypted(new Retrying(new Sms()))
        };
        foreach (var s in byComposition)
            Console.WriteLine($"  {s.Send("hi")}");

        Console.WriteLine();
        Console.WriteLine("  classes needed as behaviours are added:");
        for (int b = 0; b <= 4; b++)
            Console.WriteLine($"    {destinations} destinations + {b} behaviours -> " +
                              $"{destinations + b,3} classes");

        Console.WriteLine();
        Console.WriteLine("  and note the last two: ordering is a run-time choice, so");
        Console.WriteLine("  enc-then-retry and retry-then-enc are both available without");
        Console.WriteLine("  writing a class for either.");
    }
}
