using System.Text.Json;
using Orchiva.Bridge;

namespace Orchiva.Bridge.Tests;

[TestClass]
public sealed class ConversationTests
{
    [TestMethod]
    public async Task D4ReadContractsCrossRealStdioAndPreserveTurnsAcrossReconnect()
    {
        var path = Environment.GetEnvironmentVariable("ORCHIVA_D4_CONFIG");
        if (string.IsNullOrEmpty(path)) { Assert.Inconclusive("No D4 isolated fixture configured"); return; }
        var options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        string? identity = null, firstInputHash = null;
        for (var round = 0; round < 2; round++)
        {
            await using var client = new BridgeClient(options);
            var info = await client.HandshakeAsync();
            Assert.IsTrue(info.GetProperty("capabilities").EnumerateArray().Any(c => c.GetString() == "desktop.conversations.send"));
            var projects = await client.CallAsync("desktop.projects.list", new { });
            var projectId = projects.EnumerateArray().Single().GetProperty("projectId").GetString();
            var list = await client.CallAsync("desktop.conversations.list", new { projectId });
            var conversationId = list.GetProperty("records")[0].GetProperty("id").GetString();
            var doc = await client.CallAsync("desktop.conversations.get", new { projectId, conversationId });
            var turnId = doc.GetProperty("turns")[0].GetProperty("id").GetString();
            var turn = await client.CallAsync("desktop.conversations.turn", new { projectId, conversationId, turnId });
            Assert.AreEqual("answered", turn.GetProperty("state").GetString());
            Assert.IsGreaterThan(0, turn.GetProperty("response").GetString()!.Length);
            if (identity != null) { Assert.AreEqual(identity, conversationId); Assert.AreEqual(firstInputHash, turn.GetProperty("inputHash").GetString()); }
            identity = conversationId; firstInputHash = turn.GetProperty("inputHash").GetString();
        }
    }
}
