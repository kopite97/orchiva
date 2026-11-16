using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Orchiva.Bridge;
using System.Text.Json;
using System.Windows.Forms;
using NavigationView = Microsoft.UI.Xaml.Controls.NavigationView;
using SelectionChangedEventArgs = Microsoft.UI.Xaml.Controls.SelectionChangedEventArgs;

namespace Orchiva.Desktop;

public partial class MainWindow : Window
{
    private readonly DesktopViewModel model = new();
    private BridgeClient? client;
    private LaunchOptions? options;
    private string? cursor;
    private readonly SemaphoreSlim connectGate = new(1);
    private readonly CancellationTokenSource closing = new();
    private NotifyIcon? tray;
    private bool exiting;
    private bool initialized;
    private string settingsPath = "";
    private int refreshVersion;
    private bool loadingPage;

    public MainWindow()
    {
        InitializeComponent(); Root.DataContext = model;
        WorkspacePanel.ConnectionFailed += ReportFailure;
        ConversationPanel.ConnectionFailed += ReportFailure;
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1280, 900));
        model.ProjectName = "연결을 준비하세요";
        model.ProjectPath = "프로젝트를 아직 읽지 않았습니다.";
        model.Connection = "환경 설정 필요";
        model.ListMessage = "연결 후 저장된 작업을 조회합니다.";
        settingsPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Orchiva.Desktop", "settings.json");
        try
        {
            var configPath = Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG");
            if (!string.IsNullOrEmpty(configPath))
            {
                options = JsonSerializer.Deserialize<LaunchOptions>(File.ReadAllText(configPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? throw new IOException();
                BridgeClient.ValidateOptions(options);
                settingsPath = Path.Combine(options.IsolationRoot, "desktop-settings.json");
            }
            if (File.Exists(settingsPath))
            {
                using var settings = JsonDocument.Parse(File.ReadAllText(settingsPath));
                ThemeChoice.SelectedIndex = Math.Clamp(settings.RootElement.GetProperty("theme").GetInt32(), 0, 2);
                CloseChoice.SelectedIndex = Math.Clamp(settings.RootElement.GetProperty("close").GetInt32(), 0, 1);
            }
        }
        catch { options = null; model.Diagnostics = "설정 파일을 읽지 못했습니다. 경로와 형식을 확인하세요."; }
        initialized = true;
        ApplyTheme();
        AppWindow.Closing += (sender, args) =>
        {
            if (exiting) return;
            args.Cancel = true;
            if (CloseChoice.SelectedIndex == 1) { EnsureTray(); AppWindow.Hide(); }
            else _ = ExitAsync();
        };
        Closed += (_, _) => { tray?.Dispose(); };
        Root.Loaded += async (_, _) => await ConnectAsync();
    }

    private void EnsureTray()
    {
        if (tray != null) return;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Orchiva 열기", null, (_, _) => DispatcherQueue.TryEnqueue(() => { AppWindow.Show(); Activate(); }));
        menu.Items.Add("종료", null, (_, _) => DispatcherQueue.TryEnqueue(async () => await ExitAsync()));
        tray = new NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Text = "Orchiva", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += (_, _) => DispatcherQueue.TryEnqueue(() => { AppWindow.Show(); Activate(); });
    }

    private async Task ExitAsync()
    {
        if (exiting) return;
        exiting = true; closing.Cancel();
        await connectGate.WaitAsync();
        try { if (client != null) await client.DisposeAsync(); }
        finally { connectGate.Release(); tray?.Dispose(); Close(); }
    }

    private async Task ConnectAsync()
    {
        if (!await connectGate.WaitAsync(0)) return;
        try
        {
            if (exiting) return;
            if (options == null) { model.Diagnostics = "ORCHIVA_DESKTOP_CONFIG에 격리 실행 설정 JSON 경로를 지정하세요. 기본 데이터 폴더로 자동 연결하지 않습니다."; return; }
            model.Connection = "연결 중";
            if (client != null) await client.DisposeAsync();
            client = new BridgeClient(options);
            var info = await client.HandshakeAsync(closing.Token);
            model.Connection = client.ConnectionState;
            model.Diagnostics = $"프로젝트 작업 연결\n데이터: {info.GetProperty("dataHome")}\n실행부: {info.GetProperty("paseoHome")}\n주소: {info.GetProperty("endpoint")}\n서버: {info.GetProperty("serverVersion")}";
            WorkspacePanel.Connect((method, input) => client.CallAsync(method, input, closing.Token));
            ConversationPanel.Connect((method, input) => client.CallAsync(method, input, closing.Token));
            WorkspacePanel.IsEnabled = !info.GetProperty("restoring").GetBoolean();
            await RefreshAsync();
        }
        catch (Exception) when (!exiting) { ReportFailure("연결하지 못했습니다. 격리 실행부가 시작됐는지 확인한 뒤 다시 연결하세요."); }
        catch (Exception) when (exiting) { }
        finally { connectGate.Release(); }
    }

    private void ReportFailure(string message)
    {
        model.Connection = "연결 확인 필요"; StatusBar.Severity = InfoBarSeverity.Warning;
        StatusBar.Title = "조회 실패 · 마지막 정보 유지"; StatusBar.Message = message;
    }

    private async Task RefreshAsync()
    {
        if (client == null) return;
        var version = ++refreshVersion;
        var project = await client.CallAsync("project.read", new { }, closing.Token);
        var page = await client.CallAsync("request.page", new { filter = "all", limit = 20 }, closing.Token);
        var runtime = await client.CallAsync("runtime.status", new { }, closing.Token);
        if (version != refreshVersion || exiting) return;
        model.ProjectName = DesktopViewModel.Text(project, "name");
        model.ProjectPath = DesktopViewModel.Text(project, "repositoryPath");
        model.ProjectInfo = $"기준 {DesktopViewModel.Text(project, "baseRef")} · {DesktopViewModel.Text(project, "provider")}";
        model.Items.Clear(); AddPage(page);
        model.DetailTitle = "작업을 선택하세요"; model.Detail = "목록에서 작업을 선택하면 PLAN과 보존된 결과를 확인할 수 있습니다.";
        model.Updated = $"마지막 조회 {DateTime.Now:HH:mm:ss} · 기존 MVP 조회";
        var restoring = runtime.GetProperty("restoring").GetBoolean();
        model.Connection = restoring ? "복원 중" : "연결됨";
        // A restoring handshake grants no desktop capabilities. Reconnect after
        // restoration to acquire them; a legacy refresh alone must not enable writes.
        WorkspacePanel.IsEnabled = !restoring && client.ConnectionState == "연결됨";
        StatusBar.Severity = InfoBarSeverity.Informational;
        StatusBar.Title = WorkspacePanel.IsEnabled ? "실행부 연결됨" : "복원 중 · 읽기 전용";
        StatusBar.Message = WorkspacePanel.IsEnabled ? "작업실에서 프로젝트·지침·제작 PLAN을 관리합니다." : "기존 이력은 조회할 수 있습니다. 복원이 끝나면 연결 상태에서 다시 연결하세요.";
    }

    private void AddPage(JsonElement page)
    {
        foreach (var item in page.GetProperty("items").EnumerateArray()) model.Items.Add(new(DesktopViewModel.Text(item, "token"), DesktopViewModel.Text(item, "title"), $"{DesktopViewModel.Status(DesktopViewModel.Text(item, "status"))} · 시도 {DesktopViewModel.Text(item, "attempt")}"));
        cursor = page.GetProperty("nextCursor").GetString(); NextPage.IsEnabled = cursor != null;
        model.ListMessage = page.GetProperty("total").GetInt32() == 0 ? "아직 저장된 작업이 없습니다." : $"전체 {page.GetProperty("total")}건 · {model.Items.Count}건 표시";
    }
    private async void Refresh(object sender, RoutedEventArgs e) { try { await RefreshAsync(); } catch { if (!exiting) ReportFailure("재조회하지 못했습니다. 기존 목록은 유지합니다."); } }
    private async void StartRuntime(object sender, RoutedEventArgs e)
    {
        if (options == null) { ReportFailure("격리 실행 환경 설정이 필요합니다."); return; }
        var button = (Microsoft.UI.Xaml.Controls.Button)sender; button.IsEnabled = false;
        try { model.Connection = "실행부 시작 중"; await RuntimeLauncher.StartAsync(options, closing.Token); await ConnectAsync(); }
        catch { if (!exiting) ReportFailure("격리 실행부를 시작하지 못했습니다. 설정과 포트를 확인하세요."); }
        finally { button.IsEnabled = true; }
    }
    private async void Reconnect(object sender, RoutedEventArgs e) => await ConnectAsync();
    private async void More(object sender, RoutedEventArgs e)
    {
        if (client == null || cursor == null || loadingPage) return; NextPage.IsEnabled = false; loadingPage = true;
        var version = refreshVersion;
        try { var page = await client.CallAsync("request.page", new { filter = "all", cursor, limit = 20 }, closing.Token); if (version == refreshVersion && !exiting) AddPage(page); }
        catch { if (!exiting) { NextPage.IsEnabled = true; ReportFailure("다음 목록을 읽지 못했습니다."); } }
        finally { loadingPage = false; }
    }
    private async void SelectRequest(object sender, SelectionChangedEventArgs e)
    {
        if (client == null || Requests.SelectedItem is not RequestItem item) return;
        try
        {
            var detail = await client.CallAsync("request.detail", new { token = item.Token }, closing.Token);
            if (!ReferenceEquals(Requests.SelectedItem, item) || detail.ValueKind == JsonValueKind.Null) return;
            var record = detail.GetProperty("record"); model.DetailTitle = item.Title;
            var plan = record.GetProperty("requestPlan");
            model.Detail = $"상태: {DesktopViewModel.Status(DesktopViewModel.Text(record, "status"))}\n\n{DesktopViewModel.Text(plan, "content")}";
            if (record.TryGetProperty("results", out var results))
            {
                model.Detail += $"\n\n보존된 결과 {results.GetArrayLength()}개";
                foreach (var result in results.EnumerateArray()) model.Detail += $"\n\n결과 {DesktopViewModel.Text(result, "id")} · {DesktopViewModel.Text(result, "collectedAt")}\n{DesktopViewModel.Text(result, "finalResponse")}\n변경 파일: {string.Join(", ", result.GetProperty("changedFiles").EnumerateArray().Select(x => x.GetString()))}";
            }
            foreach (var decision in record.GetProperty("decisions").EnumerateArray()) model.Detail += $"\n\n판정: {(decision.GetProperty("approved").GetBoolean() ? "완료" : "수정 요청")} · {DesktopViewModel.Text(decision, "at")}\n{DesktopViewModel.Text(decision, "note")}";
        }
        catch { if (!exiting) ReportFailure("선택한 작업을 읽지 못했습니다. 이전 상세를 유지합니다."); }
    }
    private void Navigate(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (ProjectPanel == null) return;
        var tag = args.IsSettingsSelected ? "settings" : (args.SelectedItem as NavigationViewItem)?.Tag?.ToString();
        WorkspacePanel.Visibility = tag == "workspace" ? Visibility.Visible : Visibility.Collapsed;
        ConversationPanel.Visibility = tag == "conversation" ? Visibility.Visible : Visibility.Collapsed;
        OtherPages.Visibility = tag is "workspace" or "conversation" ? Visibility.Collapsed : Visibility.Visible;
        ProjectPanel.Visibility = tag == "project" ? Visibility.Visible : Visibility.Collapsed;
        HistoryPanel.Visibility = tag == "history" ? Visibility.Visible : Visibility.Collapsed;
        ConnectionPanel.Visibility = tag == "connection" ? Visibility.Visible : Visibility.Collapsed;
        SettingsPanel.Visibility = tag == "settings" ? Visibility.Visible : Visibility.Collapsed;
    }
    private void ApplyTheme() => Root.RequestedTheme = ThemeChoice.SelectedIndex switch { 1 => ElementTheme.Light, 2 => ElementTheme.Dark, _ => ElementTheme.Default };
    private void ThemeChanged(object sender, SelectionChangedEventArgs args) { if (!initialized) return; ApplyTheme(); SaveSettings(); }
    private void CloseChanged(object sender, SelectionChangedEventArgs args) { if (initialized) SaveSettings(); }
    private void SaveSettings()
    {
        try { Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!); var temp = settingsPath + ".tmp"; File.WriteAllText(temp, JsonSerializer.Serialize(new { theme = ThemeChoice.SelectedIndex, close = CloseChoice.SelectedIndex })); File.Move(temp, settingsPath, true); }
        catch { ReportFailure("설정을 저장하지 못했습니다. 현재 선택은 화면에서 유지합니다."); }
    }
}
