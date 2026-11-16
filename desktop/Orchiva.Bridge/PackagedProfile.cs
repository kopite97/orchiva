using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace Orchiva.Bridge;

/// <summary>Owns only the desktop profile; never imports legacy homes or credentials.</summary>
public static class PackagedProfile
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, WriteIndented = true };
    private sealed record Profile(int SchemaVersion, string InstallRoot, LaunchOptions Options);

    public static LaunchOptions Open(string installRoot, string profileRoot)
    {
        installRoot = Path.GetFullPath(installRoot);
        profileRoot = Path.GetFullPath(profileRoot);
        RejectLinks(installRoot); RejectLinks(profileRoot);
        if (File.Exists(Path.Combine(profileRoot, "update-pending.json"))) throw new IOException("중단된 업데이트가 있습니다. 배포 관리 도구의 recover로 먼저 복구하세요. 데이터는 보존됩니다.");
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(installRoot, "orchiva-package.json")));
        if (manifest.RootElement.GetProperty("schemaVersion").GetInt32() != 1 ||
            manifest.RootElement.GetProperty("profileVersion").GetInt32() != 1 ||
            manifest.RootElement.GetProperty("platform").GetString() != "win-x64")
            throw new IOException("지원하지 않는 배포본입니다. 원래 설치 폴더를 보존하세요.");
        var source = Path.Combine(installRoot, "runtime", "plugin");
        var node = Path.Combine(installRoot, "runtime", "node.exe");
        var cli = Path.Combine(installRoot, "runtime", "paseo", "node_modules", "@getpaseo", "cli", "bin", "paseo");
        foreach (var file in new[] { node, cli, Path.Combine(source, "bridge", "index.ts") })
            if (!File.Exists(file)) throw new IOException("배포 파일이 누락되었습니다. 전체 폴더를 다시 압축 해제하세요.");
        LaunchOptions Read()
        {
            var path = Path.Combine(profileRoot, "profile.json");
            if (!File.Exists(path)) throw new IOException("불완전한 실행 설정입니다. 기존 데이터 폴더를 보존하고 복구하세요.");
            var profile = JsonSerializer.Deserialize<Profile>(File.ReadAllText(path), Json) ?? throw new IOException("실행 설정 형식 오류");
            if (profile.SchemaVersion != 1) throw new IOException("지원하지 않는 데이터 설정 버전입니다. 이전 앱으로 열 수 없습니다.");
            if (!Same(profile.InstallRoot, installRoot)) throw new IOException("다른 설치 폴더의 실행 데이터입니다. 원래 앱을 사용하세요. 버전 교체는 실행부 종료와 호환성 확인이 필요합니다.");
            var options = profile.Options;
            if (!Same(options.IsolationRoot, profileRoot) || !Same(options.DataHome, Path.Combine(profileRoot, "data")) ||
                !Same(options.PaseoHome, Path.Combine(profileRoot, "paseo")) || !Same(options.SourceRoot, source) ||
                !Same(options.NodePath, node) || options.PaseoCliPath == null || !Same(options.PaseoCliPath, cli))
                throw new IOException("실행 설정의 경로가 변경되었습니다. 자동으로 덮어쓰지 않습니다.");
            foreach (var directory in new[] { options.DataHome, options.PaseoHome }) RejectLinks(directory);
            if (!IPEndPoint.TryParse(options.Endpoint, out var endpoint) || !endpoint.Address.Equals(IPAddress.Loopback) || endpoint.Port < 1024 || endpoint.Port == 6767)
                throw new IOException("실행 설정의 로컬 포트를 확인하세요.");
            BridgeClient.ValidateOptions(options);
            return options;
        }
        if (Directory.Exists(profileRoot)) return Read();
        // Sibling staging + atomic directory rename: a crash cannot publish half a profile.
        var parent = Directory.GetParent(profileRoot)?.FullName ?? throw new IOException("데이터 폴더 오류");
        Directory.CreateDirectory(parent);
        var stage = Path.Combine(parent, ".orchiva-initializing-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(stage);
        try
        {
            Directory.CreateDirectory(Path.Combine(stage, "data"));
            Directory.CreateDirectory(Path.Combine(stage, "paseo"));
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start(); var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
            var options = new LaunchOptions(node, source, Path.Combine(profileRoot, "data"), Path.Combine(profileRoot, "paseo"), $"127.0.0.1:{port}", profileRoot, cli);
            File.WriteAllText(Path.Combine(stage, "paseo", "config.json"), JsonSerializer.Serialize(new {
                version = 1, daemon = new { listen = options.Endpoint }, pluginsEnabled = true,
                plugins = new Dictionary<string, object> { ["orchiva-plugin"] = new { source = "directory", path = source, enabled = true } }
            }, Json));
            File.WriteAllText(Path.Combine(stage, "profile.json"), JsonSerializer.Serialize(new Profile(1, installRoot, options), Json));
            try { Directory.Move(stage, profileRoot); }
            catch (IOException) when (Directory.Exists(profileRoot)) { return Read(); }
            return Read();
        }
        finally
        {
            // Only our new, unpublished sibling; never remove a profile or another run.
            if (Directory.Exists(stage)) { RejectLinks(stage); Directory.Delete(stage, recursive: true); }
        }
    }

    private static bool Same(string left, string right) => string.Equals(Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
    private static void RejectLinks(string path)
    {
        for (var item = new DirectoryInfo(path); item != null; item = item.Parent)
            if (item.Exists && item.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("연결된 폴더는 실행 데이터 위치로 사용할 수 없습니다.");
    }
}
