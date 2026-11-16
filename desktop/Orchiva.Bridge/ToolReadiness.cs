using System.Diagnostics;

namespace Orchiva.Bridge;

public sealed record ToolCheck(string Tool, string State, string Message);
internal sealed record ProbeResult(int ExitCode, string Output);

/// <summary>Reads CLI status only. Never starts login or returns raw credential output.</summary>
public static class ToolReadiness
{
    public static Task<IReadOnlyList<ToolCheck>> CheckAsync(CancellationToken token = default) => CheckAsync(Probe, token);

    internal static async Task<IReadOnlyList<ToolCheck>> CheckAsync(Func<string, string[], CancellationToken, Task<ProbeResult>> probe, CancellationToken token)
    {
        var results = new List<ToolCheck>();
        foreach (var tool in new[] { "git", "codex" })
        {
            try
            {
                var found = await probe("where.exe", [tool], token);
                var executable = found.Output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
                    .FirstOrDefault(path => Path.IsPathFullyQualified(path) && path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase));
                if (found.ExitCode != 0 || executable == null)
                {
                    results.Add(new(tool, "missing", tool == "git" ? "Git 실행 파일을 찾지 못했습니다. Git for Windows를 설치한 뒤 앱을 다시 열어 확인하세요." : "Codex 실행 파일을 찾지 못했습니다. Codex CLI의 Windows 실행 파일을 PATH에 준비한 뒤 앱을 다시 열어 확인하세요."));
                    continue;
                }
                var version = await probe(executable, ["--version"], token);
                if (version.ExitCode != 0) { results.Add(new(tool, "error", $"{tool} 실행을 확인하지 못했습니다. 설치 상태를 확인하세요.")); continue; }
                results.Add(new(tool, "ready", tool == "git" ? "Git 실행 가능" : "Codex 실행 가능"));
                if (tool != "codex") continue;
                var auth = await probe(executable, ["login", "status"], token);
                results.Add(auth.ExitCode == 0 ? new("codex-auth", "ready", "Codex 로그인 상태 확인됨 · 모델 접근은 실제 요청에서 확인합니다.") :
                    auth.Output.Contains("Not logged in", StringComparison.OrdinalIgnoreCase) ? new("codex-auth", "login-required", "Codex 로그인이 필요합니다. 사용자가 직접 codex login을 완료한 뒤 다시 확인하세요.") :
                    new("codex-auth", "unknown", "Codex 인증 상태를 확인하지 못했습니다. 직접 로그인 상태를 확인한 뒤 다시 시도하세요."));
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch { results.Add(new(tool, "unknown", $"{tool} 상태 확인 시간이 초과됐거나 실행하지 못했습니다. 설치·연결 상태를 확인하세요.")); }
        }
        return results;
    }

    private static async Task<ProbeResult> Probe(string executable, string[] args, CancellationToken token)
    {
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true };
        foreach (var argument in args) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new IOException("도구 실행 실패");
        process.StandardInput.Close();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token); timeout.CancelAfter(TimeSpan.FromSeconds(10));
        async Task<string> Read(StreamReader reader)
        {
            var buffer = new char[1024]; var output = new System.Text.StringBuilder();
            while (true)
            {
                var count = await reader.ReadAsync(buffer.AsMemory(), timeout.Token);
                if (count == 0) return output.ToString();
                if (output.Length + count > 16384) { timeout.Cancel(); throw new IOException("도구 출력 한도 초과"); }
                output.Append(buffer, 0, count);
            }
        }
        var stdout = Read(process.StandardOutput); var stderr = Read(process.StandardError);
        try { await process.WaitForExitAsync(timeout.Token); return new(process.ExitCode, await stdout + "\n" + await stderr); }
        finally
        {
            timeout.Cancel();
            if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
            try { await Task.WhenAll(stdout, stderr); } catch { }
        }
    }
}
