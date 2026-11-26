using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Windows.Graphics;

namespace Orchiva.Desktop;

// Mock UI acceptance, with an opt-in read of an isolated MA3 bridge fixture.
public partial class App : Application
{
    private MainWindow? window;
    public App() { InitializeComponent(); }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var config = Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG") ?? throw new InvalidOperationException("Use an isolated desktop fixture config.");
        var output = Environment.GetEnvironmentVariable("ORCHIVA_UI_EVIDENCE") ?? throw new InvalidOperationException("Set an evidence directory.");
        Directory.CreateDirectory(output);
        if (Environment.GetEnvironmentVariable("ORCHIVA_D123_UI") is string liveScenario)
        {
            window = new MainWindow();
            var liveRoot = Access.Get<Grid>(window, "Root");
            liveRoot.Loaded += async (_, _) => await DesktopAcceptance.Run(window, config, output, liveScenario);
            window.Activate();
            return;
        }
        window = new MainWindow { Title = "Orchiva · 합성 UI 검증 (모델 호출 없음)" };
        Access.Set(window, "options", null); // prevent Root.Loaded from constructing a real BridgeClient
        var workspace = Access.Get<ProductionWorkspace>(window, "WorkspacePanel");
        var root = Access.Get<Grid>(window, "Root");
        var mock = new WorkspaceFixture(); workspace.Connect(mock.Call);
        var toolbar = new Presentation.ActionPanel { Margin = new Thickness(8) };
        var pageChoice = new ComboBox { PlaceholderText = "합성 화면 선택", Width = 200 };
        foreach (var page in new[] { "projects", "setup", "home", "request", "plan", "execution", "result", "apply", "history", "instructions", "configuration" }) pageChoice.Items.Add(page);
        pageChoice.SelectionChanged += (_, _) => { if (pageChoice.SelectedItem is string page) workspace.ShowPage(page); };
        toolbar.Children.Add(pageChoice);
        var compact = new Button { Content = "800 × 600" }; compact.Click += (_, _) => window.AppWindow.Resize(new SizeInt32(800, 600)); toolbar.Children.Add(compact);
        var normal = new Button { Content = "1280 × 900" }; normal.Click += (_, _) => window.AppWindow.Resize(new SizeInt32(1280, 900)); toolbar.Children.Add(normal);
        var wide = new Button { Content = "1600 × 1000" }; wide.Click += (_, _) => window.AppWindow.Resize(new SizeInt32(1600, 1000)); toolbar.Children.Add(wide);
        var themes = new Button { Content = "밝게 / 어둡게" }; themes.Click += (_, _) => root.RequestedTheme = root.RequestedTheme == ElementTheme.Light ? ElementTheme.Dark : ElementTheme.Light; toolbar.Children.Add(themes);
        var scenarios = new ComboBox { PlaceholderText = "합성 상태", Width = 160 };
        foreach (var scenario in new[] { "정상", "빈 목록", "연결 오류", "불러오는 중", "수정 요청", "권한 대기" }) scenarios.Items.Add(scenario);
        scenarios.SelectionChanged += async (_, _) =>
        {
            var scenario = scenarios.SelectedItem?.ToString(); mock.Empty = scenario == "빈 목록";
            if (scenario is "정상" or "빈 목록" or "연결 오류" or "불러오는 중")
            {
                workspace.ShowPage("projects");
                if (scenario == "연결 오류") mock.FailNext = "desktop.projects.list";
                if (scenario == "불러오는 중") { mock.Hold = new TaskCompletionSource(); _ = Task.Delay(5000).ContinueWith(_ => mock.Hold?.TrySetResult()); }
                await Access.Action(workspace, "projects"); mock.Hold = null;
            }
            else if (scenario == "수정 요청") { Access.Get<ComboBox>(workspace, "RequestMode").SelectedIndex = 1; workspace.ShowPage("request"); }
            else if (scenario == "권한 대기") { mock.Document["engine"]!["status"] = "needs-input"; await (Task)Access.Call(workspace, "LoadDocument", false)!; workspace.ShowPage("execution"); }
        };
        toolbar.Children.Add(scenarios);
        window.Content = null;
        var outer = new Grid(); outer.RowDefinitions.Add(new() { Height = GridLength.Auto }); outer.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) });
        outer.Children.Add(toolbar); Grid.SetRow(root, 1); outer.Children.Add(root); window.Content = outer;
        root.RequestedTheme = ElementTheme.Light;
        root.Loaded += async (_, _) =>
        {
            try
            {
                var checks = await WorkspaceChecks.Run(workspace, mock);
                Access.Call(workspace, "OpenConversation", new Button(), new RoutedEventArgs());
                if (Access.Get<ConversationWorkspace>(window, "ConversationPanel").Visibility != Visibility.Visible ||
                    Access.Get<ScrollViewer>(window, "PageScroll").Visibility != Visibility.Collapsed)
                    throw new Exception("Conversation navigation from the workspace");
                checks.Add("20 workspace opens D4 conversation");
                Access.Get<NavigationView>(window, "Navigation").SelectedItem = Access.Get<NavigationViewItem>(window, "HomeNavigation");
                foreach (var (index, kind) in new[] { (2, "art"), (3, "sound"), (4, "effect") })
                {
                    Access.Call(workspace, "ChooseDiscipline", new Button { Tag = index.ToString() }, new RoutedEventArgs());
                    var input = (JsonObject)Access.Call(workspace, "Input")!;
                    if (workspace.Visibility != Visibility.Visible || Access.Get<StackPanel>(workspace, "MediaSettings").Visibility != Visibility.Visible ||
                        input["discipline"]?.ToString() != kind || input["media"]?["kind"]?.ToString() != kind)
                        throw new Exception("Media selection from the workspace: " + kind);
                }
                checks.Add("21 all three D5 media profiles accessible from workspace");
                await (Task)Access.Call(workspace, "LoadDocument", true)!;
                if (Environment.GetEnvironmentVariable("ORCHIVA_MILESTONE_UI") == "1")
                    await MilestoneChecks.Run(window, workspace, mock, output);
                var status = Access.Get<InfoBar>(window, "StatusBar"); status.Title = "합성 UI 검증"; status.Message = "모델·Agent·Worktree 생성 없음 · 실제 실행 결과가 아닙니다.";
                File.WriteAllText(Path.Combine(output, "mock-results.json"), JsonSerializer.Serialize(new { passed = true, checks, calls = mock.Calls, rasterizationScale = root.XamlRoot.RasterizationScale }, new JsonSerializerOptions { WriteIndented = true }));
                workspace.ShowPage("projects");
            }
            catch (Exception error) { File.WriteAllText(Path.Combine(output, "mock-results.json"), JsonSerializer.Serialize(new { passed = false, error = error.ToString() })); }
            if (Environment.GetEnvironmentVariable("ORCHIVA_MILESTONE_UI") == "1" || Environment.GetEnvironmentVariable("ORCHIVA_UI_EXIT") == "1") Exit();
        };
        window.Activate();
    }
}

internal static class Access
{
    private const BindingFlags Flags = BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance;
    public static T Get<T>(object target, string name) => (T)target.GetType().GetField(name, Flags)!.GetValue(target)!;
    public static void Set(object target, string name, object? value) => target.GetType().GetField(name, Flags)!.SetValue(target, value);
    public static object? Call(object target, string name, params object[] args) => target.GetType().GetMethod(name, Flags)!.Invoke(target, args);
    public static async Task Action(ProductionWorkspace workspace, string tag)
    {
        Call(workspace, "Action", new Button { Tag = tag }, new RoutedEventArgs());
        await Idle(workspace);
    }
    public static async Task Idle(ProductionWorkspace workspace)
    {
        // The loading scenario intentionally holds its response for five seconds.
        for (var i = 0; i < 500 && Get<bool>(workspace, "busy"); i++) await Task.Delay(20);
        if (Get<bool>(workspace, "busy")) throw new Exception("UI stayed busy");
    }
}
