using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Orchiva.Bridge.Tests;

[TestClass]
public sealed class ProtocolTests
{
    [TestMethod]
    public async Task DesktopCapabilitiesAndDomainErrorsCrossTheRealBridge()
    {
        var path = Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG");
        if (string.IsNullOrEmpty(path)) { Assert.Inconclusive("No isolated live fixture configured"); return; }
        var options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        await using var client = new BridgeClient(options);
        var info = await client.HandshakeAsync();
        Assert.IsTrue(info.GetProperty("capabilities").EnumerateArray().Any(x => x.GetString() == "desktop.requests.start"));
        Assert.AreEqual(JsonValueKind.Array, (await client.CallAsync("desktop.projects.list", new { })).ValueKind);
        var error = await Assert.ThrowsExactlyAsync<IOException>(() => client.CallAsync("desktop.requests.get", new { projectId = Guid.NewGuid().ToString(), token = "unknown-request-01" }));
        Assert.AreEqual("PROJECT_NOT_REGISTERED", error.Message);
    }
    private static BridgeClient Fake(string behavior)
    {
        var node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        var start = new ProcessStartInfo(node) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardInputEncoding = new UTF8Encoding(false) };
        start.ArgumentList.Add("--input-type=module"); start.ArgumentList.Add("-e");
        start.ArgumentList.Add("import readline from 'node:readline'; const rl=readline.createInterface({input:process.stdin}); rl.on('line',line=>{const r=JSON.parse(line);" + behavior + "}); rl.on('close',()=>process.exit(0));");
        return new BridgeClient(start);
    }
    [TestMethod]
    public async Task SharedHandshakeFixtureMatchesCSharpClient()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "desktop-wire-v1.json")));
        var result = fixture.RootElement.GetProperty("response").GetProperty("result");
        await using var client = Fake("if(r.protocolVersion!==1||r.method!=='handshake'||Object.keys(r.params).length!==0)throw new Error('WIRE_MISMATCH');process.stdout.write(JSON.stringify({protocolVersion:1,id:r.id,result:" + result.GetRawText() + "})+'\\n');");
        var actual = await client.HandshakeAsync();
        Assert.AreEqual(result.GetProperty("dataHome").GetString(), actual.GetProperty("dataHome").GetString());
        Assert.AreEqual("연결됨", client.ConnectionState);
    }
    [TestMethod]
    public async Task CorrelatesOutOfOrderUnicodeRepliesAndDrainsErrors()
    {
        await using var client = Fake("process.stderr.write('x'.repeat(5000));setTimeout(()=>process.stdout.write(JSON.stringify({protocolVersion:1,id:r.id,result:{name:r.params.name}})+'\\n'),r.params.delay);");
        var first = client.CallAsync("test", new { name = "먼저 요청", delay = 100 });
        var second = client.CallAsync("test", new { name = "나중 요청", delay = 0 });
        Assert.AreEqual("나중 요청", (await second).GetProperty("name").GetString());
        Assert.AreEqual("먼저 요청", (await first).GetProperty("name").GetString());
    }
    [TestMethod]
    public async Task StdoutContaminationRejectsPendingReads()
    {
        await using var client = Fake("process.stdout.write('unexpected log\\n');");
        await Assert.ThrowsExactlyAsync<IOException>(() => client.CallAsync("test", new { }));
        Assert.AreEqual("연결 끊김", client.ConnectionState);
    }
    [TestMethod]
    public async Task MissingResultFailsWithoutLosingPendingRequest()
    {
        await using var client = Fake("process.stdout.write(JSON.stringify({protocolVersion:1,id:r.id})+'\\n');");
        await Assert.ThrowsExactlyAsync<IOException>(() => client.CallAsync("test", new { }).WaitAsync(TimeSpan.FromSeconds(3)));
    }
    [TestMethod]
    public async Task OversizedResponseAndRepeatedDisposeAreSafe()
    {
        var client = Fake("process.stdout.write('x'.repeat(1048577));");
        await Assert.ThrowsExactlyAsync<IOException>(() => client.CallAsync("test", new { }));
        await client.DisposeAsync(); await client.DisposeAsync();
        await Assert.ThrowsExactlyAsync<ObjectDisposedException>(() => client.CallAsync("test", new { }));
    }
    [TestMethod]
    public async Task CancellationDoesNotReuseCorrelationId()
    {
        await using var client = Fake("setTimeout(()=>process.stdout.write(JSON.stringify({protocolVersion:1,id:r.id,result:r.params})+'\\n'),60);");
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(() => client.CallAsync("test", new { name = "cancelled" }, cancelled.Token));
        Assert.AreEqual("new", (await client.CallAsync("test", new { name = "new" })).GetProperty("name").GetString());
    }
    [TestMethod]
    public async Task TimeoutDoesNotPoisonNextRequest()
    {
        await using var client = Fake("if(r.params.reply)process.stdout.write(JSON.stringify({protocolVersion:1,id:r.id,result:r.params})+'\\n');");
        await Assert.ThrowsAsync<OperationCanceledException>(() => client.CallAsync("test", new { reply = false }));
        Assert.IsTrue((await client.CallAsync("test", new { reply = true })).GetProperty("reply").GetBoolean());
    }
    [TestMethod]
    public async Task MissingNodeAndInvalidExecutableHaveSpecificFailures()
    {
        var missing = new LaunchOptions(Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".exe"), "", "", "", "", "");
        Assert.ThrowsExactly<ArgumentException>(() => new BridgeClient(missing));
        var file = Path.Combine(Path.GetTempPath(), "orchiva-invalid-" + Guid.NewGuid() + ".exe");
        try
        {
            await File.WriteAllTextAsync(file, "This is not an executable.");
            var start = new ProcessStartInfo(file) { UseShellExecute = false, CreateNoWindow = true };
            Assert.ThrowsExactly<System.ComponentModel.Win32Exception>(() => new BridgeClient(start));
        }
        finally { File.Delete(file); }
    }
    [TestMethod]
    public async Task RealLauncherIsIdempotentAndThreeBridgeLifetimesPreserveResults()
    {
        var path = Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG");
        if (string.IsNullOrEmpty(path)) { Assert.Inconclusive("No isolated live fixture configured"); return; }
        var options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        int? serverPid = null;
        for (var round = 0; round < 3; round++)
        {
            await RuntimeLauncher.StartAsync(options);
            var client = new BridgeClient(options);
            var pid = client.ProcessId;
            try
            {
                var info = await client.HandshakeAsync();
                var currentPid = info.GetProperty("pid").GetInt32();
                if (serverPid.HasValue) Assert.AreEqual(serverPid.Value, currentPid);
                serverPid = currentPid;
                var detail = await client.CallAsync("request.detail", new { token = "d1-fixture-003" });
                var record = detail.GetProperty("record");
                Assert.AreEqual("synthetic-result-001", record.GetProperty("results")[0].GetProperty("id").GetString());
                Assert.IsTrue(record.GetProperty("decisions")[0].GetProperty("approved").GetBoolean());
            }
            finally { await client.DisposeAsync(); await client.DisposeAsync(); }
            Assert.ThrowsExactly<ArgumentException>(() => Process.GetProcessById(pid));
        }
    }
    [TestMethod]
    public async Task WrongCredentialHomeIsRejectedWithoutChangingHealthyConnection()
    {
        var path = Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG");
        if (string.IsNullOrEmpty(path)) { Assert.Inconclusive("No isolated live fixture configured"); return; }
        var options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        var wrongHome = Path.Combine(options.IsolationRoot, "wrong-credential-" + Guid.NewGuid());
        Directory.CreateDirectory(wrongHome);
        // Synthetic value in a different home; never overwrite a real credential.
        await File.WriteAllTextAsync(Path.Combine(wrongHome, "local-credential"), "synthetic-invalid-credential");
        await using (var client = new BridgeClient(options with { PaseoHome = wrongHome }))
        {
            var error = await Assert.ThrowsExactlyAsync<IOException>(() => client.HandshakeAsync());
            // This Paseo version trusts loopback; home identity is still mandatory.
            Assert.Contains(error.Message, new[] { "CONNECTION_FAILED", "ENVIRONMENT_MISMATCH" });
            Assert.DoesNotContain("synthetic-invalid-credential", error.ToString());
            var denied = await Assert.ThrowsExactlyAsync<IOException>(() => client.CallAsync("project.read", new { }));
            Assert.AreEqual("HANDSHAKE_REQUIRED", denied.Message);
        }
        await using var healthy = new BridgeClient(options);
        await healthy.HandshakeAsync();
    }
    [TestMethod]
    public async Task FailedAndCancelledLaunchCleanOnlyOwnedChildren()
    {
        var path = Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG");
        if (string.IsNullOrEmpty(path)) { Assert.Inconclusive("No isolated live fixture configured"); return; }
        var options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        var root = Path.Combine(options.IsolationRoot, "failed-launch-" + Guid.NewGuid());
        var data = Path.Combine(root, "data"); var paseo = Path.Combine(root, "paseo");
        Directory.CreateDirectory(data); Directory.CreateDirectory(paseo);
        var probe = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        probe.Start(); var port = ((System.Net.IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
        var endpoint = "127.0.0.1:" + port;
        await File.WriteAllTextAsync(Path.Combine(paseo, "config.json"), JsonSerializer.Serialize(new { daemon = new { listen = endpoint } }));
        var cli = Path.Combine(root, "fake-cli.cjs"); var pidFile = Path.Combine(root, "child.pid");
        var isolated = options with { DataHome = data, PaseoHome = paseo, IsolationRoot = root, Endpoint = endpoint, PaseoCliPath = cli };
        await File.WriteAllTextAsync(cli, "process.exit(23)");
        await Assert.ThrowsExactlyAsync<IOException>(() => RuntimeLauncher.StartAsync(isolated));
        await File.WriteAllTextAsync(cli, "require('fs').writeFileSync(" + JsonSerializer.Serialize(pidFile) + ",String(process.pid));setInterval(()=>{},1000);");
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var starting = RuntimeLauncher.StartAsync(isolated, cancellation.Token);
        try
        {
            while (!File.Exists(pidFile)) { cancellation.Token.ThrowIfCancellationRequested(); await Task.Delay(50); }
            var pid = int.Parse(await File.ReadAllTextAsync(pidFile));
            cancellation.Cancel();
            await Assert.ThrowsAsync<OperationCanceledException>(() => starting);
            Assert.ThrowsExactly<ArgumentException>(() => Process.GetProcessById(pid));
        }
        finally { cancellation.Cancel(); try { await starting; } catch (OperationCanceledException) { } }
        await using var healthy = new BridgeClient(options);
        await healthy.HandshakeAsync();
    }
    [TestMethod]
    public async Task RealBridgeReadOnlyWhenIsolatedFixtureProvided()
    {
        var path = Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG");
        if (string.IsNullOrEmpty(path)) { Assert.Inconclusive("No isolated live fixture configured"); return; }
        var options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        await using var client = new BridgeClient(options);
        var handshake = await client.HandshakeAsync();
        Assert.IsTrue(handshake.GetProperty("isolated").GetBoolean());
        var list = await client.CallAsync("request.page", new { filter = "all", limit = 20 });
        Assert.AreEqual(3, list.GetProperty("total").GetInt32());
        await Assert.ThrowsExactlyAsync<IOException>(() => client.CallAsync("request.start", new { }));
    }
}
