using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Orchiva.Bridge;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Windows.Graphics;

namespace Orchiva.Desktop;

// Exercise the application's own controls on a disposable fixture, with its normal bridge.
internal sealed class DesktopAcceptance(MainWindow window, string home, string evidence)
{
    private readonly List<string> checks = [];
    private readonly Dictionary<string, object?> observations = [];
    private ProductionWorkspace W => Access.Get<ProductionWorkspace>(window, "WorkspacePanel");
    private DesktopViewModel Model => Access.Get<DesktopViewModel>(window, "model");
    private T Field<T>(string name) => Access.Get<T>(W, name);
    private JsonObject Doc => Field<JsonObject>("document");
    private string Status => Doc["engine"]!["status"]!.ToString();
    private string Result => Doc["engine"]!["result"]!["id"]!.ToString();
    private void Report(string? error = null) => File.WriteAllText(evidence, JsonSerializer.Serialize(new { passed = error == null, checks, observations, error }, new JsonSerializerOptions { WriteIndented = true }));
    private void Check(bool ok, string name)
    {
        if (!ok) throw new InvalidOperationException(name);
        checks.Add(name);
        Report("running");
    }
    private static async Task Wait(Func<bool> condition, string label, int seconds = 70)
    {
        var timer = Stopwatch.StartNew();
        while (!condition() && timer.Elapsed.TotalSeconds < seconds) await Task.Delay(100);
        if (!condition()) throw new TimeoutException(label);
    }
    private async Task Act(string tag, bool expectError = false)
    {
        await Access.Idle(W);
        await Access.Action(W, tag);
        var notice = Field<InfoBar>("Notice");
        if ((notice.Severity == InfoBarSeverity.Warning) != expectError) throw new IOException(tag + " · " + notice.Message);
    }
    public static async Task Run(MainWindow window, string config, string output, string mode)
    {
        var home = Path.GetDirectoryName(Path.GetFullPath(config))!;
        if (Path.GetFileName(Path.GetDirectoryName(home)) != ".desktop-local" || !Path.GetFileName(home).StartsWith("d1-gui-") ||
            !string.Equals(Access.Get<LaunchOptions>(window, "options")?.IsolationRoot, home, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("A disposable d1-gui fixture is required.");
        var test = new DesktopAcceptance(window, home, Path.Combine(output, mode + ".json"));
        try
        {
            await Wait(() => test.Model.Updated.Length > 0 || test.Model.Connection == "연결 확인 필요", "initial refresh or offline failure");
            if (mode == "restore")
            {
                await test.Restore();
                test.Report();
                await (Task)Access.Call(window,"ExitAsync")!;
                return;
            }
            if (mode.StartsWith("history-"))
            {
                await test.History(mode);
                return;
            }
            test.Check(test.Model.Connection == "연결됨" && test.Model.Items.Count == 0 && test.Model.ListMessage.Contains("아직"), "G03 real empty legacy store");
            if (mode == "faults") await test.Faults();
            else await test.Work(mode);
            test.Report();
        }
        catch (Exception e) { test.Report(e.ToString()); }
        await (Task)Access.Call(window, "ExitAsync")!;
    }
    private async Task History(string mode)
    {
        var close = Access.Get<ComboBox>(window, "CloseChoice");
        var theme = Access.Get<ComboBox>(window, "ThemeChoice");
        if (mode == "history-1")
        {
            Check(Model.Connection == "연결 확인 필요" && Access.Get<InfoBar>(window, "StatusBar").Severity == InfoBarSeverity.Warning, "G01 offline failure message");
            var button = new Button();
            Access.Call(window, "StartRuntime", button, new RoutedEventArgs());
            Check(!button.IsEnabled && Model.Connection == "실행부 시작 중", "G01 starting indicator");
            await Wait(() => button.IsEnabled, "start");
        }
        else Check(close.SelectedIndex == 1 && theme.SelectedIndex == 2, "G05 persisted theme and close option");
        Check(Model.Connection == "연결됨" && Model.Items.Count == 3, "G01/G05 same three saved requests");
        var ids = Model.Items.Select(x => x.Token).ToArray();
        var completed = Model.Items.ToList().FindIndex(x => x.Token == "d1-fixture-003");
        Access.Get<ListView>(window, "Requests").SelectedIndex = completed;
        await Wait(() => Model.Detail.Contains("보존된 결과"), "completed history details");
        var client = Access.Get<BridgeClient>(window, "client");
        observations["previousBridge"] = client.ProcessId;
        await (Task)Access.Call(window, "ConnectAsync")!;
        Check(Model.Connection == "연결됨" && ids.SequenceEqual(Model.Items.Select(x => x.Token)), "G01 reconnect retains history");
        client = Access.Get<BridgeClient>(window, "client");
        observations["bridge"] = client.ProcessId;
        observations["runtime"] = (await client.CallAsync("runtime.info", new { })).GetProperty("pid").GetInt32();
        observations["app"] = Environment.ProcessId;
        var root = Access.Get<Grid>(window, "Root");
        observations["scale"] = root.XamlRoot.RasterizationScale;
        foreach (var size in new[] { new SizeInt32(800,600), new SizeInt32(1280,900) })
        {
            window.AppWindow.Resize(size);
            await Wait(() => window.AppWindow.Size.Width == size.Width, "resize");
            await Task.Delay(180);
            Check(root.ActualWidth > 0 && root.ActualHeight > 0 && window.AppWindow.Size.Height == size.Height, "G02 arranged " + size.Width + "x" + size.Height);
        }
        foreach (var index in new[] { 1, 2 })
        {
            theme.SelectedIndex = index;
            Check(root.ActualTheme == (index == 1 ? ElementTheme.Light : ElementTheme.Dark), "G04/G11 theme " + index);
        }
        Check(AutomationProperties.GetName(theme).Length > 0 && AutomationProperties.GetName(close).Length > 0, "G04 named settings controls");
        close.SelectedIndex = 1;
        Access.Call(window, "EnsureTray");
        var tray = Access.Get<System.Windows.Forms.NotifyIcon>(window, "tray");
        Check(tray.Visible && tray.ContextMenuStrip?.Items.Count == 2, "G05 tray open and exit commands");
        window.AppWindow.Hide();
        tray.ContextMenuStrip!.Items[0].PerformClick();
        await Wait(() => window.AppWindow.IsVisible, "tray reopen");
        Check(true, "G05 tray menu restores same window");
        window.Closed += (_, _) => { checks.Add("G05 window closed"); Report(); };
        tray.ContextMenuStrip.Items[1].PerformClick();
    }
    private async Task Restore()
    {
        Check(Model.Connection == "연결 확인 필요", "G03 initially offline");
        var options = Access.Get<LaunchOptions>(window, "options");
        var state = Path.Combine(options.DataHome, "runtime-status.json");
        // Delay the real reconciler in its isolated home, then let the GUI connect in its retry interval.
        using (File.Open(Path.Combine(options.DataHome,"project.json"), FileMode.Open, FileAccess.Read, FileShare.None))
        {
            await RuntimeLauncher.StartAsync(options);
            await Wait(() =>
            {
                if (!File.Exists(state)) return false;
                var report = JsonNode.Parse(File.ReadAllText(state))!;
                return report["restoring"]!.GetValue<bool>() && report["failures"]!.GetValue<int>() >= 2;
            }, "reconciler enters retry interval");
        }
        await (Task)Access.Call(window,"ConnectAsync")!;
        Check(Model.Connection == "복원 중" && Access.Get<InfoBar>(window,"StatusBar").Title.Contains("복원") && Model.ListMessage.Contains("아직") && Model.Updated.Contains("읽기 전용"), "G03 live restoring, empty history and read-only indicator");
        await Wait(() => JsonNode.Parse(File.ReadAllText(state))!["restoring"]!.GetValue<bool>() == false, "recovery");
        await (Task)Access.Call(window,"RefreshAsync")!;
        Check(Model.Connection == "연결됨" && Model.Items.Count == 0, "G03 automatic reconciler recovery visible on refresh");
    }
    private async Task Faults()
    {
        // Supply the transient restore flag to the same presenter used by runtime.status.
        Access.Call(window, "ShowRuntimeStatus", true);
        Check(Model.Connection == "복원 중" && Access.Get<InfoBar>(window,"StatusBar").Title.Contains("복원") && Model.Updated.Contains("읽기 전용"), "G03 restoring response presentation (injected flag)");
        await (Task)Access.Call(window, "ConnectAsync")!;
        await Act("projects");
        await SelectTrialProject(Path.Combine(home, "시험 소스"));
        await Act("new");
        Field<TextBox>("TitleInput").Text = "Bridge retry acceptance";
        Field<TextBox>("GoalInput").Text = "응답이 유실된 뒤에도 같은 초안을 복원한다.";
        Field<TextBox>("ScopeInput").Text = "격리 시험의 초안 하나";
        Select("ModelChoice","provider","codex/gpt-6.1-sol"); Select("LevelChoice","id","low");
        var client = Access.Get<BridgeClient>(window,"client");
        var received = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        var writes = 0;
        var savedRevision = 0;
        var savedKey = "";
        W.Connect(async (method,input) =>
        {
            var result = await client.CallAsync(method,input);
            if (method == "desktop.requests.save")
            {
                writes++;
                savedKey = ((JsonObject)input)["commandKey"]!.ToString();
                savedRevision = result.GetProperty("revision").GetInt32();
                received.TrySetResult();
                await release.Task;
                await client.DisposeAsync();
                throw new IOException("연결이 종료되었습니다.");
            }
            return result;
        });
        var first = Access.Action(W,"save");
        await received.Task.WaitAsync(TimeSpan.FromSeconds(8));
        Access.Call(W,"Action",new Button { Tag = "save" },new RoutedEventArgs());
        release.SetResult(); await first;
        Check(writes == 1 && Field<InfoBar>("Notice").Severity == InfoBarSeverity.Warning && Field<TextBox>("GoalInput").Text.Contains("응답이 유실"), "G09 lost acknowledgement and double click retain draft");
        await (Task)Access.Call(window,"ConnectAsync")!;
        await Act("save");
        Check(Model.Connection == "연결됨" && Doc["revision"]!.GetValue<int>() == savedRevision && Doc["journals"]!.AsArray().Count(x => x?["key"]?.ToString() == savedKey) == 1, "G09 reconnect and replay persisted exactly once");
        observations["key"] = savedKey;
        var root = Access.Get<Grid>(window,"Root");
        var pages = new List<string>();
        foreach (var page in new[] { "projects","setup","home","request","plan","execution","result","apply","history","instructions","configuration" })
        {
            W.ShowPage(page);
            await Task.Delay(60);
            var firstFocus = Microsoft.UI.Xaml.Input.FocusManager.FindFirstFocusableElement(W) as Control;
            var lastFocus = Microsoft.UI.Xaml.Input.FocusManager.FindLastFocusableElement(W) as Control;
            if (firstFocus == null || lastFocus == null || !firstFocus.Focus(FocusState.Programmatic)) throw new IOException("Focus: " + page);
            pages.Add(page);
        }
        observations["focusPages"] = pages;
        Check(pages.Count == 11 && root.XamlRoot.RasterizationScale > 0, "G04/G11 first and last focus targets on 11 workspace pages");
    }

    private async Task Work(string mode)
    {
        var source = Path.Combine(home, "시험 소스");
        var output = Path.Combine(home, "결과물");
        await Act("projects");
        if (mode == "work" && Field<ListView>("ProjectChoice").Items.Count == 0)
        {
            Field<TextBox>("ProjectNameInput").Text = "D3 GUI 검증";
            Field<TextBox>("SourceInput").Text = source;
            await Act("register");
        }
        await SelectTrialProject(source);
        if (mode == "work")
        {
            await Act("preview");
            Check(Field<TextBox>("InitPreview").Text.Contains("AGENTS.md") && !File.Exists(Path.Combine(source,"docs","plans","README.md")), "G06 initialization preview before write");
            await Act("initialize");
            Check(File.Exists(Path.Combine(source,"AGENTS.md")) && Field<TextBlock>("ProjectLocation").Text == source, "G06 initialized project path and files");
            Field<TextBox>("OutputInput").Text = output;
            Field<TextBox>("BaseRefInput").Text = "main";
            await Act("configure");
            await Act("instructions");
            var selection = Field<ListView>("InstructionChoice");
            selection.SelectedIndex = 0;
            var path = Path.GetFullPath(Field<TextBox>("InstructionPath").Text, source);
            if (!path.StartsWith(source + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("instruction outside trial");
            var content = Field<TextBox>("InstructionContent");
            content.Text += "\n\n로컬 시험 기록\n";
            await Act("save-instruction");
            Check(File.ReadAllText(path).Contains("로컬 시험 기록"), "G06 instruction edit persisted");
            selection.SelectedIndex = 0;
            content.Text += "아직 저장하지 않은 문장";
            var draft = content.Text;
            File.AppendAllText(path, "\n외부 변경\n");
            await Act("save-instruction", true);
            Check(content.Text == draft && File.ReadAllText(path).EndsWith("외부 변경\n") && Field<InfoBar>("Notice").Message == DesktopViewModel.Error("FILE_CHANGED"), "G06 external conflict preserves user input and disk");
            await Act("new");
            Field<TextBox>("TitleInput").Text = "GUI acceptance";
            Field<TextBox>("GoalInput").Text = "Write answer.txt containing 42 and note.txt containing ok, both with a trailing newline.";
            Field<TextBox>("ScopeInput").Text = "Create only answer.txt and note.txt in the worktree root. Run node --test checks/value.test.mjs.";
            Field<TextBox>("ConstraintsInput").Text = "Do not modify tests, PLAN or project instructions. No commits, push, external resources or subagents.";
            Field<ComboBox>("Discipline").SelectedIndex = 1;
            Select("ModelChoice","provider","codex/gpt-6.1-sol"); Select("LevelChoice","id","low");
            Field<ComboBox>("ValidationChoice").SelectedIndex = 1;
            await Act("save");
            Check(Doc["input"]!["provider"]!.ToString() == "codex/gpt-6.1-sol" && Doc["input"]!["thinkingOptionId"]!.ToString() == "low", "G07 real model and level saved");
            await Act("plan");
            observations["token"] = Doc["token"]!.ToString();
            Check(Doc["planning"] != null, "G07 submitted real PLAN");
        }
        else
        {
            await Act("requests");
            var requests = Field<ListView>("RequestChoice");
            string title = mode == "permission" ? "GUI modification" : "GUI acceptance";
            requests.SelectedItem = requests.Items.Cast<WorkspaceChoice>().Single(x => x.Value["input"]!["title"]!.ToString() == title);
            await Access.Idle(W);
        }
        if (mode == "permission")
        {
            if (Status == "failed")
            {
                Field<TextBox>("ResumeInput").Text = "This is a local permission-dialog acceptance test in plan mode. Before choosing an example label, ask a multiple-choice question using request_user_input (Alpha or Beta). Do not change files or execute commands. If declined, finish immediately.";
                await Act("resume");
            }
            var pending = Field<ComboBox>("PermissionChoice");
            var elapsed = Stopwatch.StartNew();
            do
            {
                await Act("attention");
                if (pending.Items.Count > 0) break;
                await Task.Delay(1500);
            } while (elapsed.Elapsed < TimeSpan.FromMinutes(2));
            Check(pending.Items.Count > 0, "G09 real provider permission arrived");
            pending.SelectedIndex = 0;
            var choice = (WorkspaceChoice)pending.SelectedItem;
            observations["kind"] = choice.Value["kind"]?.ToString();
            observations["requestHash"] = choice.Value["hash"]?.ToString();
            // An opt-in disposable trial only ever declines a provider prompt.
            var actions = Field<ComboBox>("PermissionAction");
            actions.SelectedItem = actions.Items.Cast<WorkspaceChoice>().First(x => x.Value["behavior"]?.ToString() == "deny");
            Check(Field<TextBox>("PermissionDetails").Text.Length > 0, "G09 provider request details visible");
            await Act("permission", true);
            Check(Field<InfoBar>("Notice").Message.Contains("확인"), "G09 unconfirmed real decision blocked");
            await (Task)Access.Call(W,"LoadDocument",false)!;
            Field<CheckBox>("PermissionConfirmed").IsChecked = true;
            await Act("permission");
            await Act("attention");
            Check(!pending.Items.Cast<WorkspaceChoice>().Any(x => x.Value["id"]?.ToString() == choice.Value["id"]?.ToString()), "G09 confirmed decline cleared exact provider request");
            return;
        }
        if (mode == "partial")
        {
            await Act("diff");
            var diff = Field<ListView>("DiffFiles");
            diff.SelectedItem = diff.Items.Cast<WorkspaceChoice>().Single(x => x.Value["path"]!.ToString() == "answer.txt");
            var current = File.Exists(Path.Combine(source,"answer.txt")) ? File.ReadAllText(Path.Combine(source,"answer.txt")) : "";
            var exported = Path.Combine(Field<TextBlock>("ExportLocation").Text.Split('\n').Last(), "answer.txt");
            var expected = $"파일: answer.txt\n\n현재 소스\n{current}\n\n결과물\n{File.ReadAllText(exported)}";
            Check(Field<TextBox>("DiffText").Text.ReplaceLineEndings("\n") == expected.ReplaceLineEndings("\n"), "G10 selected diff matches source and exported bytes");
            await Act("transfers");
            var transfers = Field<ComboBox>("TransferChoice");
            transfers.SelectedItem = transfers.Items.Cast<WorkspaceChoice>().Single(x => x.Value["state"]?.ToString() == "applying");
            Check(File.Exists(Path.Combine(source,"answer.txt")) != File.Exists(Path.Combine(source,"note.txt")), "G10 partial write present before continue");
            await Act("continue-apply");
            Check(File.ReadAllText(Path.Combine(source,"answer.txt")).Trim() == "42" && File.ReadAllText(Path.Combine(source,"note.txt")).Trim() == "ok", "G10 continued partial transfer");
            await Act("undo");
            Check(!File.Exists(Path.Combine(source,"answer.txt")) && !File.Exists(Path.Combine(source,"note.txt")), "G10 partial transfer undo");
            return;
        }
        if (Status == "completed") await Transfer(source, output);
        else await Continue(source, output);
    }
    private void Select(string field, string key, string value)
    {
        var box = Field<ComboBox>(field);
        box.SelectedItem = box.Items.Cast<WorkspaceChoice>().Single(x => x.Value[key]?.ToString() == value);
    }
    private async Task SelectTrialProject(string source)
    {
        var projects = Field<ListView>("ProjectChoice");
        Check(projects.Items.Count == 1 && projects.Items[0] is WorkspaceChoice project &&
            string.Equals(project.SourcePath, source, StringComparison.OrdinalIgnoreCase), "G06 isolated project list");
        projects.SelectedIndex = 0;
        await Access.Idle(W);
    }
    private async Task AwaitStatus(params string[] states)
    {
        var timer = Stopwatch.StartNew();
        while (!states.Contains(Status) && timer.Elapsed.TotalMinutes < 5)
        {
            if (Status == "failed" || Doc["planning"]?["state"]?.ToString() == "failed" || Status == "needs-input") break;
            await Task.Delay(1500);
            await Access.Idle(W);
            await (Task)Access.Call(W, "LoadDocument", false)!;
        }
        observations["status"] = Field<TextBlock>("ExecutionStatus").Text;
        if (!states.Contains(Status)) throw new IOException("Expected " + string.Join("/",states) + ", observed " + observations["status"] + " " + Doc["planning"]?["error"]);
    }
    private async Task Continue(string source, string output)
    {
        if (Doc["engine"]!["agentId"] == null)
        {
            await AwaitStatus("ready");
            var path = Field<TextBlock>("PlanLocation").Text;
            var full = Path.GetFullPath(path, source);
            if (!full.StartsWith(source + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("PLAN outside trial");
            File.AppendAllText(full, "\n\nGUI verification annotation.\n");
            await Act("sync-plan");
            Check(Field<TextBox>("PlanText").Text.Contains("GUI verification annotation"), "G07 externally edited PLAN reloaded");
            Field<CheckBox>("PlanConfirmed").IsChecked = false;
            await Act("start", true);
            Field<CheckBox>("PlanConfirmed").IsChecked = true;
            await Act("start");
            Check(true, "G07 confirmed PLAN starts execution");
        }
        await AwaitStatus("awaiting-review");
        var first = Result;
        var engine = Doc["engine"]!;
        var agent = engine["agentId"]!.ToString();
        var worktree = Path.GetFullPath(engine["worktreePath"]!.ToString());
        if (!worktree.StartsWith(Path.Combine(home,"paseo") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("unexpected worktree");
        Check(engine["result"]!["checks"]!.AsArray().All(x => x!["passed"]!.GetValue<bool>()), "G08 automatic checks passed");
        Field<CheckBox>("QualityConfirmed").IsChecked = true;
        File.WriteAllText(Path.Combine(worktree,"answer.txt"), "41\n");
        await Act("revalidate");
        Check(Status == "failed" && Result != first && Field<CheckBox>("QualityConfirmed").IsChecked == false, "G08 failed validation resets result confirmation");
        Field<TextBox>("ResumeInput").Text = "Restore only answer.txt to 42 with a newline. Run the existing test. No other changes.";
        await Act("resume");
        await AwaitStatus("awaiting-review");
        Check(Doc["engine"]!["agentId"]!.ToString() == agent && Result != first, "G08 same session resumes and produces new result");
        observations["agent"] = agent; observations["result"] = Result;
        Field<CheckBox>("QualityConfirmed").IsChecked = Field<CheckBox>("ChecksConfirmed").IsChecked = true;
        Field<TextBox>("ReviewNote").Text = "Disposable test: observed both files and passing checks.";
        await Act("approve");
        Check(Status == "completed", "G08 review complete");
        await Transfer(source, output);
    }
    private async Task Transfer(string source, string output)
    {
        if (Doc["exports"]!.AsArray().Count == 0) await Act("export");
        var exported = Field<TextBlock>("ExportLocation").Text.Split('\n').Last();
        Check(Path.GetFullPath(exported).StartsWith(output + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.ReadAllText(Path.Combine(exported,"answer.txt")).Trim() == "42", "G10 exported actual file");
        await Act("diff");
        var files = Field<ListView>("DiffFiles");
        var expected = files.Items.Cast<WorkspaceChoice>().Where(x => x.Value["path"]!.ToString() is "answer.txt" or "note.txt").ToArray();
        Check(expected.Length == 2, "G10 two output paths available for selection");
        foreach (var item in expected) files.SelectedItems.Add(item);
        var conflictPath = Path.Combine(source,"answer.txt");
        using (var writer = new StreamWriter(new FileStream(conflictPath, FileMode.CreateNew, FileAccess.Write)))
            writer.Write("local edit\n");
        await Act("apply", true);
        Check(Field<InfoBar>("Notice").Message == DesktopViewModel.Error("SOURCE_FILE_CONFLICT") && File.ReadAllText(Path.Combine(source,"answer.txt")) == "local edit\n", "G10 conflict preserves local change");
        File.Delete(Path.Combine(source,"answer.txt")); // created by this test in its disposable clone
        await Act("diff");
        foreach (var item in files.Items.Cast<WorkspaceChoice>().Where(x => x.Value["path"]!.ToString() is "answer.txt" or "note.txt")) files.SelectedItems.Add(item);
        await Act("apply");
        await Act("transfers");
        Check(Field<ComboBox>("TransferChoice").Items.Count > 0 && File.ReadAllText(Path.Combine(source,"answer.txt")).Trim() == "42" && File.ReadAllText(Path.Combine(source,"note.txt")).Trim() == "ok", "G10 applied two files and read transfer history");
        await Act("undo");
        Check(!File.Exists(Path.Combine(source,"answer.txt")) && !File.Exists(Path.Combine(source,"note.txt")), "G10 undo restored original source");
        await Modification();
    }
    private async Task Modification()
    {
        observations["result"] = Result;
        await Act("requests"); await Act("new");
        Field<ComboBox>("RequestMode").SelectedIndex = 1;
        Select("ParentChoice","token",Field<ComboBox>("ParentChoice").Items.Cast<WorkspaceChoice>().Single(x => x.Value["engine"]?["result"]?["id"]?.ToString() == observations["result"]?.ToString()).Value["token"]!.ToString());
        Field<TextBox>("TitleInput").Text = "GUI modification";
        Field<TextBox>("GoalInput").Text = "Change answer.txt to 43.";
        Field<TextBox>("ScopeInput").Text = "Only change answer.txt. Keep tests intact.";
        await Act("save"); await Act("plan"); await AwaitStatus("ready");
        Check(Doc["input"]!["parentResultId"]!.ToString() == observations["result"]?.ToString(), "G07 modification PLAN bound to parent result");
        Field<CheckBox>("PlanConfirmed").IsChecked = true;
        await Act("start");
        await Wait(() => Doc["engine"]?["agentId"] != null, "modification session");
        await Act("stop");
        await AwaitStatus("failed");
        Check(Doc["journals"]!.AsArray().Any(x => x?["kind"]?.ToString() == "stop" && x["phase"]?.ToString() == "stopped"), "G08 stopped modification recorded");
    }
}
