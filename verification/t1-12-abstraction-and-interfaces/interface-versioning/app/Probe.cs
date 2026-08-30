using System;
using Lib;
public static class Probe
{
    public static void Run(INotifier n)
    {
        Console.WriteLine(n.SendUrgent("disk almost full"));
    }
}
