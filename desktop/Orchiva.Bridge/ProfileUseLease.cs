using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;

namespace Orchiva.Bridge;

/// <summary>Shares the directory-owner name with Node maintenance; released by the OS on exit.</summary>
public static class ProfileUseLease
{
    public static IDisposable Acquire(string root)
    {
        var path = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar).ToLowerInvariant();
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path))).ToLowerInvariant();
        try { return new NamedPipeServerStream("orchiva-store-" + digest, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly); }
        catch (IOException) { throw new IOException("이 실행 데이터를 다른 앱이나 업데이트 작업이 사용 중입니다. 해당 작업을 마친 뒤 다시 여세요."); }
    }
}
