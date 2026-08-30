using System;
using Lib;

// An implementation written against version 1. Never edited again.
public class EmailNotifier : INotifier
{
    public string Send(string message) => "email: " + message;
}

class Program
{
    static void Main()
    {
        INotifier n = new EmailNotifier();
        Console.WriteLine(n.Send("deploy finished"));
        Console.WriteLine("EmailNotifier still loads and runs.");
        Probe.Run(n);
    }
}
