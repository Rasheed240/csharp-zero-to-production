// 02-connection-limits.cs — What MaxConcurrentConnections actually does to the
// sixth client, and why the answer is "waits" rather than "is rejected".
//
// Run:  dotnet run 02-connection-limits.cs -c Release
//
// EXACT vs RATIO: connection counts and completion ORDER are exact. Elapsed
// milliseconds are machine-specific, but each round is a 300 ms endpoint, so
// the round structure is what the numbers show.

#:sdk Microsoft.NET.Sdk.Web

using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Connections;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

await TheDefault();
await WithALimit();
await WhatTheClientSees();
Choosing();

// ---------------------------------------------------------------------------
static async Task TheDefault()
{
    Console.WriteLine("1. The default");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.UseUrls("http://127.0.0.1:0");

    var app = builder.Build();
    var limits = app.Services
        .GetRequiredService<IOptions<KestrelServerOptions>>().Value.Limits;

    string connections = limits.MaxConcurrentConnections?.ToString() ?? "null (no limit)";
    string upgraded = limits.MaxConcurrentUpgradedConnections?.ToString() ?? "null (no limit)";

    Console.WriteLine($"   MaxConcurrentConnections          : {connections}");
    Console.WriteLine($"   MaxConcurrentUpgradedConnections  : {upgraded}");
    Console.WriteLine();
    Console.WriteLine("   Both default to NO LIMIT, and that is a deliberate choice by the");
    Console.WriteLine("   framework rather than an oversight. Kestrel is usually behind");
    Console.WriteLine("   something that limits connections already, and a wrong limit here");
    Console.WriteLine("   is worse than none: it makes a healthy server refuse work.");
    Console.WriteLine();
    Console.WriteLine("   'No limit' does not mean infinite. It means the ceiling is the");
    Console.WriteLine("   operating system's - file descriptors on Linux, ephemeral ports and");
    Console.WriteLine("   non-paged pool on Windows - and you find it by falling off it, at");
    Console.WriteLine("   which point accept() starts failing for everyone at once.");
    Console.WriteLine();
    Console.WriteLine("   UPGRADED connections are the second number: a connection that has");
    Console.WriteLine("   left HTTP behind, which in practice means a WebSocket. They are");
    Console.WriteLine("   counted separately because they are long-lived by design - one");
    Console.WriteLine("   WebSocket may hold a connection for hours, so a limit sized for");
    Console.WriteLine("   request/response traffic would be wrong for them.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static async Task WithALimit()
{
    Console.WriteLine("2. Five clients, a limit of two");
    Console.WriteLine();

    int accepted = 0;
    int concurrent = 0;
    int peakConcurrent = 0;

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();

    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Limits.MaxConcurrentConnections = 2;

        options.Listen(IPAddress.Loopback, 0, listen =>
        {
            listen.Use(async (ConnectionContext connection, Func<Task> next) =>
            {
                Interlocked.Increment(ref accepted);
                int now = Interlocked.Increment(ref concurrent);

                // Racy by construction, and good enough: it only ever
                // under-reports the peak, never over-reports it.
                if (now > Volatile.Read(ref peakConcurrent))
                {
                    Volatile.Write(ref peakConcurrent, now);
                }

                try
                {
                    await next();
                }
                finally
                {
                    Interlocked.Decrement(ref concurrent);
                }
            });
        });
    });

    var app = builder.Build();
    app.MapGet("/slow", async () => { await Task.Delay(300); return "done"; });

    await app.StartAsync();
    string baseUrl = app.Urls.First();

    // Five SEPARATE connections. Connection: close stops the client reusing
    // one socket for all five, which would make this measure nothing.
    var sw = Stopwatch.StartNew();
    var results = new System.Collections.Concurrent.ConcurrentQueue<(int Client, long At, string Outcome)>();

    await Task.WhenAll(Enumerable.Range(1, 5).Select(async i =>
    {
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(baseUrl) };
            using var request = new HttpRequestMessage(HttpMethod.Get, "/slow");
            request.Headers.ConnectionClose = true;

            using HttpResponseMessage response = await http.SendAsync(request);
            await response.Content.ReadAsStringAsync();
            results.Enqueue((i, sw.ElapsedMilliseconds, $"{(int)response.StatusCode} OK"));
        }
        catch (HttpRequestException ex)
        {
            string inner = ex.InnerException?.InnerException?.GetType().Name
                ?? ex.InnerException?.GetType().Name
                ?? ex.GetType().Name;
            results.Enqueue((i, sw.ElapsedMilliseconds, $"FAILED ({inner})"));
        }
    }));

    sw.Stop();

    Console.WriteLine("   client   finished at   outcome");
    Console.WriteLine("   ------   -----------   -------");
    foreach ((int client, long at, string outcome) in results.OrderBy(x => x.At))
    {
        Console.WriteLine($"   {client,6}   {at,8} ms   {outcome}");
    }

    int ok = results.Count(r => r.Outcome.EndsWith("OK", StringComparison.Ordinal));
    int failed = results.Count - ok;

    Console.WriteLine();
    Console.WriteLine($"   sockets seen by connection middleware : {accepted}");
    Console.WriteLine($"   peak concurrent connections           : {peakConcurrent}");
    Console.WriteLine($"   succeeded                             : {ok}");
    Console.WriteLine($"   failed                                : {failed}");
    Console.WriteLine($"   total elapsed                         : {sw.ElapsedMilliseconds} ms");
    Console.WriteLine();
    Console.WriteLine("   THE EXCESS CONNECTIONS WERE CLOSED, NOT QUEUED. That is the");
    Console.WriteLine("   behaviour worth knowing, because the name suggests otherwise and");
    Console.WriteLine("   because the first draft of this file predicted queueing.");
    Console.WriteLine();
    Console.WriteLine("   Kestrel counts open connections, and when the count is at the");
    Console.WriteLine("   limit it CLOSES the next one straight after accepting it, before");
    Console.WriteLine("   reading a byte. There is no request, so there is no status code to");
    Console.WriteLine("   return - the client sees its connection dropped.");
    Console.WriteLine();
    Console.WriteLine("   Notice the first counter: the connection middleware registered on");
    Console.WriteLine("   the endpoint saw only TWO sockets, not five. THE LIMIT IS APPLIED");
    Console.WriteLine("   BEFORE YOUR CONNECTION MIDDLEWARE RUNS, so you cannot observe or");
    Console.WriteLine("   override a rejection from there - by the time your code could look,");
    Console.WriteLine("   the decision has been made and the socket is closing.");
    Console.WriteLine();
    Console.WriteLine("   Read the client column: the failures came back IMMEDIATELY, not");
    Console.WriteLine("   after a wait. A rejected client is not delayed, it is refused, and");
    Console.WriteLine("   a retry a moment later may well succeed.");
    Console.WriteLine();
    Console.WriteLine("   Two consequences follow, and both are unpleasant.");
    Console.WriteLine();
    Console.WriteLine("   FIRST, THIS IS INVISIBLE IN YOUR REQUEST METRICS. No request was");
    Console.WriteLine("   ever parsed, so nothing incremented a request counter, nothing hit");
    Console.WriteLine("   your middleware, and nothing appears in your access log. Your");
    Console.WriteLine("   dashboard shows a healthy service dropping traffic.");
    Console.WriteLine();
    Console.WriteLine("   It is not entirely invisible: Kestrel logs a warning per rejection");
    Console.WriteLine("   under the Microsoft.AspNetCore.Server.Kestrel category, and");
    Console.WriteLine("   publishes kestrel.rejected_connections. Both are off the path");
    Console.WriteLine("   anyone looks at first.");
    Console.WriteLine();
    Console.WriteLine("   SECOND, THE CLIENT CANNOT TELL THIS FROM A CRASH. A dropped");
    Console.WriteLine("   connection is what it sees when the process dies, when a network");
    Console.WriteLine("   path breaks, and when you deliberately shed load. Whether it retries");
    Console.WriteLine("   - and whether retrying is safe - depends on its own policy and the");
    Console.WriteLine("   method it was using, not on anything you can tell it here.");
    Console.WriteLine();
    Console.WriteLine("   If you want load shedding that a client can reason about, do it in");
    Console.WriteLine("   middleware with 503 and Retry-After. That costs you a parsed");
    Console.WriteLine("   request, which is the whole trade: this limit is cheap because it");
    Console.WriteLine("   acts before any parsing, and uninformative for the same reason.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static async Task WhatTheClientSees()
{
    Console.WriteLine("3. The other place connections are dropped");
    Console.WriteLine();
    Console.WriteLine("   Kestrel's limit is one of two mechanisms, and they behave");
    Console.WriteLine("   differently enough to be worth separating:");
    Console.WriteLine();
    Console.WriteLine("     KESTREL'S LIMIT       counts open connections. At the limit it");
    Console.WriteLine("                           accepts the next one and closes it straight");
    Console.WriteLine("                           away. Measured above: immediate failure.");
    Console.WriteLine();
    Console.WriteLine("     THE OS ACCEPT QUEUE   fixed size, set by the listen backlog. Holds");
    Console.WriteLine("                           established connections Kestrel has not");
    Console.WriteLine("                           accepted YET. It fills when Kestrel is too");
    Console.WriteLine("                           busy to keep up, not because of any limit");
    Console.WriteLine("                           you configured. When it is full the OS");
    Console.WriteLine("                           refuses or drops new connections itself.");
    Console.WriteLine();
    Console.WriteLine("   The second one is the one to suspect when nothing is configured and");
    Console.WriteLine("   connections are still failing under load: a thread-pool starvation");
    Console.WriteLine("   or a blocked accept loop stops Kestrel draining the queue, and the");
    Console.WriteLine("   OS starts refusing on its behalf.");
    Console.WriteLine();
    Console.WriteLine("   The two look identical to a client. Both are a failed connect with");
    Console.WriteLine("   no status code.");
    Console.WriteLine();

    // Demonstrate the refusal end of that, by pointing at a port nobody holds.
    int deadPort;
    {
        var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        deadPort = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
    }

    string refused;
    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        await http.GetAsync($"http://127.0.0.1:{deadPort}/");
        refused = "unexpectedly succeeded";
    }
    catch (HttpRequestException ex)
    {
        refused = ex.Message;
    }
    catch (TaskCanceledException)
    {
        // On some platforms a connect to a closed port is dropped rather than
        // refused, so the client waits until its own timeout instead.
        refused = "the connect attempt timed out rather than being refused";
    }

    Console.WriteLine("   For contrast, this is what a client sees when there is nothing");
    Console.WriteLine("   listening at all - note that even THIS varies by platform, refused");
    Console.WriteLine("   on some and silently dropped on others:");
    Console.WriteLine();
    Console.WriteLine($"     {refused}");
    Console.WriteLine();
    Console.WriteLine("   A client cannot tell that apart from 'the server is overloaded and");
    Console.WriteLine("   its backlog filled'. Both are a failed connect. Neither produces a");
    Console.WriteLine("   status code, so neither appears in your application logs.");
    Console.WriteLine();
}

