using System.Diagnostics;
namespace Orchiva.Bridge;
public static class RuntimeLauncher
{
    public static async Task StartAsync(LaunchOptions options, CancellationToken cancellationToken = default)
    {
        if (options.PaseoCliPath == null) throw new IOException("Paseo CLI 경로를 설정하세요.");
        var start = BridgeClient.CreateStart(options); start.ArgumentList.Add("--run-daemon");
        using var process = Process.Start(start) ?? throw new IOException("실행부 시작 실패");
        process.StandardInput.Close();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(65));
        // Read a bounded readiness token, then release handles without killing the
        // independent runtime host. It exits when the public daemon stop finishes.
        try
        {
            var expected = "DAEMON_READY\n";
            var buffer = new char[expected.Length]; var offset = 0;
            while (offset < buffer.Length)
            {
                var count = await process.StandardOutput.ReadAsync(buffer.AsMemory(offset), timeout.Token);
                if (count == 0) throw new IOException("격리 실행부를 시작하지 못했습니다. 경로·설정·포트를 확인하세요.");
                offset += count;
            }
            if (new string(buffer) != expected) throw new IOException("실행부 시작 응답 형식이 잘못되었습니다.");
        }
        catch
        {
            if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
            throw;
        }
    }
}
