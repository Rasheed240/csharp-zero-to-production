// 05-tls.cs — HTTPS in Kestrel, with a certificate generated in this process so
// the file needs no network, no certificate store and no openssl.
//
// Run:  dotnet run 05-tls.cs -c Release
//
// EXACT vs RATIO: the negotiated protocol, cipher and HTTP version are exact.

#:sdk Microsoft.NET.Sdk.Web
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:property PublishAot=false

using System.Net;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Connections.Features;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.Server.Kestrel.Https;

using X509Certificate2 certificate = CreateSelfSigned("localhost");

Console.WriteLine("0. The certificate this file uses");
Console.WriteLine();
Console.WriteLine($"   subject     : {certificate.Subject}");
Console.WriteLine($"   issuer      : {certificate.Issuer}");
Console.WriteLine($"   valid from  : {certificate.NotBefore:yyyy-MM-dd}");
Console.WriteLine($"   valid until : {certificate.NotAfter:yyyy-MM-dd}");
Console.WriteLine($"   thumbprint  : {certificate.Thumbprint}");
Console.WriteLine($"   has private key : {certificate.HasPrivateKey}");
Console.WriteLine();
Console.WriteLine("   Subject and issuer are the same, which is what SELF-SIGNED means: it");
Console.WriteLine("   vouches for itself. No client will trust it without being told to,");
Console.WriteLine("   which is section 3.");
Console.WriteLine();

await Handshake(certificate);
await Alpn(certificate);
await Trust(certificate);
Deployment();

// ---------------------------------------------------------------------------
static async Task Handshake(X509Certificate2 certificate)
{
    Console.WriteLine("1. What the handshake produced");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Listen(IPAddress.Loopback, 0, listen =>
        {
            listen.UseHttps(certificate);
        });
    });

    var app = builder.Build();

    app.MapGet("/", (HttpContext context) =>
    {
        // The handshake result is exposed as a connection feature, because it
        // is a property of the connection rather than of any one request.
        var tls = context.Features.Get<ITlsHandshakeFeature>();

        return string.Join("\n",
            $"scheme          : {context.Request.Scheme}",
            $"IsHttps         : {context.Request.IsHttps}",
            $"protocol        : {tls?.Protocol.ToString() ?? "(no TLS feature)"}",
            $"cipher suite    : {tls?.NegotiatedCipherSuite}",
            $"HTTP version    : {context.Request.Protocol}");
    });

    await app.StartAsync();

    using var http = new HttpClient(Trusting(certificate))
    {
        BaseAddress = new Uri(app.Urls.First())
    };

    foreach (string line in (await http.GetStringAsync("/")).Split('\n'))
    {
        Console.WriteLine($"   {line}");
    }

    Console.WriteLine();
    Console.WriteLine("   IsHttps is true, and it is true because of the CONNECTION, not");
    Console.WriteLine("   because of anything in the request text. A request arriving on a");
    Console.WriteLine("   plain HTTP connection cannot make itself look secure by adding a");
    Console.WriteLine("   header - which matters in section 4, where something in front of");
    Console.WriteLine("   you terminates TLS and your connection is plain again.");
    Console.WriteLine();
    Console.WriteLine("   Nothing above was configured. Kestrel picked the protocol version");
    Console.WriteLine("   and the cipher suite by negotiating with the client, and the sane");
    Console.WriteLine("   default is to leave that alone: the operating system's policy is");
    Console.WriteLine("   maintained by people whose job it is, and pinning a cipher list in");
    Console.WriteLine("   your application code freezes it at the day you wrote it.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static async Task Alpn(X509Certificate2 certificate)
{
    Console.WriteLine("2. How the HTTP version is chosen");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        // Offering both versions. The client picks during the handshake.
        options.Listen(IPAddress.Loopback, 0, listen =>
        {
            listen.Protocols = HttpProtocols.Http1AndHttp2;
            listen.UseHttps(certificate);
        });
    });

    var app = builder.Build();
    app.MapGet("/", (HttpContext context) => context.Request.Protocol);

    await app.StartAsync();
    var baseAddress = new Uri(app.Urls.First());

    Console.WriteLine("   client asks for     negotiated");
    Console.WriteLine("   ---------------     ----------");

    foreach ((string label, Version version, HttpVersionPolicy policy) in new[]
    {
        ("HTTP/1.1 exactly", HttpVersion.Version11, HttpVersionPolicy.RequestVersionExact),
        ("HTTP/2 exactly", HttpVersion.Version20, HttpVersionPolicy.RequestVersionExact),
        ("HTTP/2 or lower", HttpVersion.Version20, HttpVersionPolicy.RequestVersionOrLower)
    })
    {
        using var http = new HttpClient(Trusting(certificate))
        {
            BaseAddress = baseAddress,
            DefaultRequestVersion = version,
            DefaultVersionPolicy = policy
        };

        Console.WriteLine($"   {label,-17}   {await http.GetStringAsync("/")}");
    }

    Console.WriteLine();
    Console.WriteLine("   ALPN - Application-Layer Protocol Negotiation - is an extension to");
    Console.WriteLine("   the TLS handshake. The client sends the list of protocols it");
    Console.WriteLine("   speaks, the server picks one, and it is settled before the first");
    Console.WriteLine("   HTTP byte is sent.");
    Console.WriteLine();
    Console.WriteLine("   This is why HTTP/2 in practice means HTTPS. Over plain HTTP there is");
    Console.WriteLine("   no handshake to negotiate in, so both ends must be told in advance -");
    Console.WriteLine("   'prior knowledge' - which works between services you control and not");
    Console.WriteLine("   on the open internet.");
    Console.WriteLine();
    Console.WriteLine("   The practical consequence: an endpoint set to Http2 ONLY, without");
    Console.WriteLine("   TLS, is reachable only by clients configured for prior knowledge.");
    Console.WriteLine("   A browser will not reach it, and neither will a health checker");
    Console.WriteLine("   speaking HTTP/1.1 - which is the usual way a gRPC service ends up");
    Console.WriteLine("   marked unhealthy while working perfectly.");
    Console.WriteLine();

    await app.StopAsync();
}