// ---------------------------------------------------------------------------
static void Choosing()
{
    Console.WriteLine("4. Whether to set it at all");
    Console.WriteLine();
    Console.WriteLine("   The honest default is DO NOT SET IT, and this is one of the few");
    Console.WriteLine("   Kestrel settings where that is the right answer for most services.");
    Console.WriteLine();
    Console.WriteLine("   Set it when you have a specific reason:");
    Console.WriteLine();
    Console.WriteLine("     - Each connection holds an expensive per-connection resource -");
    Console.WriteLine("       a database connection, a large buffer, a device handle - and");
    Console.WriteLine("       you want to bound that rather than the request rate.");
    Console.WriteLine();
    Console.WriteLine("     - You are directly exposed to the internet with no proxy in");
    Console.WriteLine("       front, and want a ceiling below the point where the process");
    Console.WriteLine("       runs out of memory or descriptors.");
    Console.WriteLine();
    Console.WriteLine("     - You are deliberately shedding load and have accepted that");
    Console.WriteLine("       rejected clients get a dropped connection rather than an");
    Console.WriteLine("       explanation.");
    Console.WriteLine();
    Console.WriteLine("   And be clear about what it does NOT do:");
    Console.WriteLine();
    Console.WriteLine("     - It is not a rate limit. One connection can send thousands of");
    Console.WriteLine("       requests. Use the rate limiting middleware for request rates.");
    Console.WriteLine();
    Console.WriteLine("     - It is not concurrency control for your handlers. Ten thousand");
    Console.WriteLine("       requests on one HTTP/2 connection are one connection.");
    Console.WriteLine();
    Console.WriteLine("     - It does not protect against slow clients holding connections");
    Console.WriteLine("       open. That is what the timeouts and minimum data rates in");
    Console.WriteLine("       04-timeouts.cs are for, and they are the ones that actually");
    Console.WriteLine("       defend against an attack.");
    Console.WriteLine();
    Console.WriteLine("   The relationship to remember:");
    Console.WriteLine();
    Console.WriteLine("     connections   bounded by MaxConcurrentConnections and the OS");
    Console.WriteLine("     requests      bounded by rate limiting middleware");
    Console.WriteLine("     work          bounded by the thread pool and your own semaphores");
    Console.WriteLine();
    Console.WriteLine("   Three different limits on three different things, and confusing");
    Console.WriteLine("   them is how a service ends up with a connection limit that does");
    Console.WriteLine("   nothing while it falls over on request volume.");
}
