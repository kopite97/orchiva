using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
namespace Orchiva.Desktop;
public sealed record RequestItem(string Token, string Title, string Description);
public sealed class DesktopViewModel : INotifyPropertyChanged
{
    private readonly Dictionary<string, string> values = new();
    public event PropertyChangedEventHandler? PropertyChanged;
    private string Get([CallerMemberName] string key = "") => values.GetValueOrDefault(key, "");
    private void Set(string value, [CallerMemberName] string key = "") { values[key] = value; PropertyChanged?.Invoke(this, new(key)); }
    public string ProjectName { get => Get(); set => Set(value); }
    public string ProjectPath { get => Get(); set => Set(value); }
    public string ProjectInfo { get => Get(); set => Set(value); }
    public string ListMessage { get => Get(); set => Set(value); }
    public string Connection { get => Get(); set => Set(value); }
    public string Diagnostics { get => Get(); set => Set(value); }
    public string DetailTitle { get => Get(); set => Set(value); }
    public string Detail { get => Get(); set => Set(value); }
    public string Updated { get => Get(); set => Set(value); }
    public ObservableCollection<RequestItem> Items { get; } = new();
    public static string Text(JsonElement value, string name) => value.TryGetProperty(name, out var field) ? field.ToString() : "";
    public static string Status(string value) => value switch { "draft" => "초안", "ready" => "PLAN 확인 대기", "completed" => "완료", "awaiting-review" => "결과 검토 대기", "failed" => "실패", "needs-input" => "응답 필요", "running" => "실행 중", _ => value };
}