// ---------------------------------------------------------------------------
static async Task Trust(X509Certificate2 certificate)
{
    Console.WriteLine("3. What a client does with a certificate it does not trust");
    Console.WriteLine();

    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.ConfigureKestrel(options =>
    {
        options.Listen(IPAddress.Loopback, 0, listen => listen.UseHttps(certificate));
    });

    var app = builder.Build();
    app.MapGet("/", () => "ok");
    await app.StartAsync();
    var baseAddress = new Uri(app.Urls.First());

    // A default client, validating normally.
    string strict;
    try
    {
        using var http = new HttpClient { BaseAddress = baseAddress };
        strict = await http.GetStringAsync("/");
    }
    catch (HttpRequestException ex)
    {
        strict = $"{ex.GetType().Name}: {Innermost(ex).Message}";
    }

    // The same request, accepting anything.
    using var trusting = new HttpClient(Trusting(certificate)) { BaseAddress = baseAddress };
    string relaxed = await trusting.GetStringAsync("/");

    Console.WriteLine($"   validating client : {strict}");
    Console.WriteLine($"   trusting client   : {relaxed}");
    Console.WriteLine();
    Console.WriteLine("   The failure is on the CLIENT, not the server. Kestrel served the");
    Console.WriteLine("   certificate it was given; the client refused it because nothing in");
    Console.WriteLine("   its trust store vouches for it.");
    Console.WriteLine();
    Console.WriteLine("   That is worth being clear about, because 'the certificate is");
    Console.WriteLine("   invalid' reads like a server problem and is almost always a");
    Console.WriteLine("   question about what the client trusts. In development, the answer");
    Console.WriteLine("   is the .NET development certificate:");
    Console.WriteLine();
    Console.WriteLine("     dotnet dev-certs https --trust");
    Console.WriteLine();
    Console.WriteLine("   which generates a localhost certificate and adds it to the machine's");
    Console.WriteLine("   trust store, so browsers and HttpClient accept it without any code.");
    Console.WriteLine();
    Console.WriteLine("   THE CALLBACK USED IN THIS FILE IS THE DANGEROUS ONE:");
    Console.WriteLine();
    Console.WriteLine("     handler.ServerCertificateCustomValidationCallback =");
    Console.WriteLine("         (message, cert, chain, errors) => true;");
    Console.WriteLine();
    Console.WriteLine("   That accepts ANY certificate from ANY server, which removes the");
    Console.WriteLine("   entire point of TLS: encryption without authentication means you");
    Console.WriteLine("   have a private conversation with someone who may not be who you");
    Console.WriteLine("   think. It is a machine-in-the-middle attack with the door held open.");
    Console.WriteLine();
    Console.WriteLine("   It is used here because this file must run offline against a");
    Console.WriteLine("   certificate created seconds earlier, and it compares the thumbprint");
    Console.WriteLine("   rather than returning a bare true. If you find that line in a");
    Console.WriteLine("   service, it was almost certainly added to make a test pass and never");
    Console.WriteLine("   removed.");
    Console.WriteLine();

    await app.StopAsync();

    static Exception Innermost(Exception ex) =>
        ex.InnerException is null ? ex : Innermost(ex.InnerException);
}

