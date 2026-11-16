using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Orchiva.Bridge;

public sealed record LaunchOptions(string NodePath, string SourceRoot, string DataHome, string PaseoHome, string Endpoint, string IsolationRoot, string? PaseoCliPath = null);
public sealed class BridgeClient : IAsyncDisposable
{
    public const int MaxFrameBytes = 1048576;
    private readonly Process process;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> pending = new();
    private readonly SemaphoreSlim writeGate = new(1);
    private readonly SemaphoreSlim slots = new(8);
    private readonly CancellationTokenSource lifetime = new();
    private readonly Task reader;
    private readonly Task errors;
    private int disposed;
    public int ProcessId => process.Id;
    public string ConnectionState { get; private set; } = "연결 중";
    public string? LastDiagnostic { get; private set; }

    public BridgeClient(LaunchOptions options) : this(CreateStart(options)) { }

    public static void ValidateOptions(LaunchOptions options)
    {
        if (!Path.IsPathFullyQualified(options.NodePath) || !File.Exists(options.NodePath)) throw new ArgumentException("Node 실행 파일의 절대 경로를 확인하세요.");
        if (!Path.IsPathFullyQualified(options.SourceRoot) || !File.Exists(Path.Combine(options.SourceRoot, "bridge", "index.ts"))) throw new ArgumentException("Orchiva 소스 경로를 확인하세요.");
        foreach (var directory in new[] { options.IsolationRoot, options.DataHome, options.PaseoHome })
            if (!Path.IsPathFullyQualified(directory) || !Directory.Exists(directory)) throw new ArgumentException("격리 데이터 폴더의 절대 경로를 확인하세요.");
        foreach (var directory in new[] { options.DataHome, options.PaseoHome })
        {
            var relative = Path.GetRelativePath(options.IsolationRoot, directory);
            if (relative == "." || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar) || Path.IsPathFullyQualified(relative)) throw new ArgumentException("격리 루트 안의 별도 데이터 폴더가 필요합니다.");
        }
        // Real-path and production-home exclusions are also enforced by Node before any SDK call.
    }

    internal static ProcessStartInfo CreateStart(LaunchOptions options)
    {
        ValidateOptions(options);
        var start = new ProcessStartInfo(options.NodePath) { WorkingDirectory = options.SourceRoot, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardInputEncoding = new UTF8Encoding(false) };
        foreach (var argument in new[] { "--import", "tsx", Path.Combine(options.SourceRoot, "bridge", "index.ts") }) start.ArgumentList.Add(argument);
        start.Environment["ORCHIVA_DATA_HOME"] = options.DataHome;
        start.Environment["ORCHIVA_PASEO_HOME"] = options.PaseoHome;
        start.Environment["ORCHIVA_PASEO_ENDPOINT"] = options.Endpoint;
        start.Environment["ORCHIVA_ISOLATION_ROOT"] = options.IsolationRoot;
        if (options.PaseoCliPath != null) start.Environment["ORCHIVA_PASEO_CLI"] = options.PaseoCliPath;
        return start;
    }

    internal BridgeClient(ProcessStartInfo start)
    {
        process = Process.Start(start) ?? throw new IOException("연결 프로세스를 시작하지 못했습니다.");
        reader = ReadResponses();
        errors = DrainErrors();
    }

    public async Task<JsonElement> CallAsync(string method, object parameters, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(disposed != 0, this);
        await slots.WaitAsync(cancellationToken);
        var id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, lifetime.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        try
        {
            pending[id] = completion;
            var json = JsonSerializer.Serialize(new WireRequest(1, id, method, parameters));
            if (Encoding.UTF8.GetByteCount(json) > MaxFrameBytes) throw new IOException("요청이 허용 크기를 초과했습니다.");
            await writeGate.WaitAsync(timeout.Token);
            try { await process.StandardInput.WriteLineAsync(json.AsMemory(), timeout.Token); await process.StandardInput.FlushAsync(timeout.Token); }
            finally { writeGate.Release(); }
            return await completion.Task.WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            // A reader fault cancels writes and waiters together. Preserve the
            // connection failure even when cancellation wins the completion race.
            throw new IOException("연결이 종료되었습니다. 마지막 조회 결과는 유지합니다.");
        }
        finally { pending.TryRemove(id, out _); slots.Release(); }
    }

    public async Task<JsonElement> HandshakeAsync(CancellationToken token = default)
    {
        var info = await CallAsync("handshake", new { }, token);
        if (info.GetProperty("protocolVersion").GetInt32() != 1 || !info.GetProperty("isolated").GetBoolean()) throw new IOException("호환되지 않는 실행 환경입니다.");
        ConnectionState = info.GetProperty("restoring").GetBoolean() ? "복원 중" : "연결됨";
        return info;
    }

    private async Task ReadResponses()
    {
        try
        {
            var buffer = new byte[8192];
            using var frame = new MemoryStream();
            while (true)
            {
                var count = await process.StandardOutput.BaseStream.ReadAsync(buffer, lifetime.Token);
                if (count == 0) throw new EndOfStreamException("연결 프로세스가 종료되었습니다.");
                for (var i = 0; i < count; i++)
                {
                    if (buffer[i] != 10) { if (frame.Length >= MaxFrameBytes) throw new IOException("응답 크기 초과"); frame.WriteByte(buffer[i]); continue; }
                    using var doc = JsonDocument.Parse(frame.ToArray()); frame.SetLength(0);
                    var value = doc.RootElement;
                    if (value.GetProperty("protocolVersion").GetInt32() != 1 || value.GetProperty("id").ValueKind != JsonValueKind.String) throw new IOException("연결 응답 형식 오류");
                    var id = value.GetProperty("id").GetString()!;
                    var hasError = value.TryGetProperty("error", out var error);
                    var hasResult = value.TryGetProperty("result", out var result);
                    if (hasError == hasResult || (hasError && (error.ValueKind != JsonValueKind.Object || !error.TryGetProperty("code", out var code) || code.ValueKind != JsonValueKind.String))) throw new IOException("연결 응답 형식 오류");
                    if (!pending.TryRemove(id, out var waiter)) continue; // late response to a timed-out read
                    if (hasError) waiter.TrySetException(new IOException(error.GetProperty("code").GetString()));
                    else waiter.TrySetResult(result.Clone());
                }
            }
        }
        catch (Exception) when (lifetime.IsCancellationRequested) { }
        catch (Exception) { ConnectionState = "연결 끊김"; LastDiagnostic = "응답 형식 또는 연결 상태를 확인하세요."; }
        finally { foreach (var pair in pending) pair.Value.TrySetException(new IOException("연결이 종료되었습니다. 마지막 조회 결과는 유지합니다.")); lifetime.Cancel(); }
    }

    private async Task DrainErrors()
    {
        var buffer = new char[2048];
        try { while (await process.StandardError.ReadAsync(buffer, lifetime.Token) > 0) LastDiagnostic = "연결 프로세스 진단이 발생했습니다. 환경 설정을 확인하세요."; }
        catch (Exception) when (lifetime.IsCancellationRequested) { }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        try
        {
            process.StandardInput.Close();
            try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
            catch (TimeoutException) { if (!process.HasExited) process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
        }
        finally { lifetime.Cancel(); await Task.WhenAll(reader, errors); process.Dispose(); ConnectionState = "종료됨"; }
    }
}
