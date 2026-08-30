// 06-production.cs — interfaces and an abstract class doing different jobs in
// one component, chosen for different reasons.
// .NET 10.0.400. Run: dotnet run 06-production.cs

using System;
using System.Collections.Generic;
using System.Linq;

// ---- INTERFACES: what the outside world depends on ------------------------
// Narrow, role-shaped, and easy to substitute in a test.
public interface IClock { DateTimeOffset UtcNow { get; } }

public interface IDeliveryLog { void Record(string line); }

public interface IChannel
{
    string Name { get; }
    bool CanHandle(Recipient recipient);
    DeliveryOutcome Deliver(Recipient recipient, string body);
}

public readonly record struct Recipient(string Id, string? Email, string? Phone, bool PushEnabled);
public readonly record struct DeliveryOutcome(bool Delivered, string Detail);

// ---- ABSTRACT CLASS: shared mechanism the channels inherit ----------------
// Chosen because every channel needs the same retry, timing and logging, and
// none of them should be able to skip it.
public abstract class ChannelBase : IChannel
{
    private readonly IClock _clock;
    private readonly IDeliveryLog _log;
    private readonly int _maxAttempts;

    protected ChannelBase(IClock clock, IDeliveryLog log, int maxAttempts = 3)
    {
        _clock = clock;
        _log = log;
        _maxAttempts = maxAttempts < 1
            ? throw new ArgumentOutOfRangeException(nameof(maxAttempts))
            : maxAttempts;
    }

    public abstract string Name { get; }
    public abstract bool CanHandle(Recipient recipient);

    // The varying step. No default, so nothing to depend on.
    protected abstract DeliveryOutcome Attempt(Recipient recipient, string body);

    // Non-virtual: retry policy and logging are identical for every channel.
    public DeliveryOutcome Deliver(Recipient recipient, string body)
    {
        for (int attempt = 1; attempt <= _maxAttempts; attempt++)
        {
            DeliveryOutcome outcome;
            try
            {
                outcome = Attempt(recipient, body);
            }
            catch (Exception ex)
            {
                outcome = new DeliveryOutcome(false, $"threw {ex.GetType().Name}");
            }

            _log.Record($"{_clock.UtcNow:HH:mm:ss} {Name} attempt {attempt}/{_maxAttempts} " +
                        $"-> {(outcome.Delivered ? "ok" : "failed")}: {outcome.Detail}");

            if (outcome.Delivered) return outcome;
        }
        return new DeliveryOutcome(false, $"gave up after {_maxAttempts} attempts");
    }
}

public sealed class EmailChannel : ChannelBase
{
    private int _calls;
    public EmailChannel(IClock clock, IDeliveryLog log) : base(clock, log) { }
    public override string Name => "email";
    public override bool CanHandle(Recipient r) => !string.IsNullOrWhiteSpace(r.Email);
    protected override DeliveryOutcome Attempt(Recipient r, string body)
    {
        _calls++;
        return _calls < 2
            ? new DeliveryOutcome(false, "smtp timeout")
            : new DeliveryOutcome(true, $"sent to {r.Email}");
    }
}

public sealed class SmsChannel : ChannelBase
{
    public SmsChannel(IClock clock, IDeliveryLog log) : base(clock, log) { }
    public override string Name => "sms";
    public override bool CanHandle(Recipient r) => !string.IsNullOrWhiteSpace(r.Phone);
    protected override DeliveryOutcome Attempt(Recipient r, string body)
        => throw new InvalidOperationException("gateway unreachable");
}

public sealed class PushChannel : ChannelBase
{
    public PushChannel(IClock clock, IDeliveryLog log) : base(clock, log) { }
    public override string Name => "push";
    public override bool CanHandle(Recipient r) => r.PushEnabled;
    protected override DeliveryOutcome Attempt(Recipient r, string body)
        => new DeliveryOutcome(true, $"pushed to device of {r.Id}");
}

public sealed class Notifier
{
    private readonly IReadOnlyList<IChannel> _channels;
    private readonly IDeliveryLog _log;

    public Notifier(IEnumerable<IChannel> channels, IDeliveryLog log)
        => (_channels, _log) = (channels.ToArray(), log);

    public DeliveryOutcome Notify(Recipient recipient, string body)
    {
        foreach (var channel in _channels.Where(c => c.CanHandle(recipient)))
        {
            var outcome = channel.Deliver(recipient, body);
            if (outcome.Delivered) return outcome;
            _log.Record($"  falling back from {channel.Name}");
        }
        return new DeliveryOutcome(false, "no channel could deliver");
    }
}

// ---- test doubles, which is why those interfaces exist --------------------
sealed class FixedClock : IClock
{
    public DateTimeOffset UtcNow { get; private set; } =
        new(2026, 8, 30, 9, 0, 0, TimeSpan.Zero);
    public void Advance(int seconds) => UtcNow = UtcNow.AddSeconds(seconds);
}

sealed class ListLog : IDeliveryLog
{
    public List<string> Lines { get; } = new();
    public void Record(string line) => Lines.Add(line);
}

class Program
{
    static void Main()
    {
        var clock = new FixedClock();
        var log = new ListLog();

        var notifier = new Notifier(
            new IChannel[]
            {
                new SmsChannel(clock, log),
                new EmailChannel(clock, log),
                new PushChannel(clock, log)
            },
            log);

        var recipient = new Recipient("U-1", "a@example.com", "+441234567890", PushEnabled: true);

        var result = notifier.Notify(recipient, "Your order has shipped");
        Console.WriteLine($"result: delivered={result.Delivered}, detail={result.Detail}");
        Console.WriteLine();
        Console.WriteLine("delivery log:");
        foreach (var line in log.Lines) Console.WriteLine($"  {line}");

        Console.WriteLine();
        var noContact = new Recipient("U-2", null, null, PushEnabled: false);
        var none = notifier.Notify(noContact, "Your order has shipped");
        Console.WriteLine($"recipient with no contact details: {none.Detail}");
    }
}