// ---------------------------------------------------------------------------
static void Deployment()
{
    Console.WriteLine("4. Where TLS actually terminates");
    Console.WriteLine();
    Console.WriteLine("   Kestrel can do TLS, and in most deployments it does not.");
    Console.WriteLine();
    Console.WriteLine("   EDGE TERMINATION - the common one");
    Console.WriteLine();
    Console.WriteLine("     client --TLS--> load balancer / ingress --plain--> Kestrel");
    Console.WriteLine();
    Console.WriteLine("     The proxy holds the certificate, handles renewal, and speaks plain");
    Console.WriteLine("     HTTP to you over a private network. Your process never sees a");
    Console.WriteLine("     certificate and never restarts to renew one.");
    Console.WriteLine();
    Console.WriteLine("   END-TO-END - regulated or zero-trust environments");
    Console.WriteLine();
    Console.WriteLine("     client --TLS--> proxy --TLS--> Kestrel");
    Console.WriteLine();
    Console.WriteLine("     Encrypted on every hop, at the cost of a certificate per service");
    Console.WriteLine("     and a renewal story for each. Usually a service mesh does this");
    Console.WriteLine("     rather than each application configuring it.");
    Console.WriteLine();
    Console.WriteLine("   DIRECT - Kestrel exposed to the internet");
    Console.WriteLine();
    Console.WriteLine("     Supported and uncommon. You take on certificate renewal, and you");
    Console.WriteLine("     have nothing in front to absorb volume - see the honest limit at");
    Console.WriteLine("     the end of 04-timeouts.cs.");
    Console.WriteLine();
    Console.WriteLine("   THE CONSEQUENCE OF EDGE TERMINATION IS THE POINT OF THE NEXT FILE.");
    Console.WriteLine("   If TLS ended at the proxy, then on your connection:");
    Console.WriteLine();
    Console.WriteLine("     Request.IsHttps            is FALSE");
    Console.WriteLine("     Request.Scheme             is 'http'");
    Console.WriteLine("     Connection.RemoteIpAddress is the PROXY'S address");
    Console.WriteLine();
    Console.WriteLine("   All three are correct statements about your connection and all three");
    Console.WriteLine("   are the wrong answer about the client. Redirect-to-HTTPS logic");
    Console.WriteLine("   loops forever, generated absolute URLs come out as http://, and");
    Console.WriteLine("   every request in your logs comes from the same address.");
    Console.WriteLine();
    Console.WriteLine("   That is 06-reverse-proxy.cs.");
}

// ---------------------------------------------------------------------------
// A self-signed certificate, created here so this file needs no network, no
// certificate store and no openssl.
static X509Certificate2 CreateSelfSigned(string commonName)
{
    using RSA key = RSA.Create(2048);

    var request = new CertificateRequest(
        $"CN={commonName}",
        key,
        HashAlgorithmName.SHA256,
        RSASignaturePadding.Pkcs1);

    request.CertificateExtensions.Add(
        new X509BasicConstraintsExtension(certificateAuthority: false, false, 0, critical: true));

    request.CertificateExtensions.Add(
        new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment,
            critical: true));

    // Without a server-authentication EKU, a TLS client rejects the
    // certificate even when it otherwise trusts it.
    request.CertificateExtensions.Add(
        new X509EnhancedKeyUsageExtension(
            new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") },
            critical: false));

    // Modern clients validate the name against the SAN extension, not the
    // subject. A certificate with only a CN is rejected outright.
    var sanBuilder = new SubjectAlternativeNameBuilder();
    sanBuilder.AddDnsName(commonName);
    sanBuilder.AddIpAddress(IPAddress.Loopback);
    request.CertificateExtensions.Add(sanBuilder.Build());

    using X509Certificate2 created = request.CreateSelfSigned(
        DateTimeOffset.UtcNow.AddDays(-1),
        DateTimeOffset.UtcNow.AddDays(30));

    // Export and re-import. On Windows the in-memory key from CreateSelfSigned
    // cannot be used by SslStream directly; a round trip through PKCS#12
    // produces a key it will accept.
    byte[] pfx = created.Export(X509ContentType.Pfx);
    return X509CertificateLoader.LoadPkcs12(pfx, password: null,
        X509KeyStorageFlags.Exportable);
}

// A handler that trusts exactly the certificate above, by thumbprint. Returning
// a bare true here would accept any certificate from any server.
static HttpClientHandler Trusting(X509Certificate2 expected)
{
    return new HttpClientHandler
    {
        ServerCertificateCustomValidationCallback = (message, cert, chain, errors) =>
            cert is not null && cert.Thumbprint == expected.Thumbprint
    };
}
