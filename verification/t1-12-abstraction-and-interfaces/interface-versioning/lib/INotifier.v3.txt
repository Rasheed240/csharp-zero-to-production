namespace Lib;

// VERSION 3 — the same new member, but with a DEFAULT IMPLEMENTATION.
// A default interface method (C# 8+). Existing implementors need no change.
public interface INotifier
{
    string Send(string message);

    string SendUrgent(string message) => "URGENT: " + Send(message);
}
