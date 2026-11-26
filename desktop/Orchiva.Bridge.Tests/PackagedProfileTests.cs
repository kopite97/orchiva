using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Orchiva.Bridge.Tests;

[TestClass]
public sealed class PackagedProfileTests
{
    [TestMethod]
    public void ApplicationLeaseExcludesSecondOwnerAndReleasesOnDispose()
    {
        var root = Path.Combine(Path.GetTempPath(), "orchiva-lease-" + Guid.NewGuid().ToString("N"));
        using (ProfileUseLease.Acquire(root)) Assert.ThrowsExactly<IOException>(() => ProfileUseLease.Acquire(root));
        using var reopened = ProfileUseLease.Acquire(root);
    }
    private static string Fixture()
    {
        var directory = Path.Combine(Path.GetTempPath(), "orchiva-profile-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(directory, "runtime", "plugin", "bridge"));
        Directory.CreateDirectory(Path.Combine(directory, "runtime", "paseo", "node_modules", "@getpaseo", "cli", "bin"));
        File.WriteAllText(Path.Combine(directory, "orchiva-package.json"), "{\"schemaVersion\":1,\"profileVersion\":1,\"platform\":\"win-x64\"}");
        foreach (var path in new[] { "runtime/node.exe", "runtime/plugin/bridge/index.ts", "runtime/paseo/node_modules/@getpaseo/cli/bin/paseo" }) File.WriteAllText(Path.Combine(directory, path), "fixture");
        return directory;
    }

    [TestMethod]
    public void ReusesProfileAndRejectsNewInstallFutureDataAndPartialStateWithoutRewriting()
    {
        var directory = Fixture(); var other = Fixture();
        try
        {
            var home = Path.Combine(directory, "한글 데이터");
            var first = PackagedProfile.Open(directory, home);
            var path = Path.Combine(home, "profile.json"); var original = File.ReadAllText(path);
            File.WriteAllText(Path.Combine(first.DataHome, "preserved.txt"), "keep");
            Assert.AreEqual(first, PackagedProfile.Open(directory, home));
            Assert.ThrowsExactly<IOException>(() => PackagedProfile.Open(other, home));
            Assert.AreEqual(original, File.ReadAllText(path));
            var pending = Path.Combine(home, "update-pending.json");
            File.WriteAllText(pending, "{}");
            StringAssert.Contains(Assert.ThrowsExactly<IOException>(() => PackagedProfile.Open(directory, home)).Message, "recover");
            Assert.AreEqual(original, File.ReadAllText(path));
            File.Delete(pending);
            var future = JsonNode.Parse(original)!; future["SchemaVersion"] = 99;
            File.WriteAllText(path, future.ToJsonString());
            Assert.ThrowsExactly<IOException>(() => PackagedProfile.Open(directory, home));
            Assert.AreEqual("keep", File.ReadAllText(Path.Combine(first.DataHome, "preserved.txt")));
            var partial = Path.Combine(directory, "partial"); Directory.CreateDirectory(partial);
            Assert.ThrowsExactly<IOException>(() => PackagedProfile.Open(directory, partial));
            Assert.IsFalse(File.Exists(Path.Combine(partial, "profile.json")));
        }
        finally { Directory.Delete(directory, true); Directory.Delete(other, true); }
    }

    [TestMethod]
    public async Task ConcurrentFirstLaunchPublishesOneProfile()
    {
        var directory = Fixture();
        try
        {
            var home = Path.Combine(directory, "profile");
            var results = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(() => PackagedProfile.Open(directory, home))));
            Assert.IsTrue(results.All(item => item == results[0]));
            Assert.IsEmpty(Directory.GetDirectories(directory, ".orchiva-initializing-*"));
        }
        finally { Directory.Delete(directory, true); }
    }

    [TestMethod]
    public async Task PackagedRuntimeStartsEmptyAndReconnectsWithoutDeveloperConfiguration()
    {
        var install = Environment.GetEnvironmentVariable("ORCHIVA_D6_PACKAGE");
        if (string.IsNullOrEmpty(install)) { Assert.Inconclusive("No D6 package configured"); return; }
        var home = Path.Combine(Path.GetTempPath(), "orchiva-d6-live-" + Guid.NewGuid().ToString("N"));
        var options = PackagedProfile.Open(install, home);
        var ids = new List<int>();
        try
        {
            await RuntimeLauncher.StartAsync(options);
            for (var round = 0; round < 2; round++)
            {
                Assert.AreEqual(options, PackagedProfile.Open(install, home));
                await using var bridge = new BridgeClient(options); ids.Add(bridge.ProcessId);
                var info = await bridge.HandshakeAsync();
                for (var i = 0; info.GetProperty("restoring").GetBoolean() && i < 40; i++) { await Task.Delay(500); info = await bridge.HandshakeAsync(); }
                Assert.IsFalse(info.GetProperty("restoring").GetBoolean());
                Assert.AreEqual(options.DataHome.Replace('\\', '/').ToLowerInvariant(), info.GetProperty("dataHome").GetString()!.Replace('\\', '/').ToLowerInvariant());
                Assert.AreEqual(0, (await bridge.CallAsync("desktop.projects.list", new { })).GetArrayLength());
                Assert.AreEqual(0, (await bridge.CallAsync("request.page", new { filter = "all", limit = 20 })).GetProperty("total").GetInt32());
            }
            Assert.IsFalse(File.Exists(Path.Combine(options.DataHome, "project.json")));
        }
        finally
        {
            var start = new ProcessStartInfo(options.NodePath) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var arg in new[] { options.PaseoCliPath!, "daemon", "stop", "--home", options.PaseoHome }) start.ArgumentList.Add(arg);
            using var stop = Process.Start(start)!;
            var stdout = stop.StandardOutput.ReadToEndAsync(); var stderr = stop.StandardError.ReadToEndAsync();
            await stop.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(60)); await Task.WhenAll(stdout, stderr);
            Assert.AreEqual(0, stop.ExitCode);
            File.WriteAllText(Path.Combine(home, "verification.json"), JsonSerializer.Serialize(new { install, home, bridgePids = ids, stopped = true }));
            Console.WriteLine("D6 evidence: " + home);
        }
    }
}
