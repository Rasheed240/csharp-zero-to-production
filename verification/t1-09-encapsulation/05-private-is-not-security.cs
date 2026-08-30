// 05-private-is-not-security.cs — access modifiers are a compile-time contract
// between programmers, not a runtime protection boundary.
// .NET 10.0.400. Run: dotnet run 05-private-is-not-security.cs

using System;
using System.Reflection;

class ApiClient
{
    private readonly string _apiKey;
    private int _requestsRemaining = 100;

    public ApiClient(string apiKey) => _apiKey = apiKey;

    public string Describe() =>
        $"key ending {_apiKey[^4..]}, {_requestsRemaining} requests left";

    public void Send()
    {
        if (_requestsRemaining <= 0) throw new InvalidOperationException("Quota exhausted.");
        _requestsRemaining--;
    }
}

class Program
{
    const BindingFlags Hidden = BindingFlags.NonPublic | BindingFlags.Instance;

    static void Main()
    {
        var client = new ApiClient("sk-live-000011112222");
        Console.WriteLine($"before: {client.Describe()}");

        // client._apiKey does not compile. This does.
        var keyField = typeof(ApiClient).GetField("_apiKey", Hidden)!;
        Console.WriteLine($"read through reflection: {keyField.GetValue(client)}");

        // readonly does not stop it either.
        keyField.SetValue(client, "sk-live-999988887777");
        Console.WriteLine($"after writing a readonly field: {client.Describe()}");

        // Neither does the quota.
        var quotaField = typeof(ApiClient).GetField("_requestsRemaining", Hidden)!;
        quotaField.SetValue(client, 0);
        try
        {
            client.Send();
        }
        catch (InvalidOperationException ex)
        {
            Console.WriteLine($"quota forced to 0 from outside: {ex.Message}");
        }

        quotaField.SetValue(client, int.MaxValue);
        Console.WriteLine($"and back up again: {client.Describe()}");

        Console.WriteLine();
        Console.WriteLine("Every private member, listed by anything that can load the type:");
        foreach (var f in typeof(ApiClient).GetFields(Hidden))
            Console.WriteLine($"  {f.FieldType.Name,-8} {f.Name}  (readonly: {f.IsInitOnly})");
    }
}
