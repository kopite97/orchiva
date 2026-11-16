namespace Orchiva.Bridge.Tests;

[TestClass]
public sealed class ToolReadinessTests
{
    [TestMethod]
    public async Task DistinguishesMissingLoginRequiredAndUnknownWithoutRawOutput()
    {
        var calls = new List<string>();
        Task<ProbeResult> Probe(string exe, string[] args, CancellationToken _)
        {
            calls.Add(string.Join(" ", args));
            return Task.FromResult(exe == "where.exe" ? args[0] == "git" ? new ProbeResult(1, "") : new(0, "C:\\tools\\codex.cmd\nC:\\tools\\codex.exe") :
                args[0] == "--version" ? new(0, "codex version") : new(1, "Not logged in"));
        }
        var checks = await ToolReadiness.CheckAsync(Probe, default);
        Assert.AreEqual("missing", checks.Single(x => x.Tool == "git").State);
        Assert.AreEqual("login-required", checks.Single(x => x.Tool == "codex-auth").State);
        Assert.DoesNotContain("login", calls);
        var unknown = await ToolReadiness.CheckAsync((exe, args, token) => Task.FromResult(exe == "where.exe" ? new ProbeResult(0, "C:\\tools\\tool.exe") : args[0] == "--version" ? new(0, "v1") : new(2, "sensitive-debug-value")), default);
        Assert.AreEqual("unknown", unknown.Single(x => x.Tool == "codex-auth").State);
        Assert.IsFalse(unknown.Any(x => x.Message.Contains("sensitive-debug-value")));
    }

    [TestMethod]
    public async Task ExistingLocalToolsCanBeInspectedWithoutLoginMutation()
    {
        if (Environment.GetEnvironmentVariable("ORCHIVA_D6_DIAGNOSTICS") != "1") { Assert.Inconclusive("Read-only local probe not selected"); return; }
        var checks = await ToolReadiness.CheckAsync();
        Assert.AreEqual("ready", checks.Single(x => x.Tool == "git").State);
        Assert.AreEqual("ready", checks.Single(x => x.Tool == "codex").State);
        Assert.AreEqual("ready", checks.Single(x => x.Tool == "codex-auth").State);
    }
}
