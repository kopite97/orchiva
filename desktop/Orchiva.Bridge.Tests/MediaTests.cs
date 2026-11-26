using System.Security.Cryptography;
using System.Text.Json;
using Orchiva.Bridge;
namespace Orchiva.Bridge.Tests;
[TestClass]
public sealed class MediaTests
{
    [TestMethod]
    public async Task D5BinaryPreviewCrossesRealStdioAndReconnectWithoutChangingResult()
    {
        var path = Environment.GetEnvironmentVariable("ORCHIVA_D5_CONFIG");
        if (string.IsNullOrEmpty(path)) { Assert.Inconclusive("No D5 isolated fixture configured"); return; }
        var options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(Path.GetDirectoryName(path)!, "media-verification.json")));
        var projectId = manifest.RootElement.GetProperty("projectId").GetString();
        for (var round = 0; round < 2; round++)
        {
            await using var client = new BridgeClient(options);
            var info = await client.HandshakeAsync();
            Assert.IsTrue(info.GetProperty("capabilities").EnumerateArray().Any(c => c.GetString() == "desktop.requests.media-preview"));
            foreach (var item in manifest.RootElement.GetProperty("cases").EnumerateArray())
            {
                var token = item.GetProperty("token").GetString(); var resultId = item.GetProperty("resultId").GetString();
                var doc = await client.CallAsync("desktop.requests.get", new { projectId, token });
                Assert.AreEqual(resultId, doc.GetProperty("engine").GetProperty("result").GetProperty("id").GetString());
                var name = item.GetProperty("kind").GetString() switch { "art" => "shape.png", "sound" => "tone.wav", _ => "effect.png" };
                using var content = new MemoryStream(); int size;
                do
                {
                    var chunk = await client.CallAsync("desktop.requests.media-preview", new { projectId, token, resultId, path = $"media/{token}/{name}", offset = content.Length });
                    size = chunk.GetProperty("size").GetInt32();
                    content.Write(Convert.FromBase64String(chunk.GetProperty("content").GetString()!));
                } while (content.Length < size);
                Assert.AreEqual(item.GetProperty("sha256").GetString(), Convert.ToHexString(SHA256.HashData(content.ToArray())).ToLowerInvariant());
            }
        }
    }
}
