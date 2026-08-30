// 01-dispatch-basics.cs — who decides which method runs, and when that decision
// is made. .NET 10.0.400. Run: dotnet run 01-dispatch-basics.cs

using System;

class Notification
{
    public virtual string Channel() => "generic";
    public string Send() => $"sending via {Channel()}";      // not virtual
    public virtual string Format() => $"[{Channel()}] message";
}

class EmailNotification : Notification
{
    public override string Channel() => "email";
}

class SmsNotification : Notification
{
    // 'new', not 'override'. A separate member, not a replacement.
    public new string Channel() => "sms";
}

class PushNotification : Notification
{
    public override string Channel() => "push";
    public override string Format() => $"PUSH! {base.Channel()} -> {Channel()}";
}

class Program
{
    static void Main()
    {
        Notification[] all =
        {
            new Notification(), new EmailNotification(),
            new SmsNotification(), new PushNotification()
        };

        Console.WriteLine("Through a Notification-typed reference:");
        foreach (var n in all)
            Console.WriteLine($"  {n.GetType().Name,-20} Channel()={n.Channel(),-8} Send()={n.Send()}");

        Console.WriteLine();
        Console.WriteLine("Through each object's own declared type:");
        Console.WriteLine($"  EmailNotification : {new EmailNotification().Channel()}");
        Console.WriteLine($"  SmsNotification   : {new SmsNotification().Channel()}");
        Console.WriteLine($"  PushNotification  : {new PushNotification().Channel()}");

        Console.WriteLine();
        Console.WriteLine("Format() calls Channel() from inside the base class:");
        foreach (var n in all)
            Console.WriteLine($"  {n.GetType().Name,-20} {n.Format()}");

        Console.WriteLine();
        var sms = new SmsNotification();
        Notification asBase = sms;
        Console.WriteLine("One SmsNotification object, two references:");
        Console.WriteLine($"  sms.Channel()     = {sms.Channel()}");
        Console.WriteLine($"  asBase.Channel()  = {asBase.Channel()}");
        Console.WriteLine($"  same object?      = {ReferenceEquals(sms, asBase)}");
        Console.WriteLine($"  runtime type      = {asBase.GetType().Name}");
    }
}
