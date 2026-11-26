using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Windows.Storage.Streams;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Media.Core;
using Button = Microsoft.UI.Xaml.Controls.Button;
using SelectionChangedEventArgs = Microsoft.UI.Xaml.Controls.SelectionChangedEventArgs;

namespace Orchiva.Desktop;

public sealed record WorkspaceChoice(string Label, JsonObject Value)
{
    public string SourcePath => Value["sourceRoot"]?.ToString() ?? "";
    public override string ToString() => Label;
}
public sealed partial class ProductionWorkspace : UserControl
{
    private Func<string, object, Task<JsonElement>>? call;
    private JsonObject? project, document, preview;
    private bool busy, loading;
    private string token = NewKey();
    private string? renderedResult, renderedPlan, diffIdentity;
    private readonly Dictionary<string, JsonObject> pendingCommands = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(4) };
    private InMemoryRandomAccessStream? mediaStream;
    private void ClearMedia() { MediaPlayer.MediaPlayer?.Pause(); MediaPlayer.Source = null; MediaImage.Source = null; mediaStream?.Dispose(); mediaStream = null; MediaPreviewInfo.Text = ""; MediaPlayer.Visibility = Visibility.Collapsed; }
    public ProductionWorkspace()
    {
        InitializeComponent();
        timer.Tick += async (_, _) => { if (!busy && document != null && IsLoaded && !Choices.Any(x => x.IsDropDownOpen)) await Run(async () => await LoadDocument(false), false); };
        ShowPage("projects");
        Loaded += (_, _) => timer.Start(); Unloaded += (_, _) => { timer.Stop(); ClearMedia(); };
    }
    private IEnumerable<ComboBox> Choices => [Discipline, RequestMode, ParentChoice, ModelChoice, LevelChoice, ValidationChoice, PermissionChoice, PermissionAction, TransferChoice];
    public event Action<string>? ConnectionFailed;
    public void Connect(Func<string, object, Task<JsonElement>> invoke) { call = invoke; Notice.Severity = InfoBarSeverity.Informational; Notice.Title = "연결됨"; Notice.Message = project == null ? "프로젝트 목록을 불러와 작업을 시작하세요." : "연결을 복구했습니다. 입력한 내용은 유지됩니다."; }
    public event Action? ConversationRequested;
    private void OpenConversation(object sender, RoutedEventArgs e) => ConversationRequested?.Invoke();
    public event Action<string>? PageChanged;
    private string currentPage = "projects";
    public void ShowPage(string page)
    {
        var pages = new Dictionary<string, (FrameworkElement Panel, string Title, string Description)>
        {
            ["projects"] = (ProjectsPage, "프로젝트", "이어갈 프로젝트를 선택하세요."),
            ["setup"] = (SetupPage, "프로젝트 연결과 초기화", "소스 경로를 등록하고 초기화할 실제 파일을 확인합니다."),
            ["home"] = (HomePage, "작업 시작", "프로젝트의 작업 분야와 요청 유형을 선택하세요."),
            ["roadmap"] = (RoadmapPage, "Milestone 자동화", "실행할 구간과 선행 작업을 확인하세요."),
            ["instructions"] = (InstructionsPage, "프로젝트 지침", "실제 파일을 읽고 수정한 내용을 같은 파일에 저장합니다."),
            ["configuration"] = (ConfigurationPage, "프로젝트 설정", "선택한 프로젝트의 기준 브랜치와 결과물 폴더를 관리합니다."),
            ["request"] = (RequestPage, RequestMode.SelectedIndex == 1 ? "기존 작업을 어떻게 바꿀까요?" : "어떤 결과가 필요한가요?", "입력을 저장하면 AI가 PLAN 템플릿의 내용을 작성합니다."),
            ["plan"] = (PlanPage, "실행할 계획을 확인하세요", "PLAN 원문과 실행 범위를 확인한 뒤 실행합니다."),
            ["execution"] = (ExecutionPage, "실행과 복구", "현재 실행 상태와 필요한 응답을 확인합니다."),
            ["result"] = (ResultPage, "결과를 검토하세요", "자동 확인 결과와 실제 품질을 함께 살펴봅니다."),
            ["apply"] = (ApplyPage, "선택한 변경만 반영합니다", "현재 소스와 결과물을 비교하고 반영 이력을 보존합니다."),
            ["history"] = (HistoryPage, "PLAN 이력", "요청부터 실행·검토·소스 반영까지 이어서 확인합니다.")
        };
        if (!pages.TryGetValue(page, out var target)) return;
        currentPage = page;
        foreach (var item in pages) item.Value.Panel.Visibility = item.Key == page ? Visibility.Visible : Visibility.Collapsed;
        PageTitle.Text = target.Title; PageDescription.Text = target.Description;
        RequestStatus.Visibility = page is "request" or "plan" or "execution" or "result" or "apply" or "history" ? Visibility.Visible : Visibility.Collapsed;
        ProjectLocation.Visibility = page is "home" or "projects" ? Visibility.Collapsed : Visibility.Visible;
        ArrangeColumns(this, ActualWidth >= 900);
        PageChanged?.Invoke(page);
    }
    private void GoPage(object sender, RoutedEventArgs e) => ShowPage(((Button)sender).Tag.ToString()!);
    private void ChooseDiscipline(object sender, RoutedEventArgs e)
    {
        if (busy) return;
        Discipline.SelectedIndex = int.Parse(((Button)sender).Tag.ToString()!);
        ShowPage("request");
    }
    private void BeginRequest(object sender, RoutedEventArgs e)
    {
        if (busy) return;
        RequestMode.SelectedIndex = int.Parse(((Button)sender).Tag.ToString()!);
        Action(new Button { Tag = "new" }, e);
        ShowPage("request");
    }
    private void WorkspaceSizeChanged(object sender, SizeChangedEventArgs e)
    {
        ArrangeColumns(this, e.NewSize.Width >= 900);
        var columns = e.NewSize.Width >= 720 ? 3 : e.NewSize.Width >= 440 ? 2 : 1;
        DisciplineCards.ItemWidth = Math.Max(1, Math.Floor(e.NewSize.Width / columns));
    }
    private void RequestModeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (PageTitle != null && currentPage == "request") PageTitle.Text = RequestMode.SelectedIndex == 1 ? "기존 작업을 어떻게 바꿀까요?" : "어떤 결과가 필요한가요?";
    }
    private static void ArrangeColumns(DependencyObject element, bool wide)
    {
        if (element is Grid grid && grid.Tag?.ToString() is "split" or "split-reverse")
        {
            var reverse = grid.Tag.ToString() == "split-reverse";
            grid.ColumnDefinitions[0].Width = new GridLength(wide && !reverse ? 2 : 1, GridUnitType.Star);
            grid.ColumnDefinitions[1].Width = wide ? new GridLength(reverse ? 2 : 1, GridUnitType.Star) : new GridLength(0);
            Grid.SetColumn((FrameworkElement)grid.Children[1], wide ? 1 : 0); Grid.SetRow((FrameworkElement)grid.Children[1], wide ? 0 : 1);
        }
        for (var i = 0; i < Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChildrenCount(element); i++)
            ArrangeColumns(Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChild(element, i), wide);
    }
    private static string NewKey() => Guid.NewGuid().ToString("N");
    private static string Text(JsonNode? value, string key) => value?[key]?.ToString() ?? "";
    private static JsonObject Copy(JsonObject value) => (JsonObject)value.DeepClone();
    private string ProjectId => Text(project, "projectId");
    private string? ResultId => document?["engine"]?["result"]?["id"]?.ToString();
    private async Task<JsonNode> Invoke(string method, object input)
    {
        if (call == null) throw new IOException("먼저 연결 상태 화면에서 실행부에 연결하세요.");
        return JsonNode.Parse((await call(method, input)).GetRawText())!;
    }
    private JsonObject Identity() { if (project == null) throw new IOException("프로젝트를 선택하세요."); return new() { ["projectId"] = ProjectId, ["token"] = token }; }
    private JsonObject Command() { var result = Identity(); result["expectedRevision"] = document?["revision"]?.DeepClone() ?? JsonValue.Create(0); return result; }
    private async Task<JsonNode> Mutate(string method, JsonObject input)
    {
        var identity = Copy(input); identity.Remove("expectedRevision");
        var signature = method + identity.ToJsonString();
        if (!pendingCommands.TryGetValue(signature, out var pending)) { pending = Copy(input); pending["commandKey"] = NewKey(); pendingCommands[signature] = pending; }
        // A timeout retains this exact command key. A retry never invents a new effect.
        try { var result = await Invoke(method, pending); pendingCommands.Remove(signature); return result; }
        catch (IOException error) when (error.Message is "REVISION_CONFLICT" or "FILE_CHANGED" or "PLAN_EXTERNAL_CHANGE" or "PLAN_INPUT_CHANGED" or "PLAN_STALE" or "GLOBAL_EXECUTION_BUSY" or "PLANNING_IN_PROGRESS" or "REVIEW_NOT_READY" or "SOURCE_FILE_CONFLICT" or "INITIALIZATION_STALE") { pendingCommands.Remove(signature); throw; }
    }
    private async Task Run(Func<Task> action, bool announce = true)
    {
        if (busy) return; busy = true;
        if (announce) { Busy.Visibility = Visibility.Visible; ProjectChoice.IsEnabled = RequestChoice.IsEnabled = InstructionChoice.IsEnabled = false; }
        try { await action(); if (announce) { Notice.Severity = InfoBarSeverity.Success; Notice.Title = "반영됨"; Notice.Message = "최신 파일과 실행 상태를 확인했습니다."; } }
        catch (Exception e)
        {
            Notice.Severity = InfoBarSeverity.Warning; Notice.Title = "확인 필요 · 입력 유지"; Notice.Message = DesktopViewModel.Error(e.Message);
            if (e is OperationCanceledException || e.Message is "CONNECTION_FAILED" or "HANDSHAKE_REQUIRED" or "BRIDGE_CLOSED" or "TIMEOUT" || e.Message.StartsWith("연결이 종료")) ConnectionFailed?.Invoke(Notice.Message);
        }
        finally { busy = false; Busy.Visibility = Visibility.Collapsed; ProjectChoice.IsEnabled = RequestChoice.IsEnabled = InstructionChoice.IsEnabled = true; }
    }
    private async void Action(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        var action = (sender as Button)?.Tag?.ToString();
        switch (action)
        {
            case "run-list": await ReadRuns(); break;
            case "run-rerun": await CreateMilestoneRun(true); break;
            case "git-policy": ApplyGitPolicy(await Invoke("desktop.integration.policy",new {projectId=ProjectId})); break;
            case "git-configure": case "git-advance": case "git-read": case "git-publish": case "git-observe": case "git-merge": case "git-adopt": case "git-overwrite": case "git-owner-merge": case "git-refresh-base":
                await GitAction(action); break;
            case "run-create": await CreateMilestoneRun(false); break;
            case "run-read": await ReadMilestoneRun(); break;
            case "phase-approve": await DecidePhase("approve"); break;
            case "phase-reject": await DecidePhase("reject"); break;
            case "unity-plan": await VerifyUnity("plan"); break;
            case "unity-integration": await VerifyUnity("integration"); break;
            case "run-cancel": await ControlMilestoneRun("cancel"); break;
            case "run-pause": await ControlMilestoneRun("pause"); break;
            case "run-resume": await ControlMilestoneRun("resume"); break;
            case "run-node":
                if (loadedProject != ProjectId || RunNode.SelectedItem is not WorkspaceChoice n) throw new IOException("현재 실행에서 Feature를 선택하세요.");
                token = Text(n.Value,"token"); await LoadDocument(true); ShowPage(ResultId == null ? "plan" : "result"); break;
            case "roadmap-open": await OpenRoadmap(); break;
            case "roadmap-save": await SaveRoadmap(); break;
            case "roadmap-preview": await PreviewRoadmap(); break;
            case "media-preview": await PreviewMedia(); break;
            case "projects": await LoadProjects(); break;
            case "register": await Invoke("desktop.projects.register", new { name = ProjectNameInput.Text, sourceRoot = SourceInput.Text }); await LoadProjects(); break;
            case "preview":
                preview = (JsonObject)await Invoke("desktop.projects.preview", new { projectId = ProjectId });
                InitPreview.Text = string.Join("\n\n", preview["changes"]!.AsArray().Select(x => $"{Text(x, "path")} · {Text(x, "reason")}\n{Text(x, "content")}")) + "\n" + preview["issues"]!.ToJsonString();
                InitializeButton.IsEnabled = preview["issues"]!.AsArray().Count == 0; break;
            case "initialize":
                if (preview == null || Text(preview, "projectId") != ProjectId) throw new IOException("초기화 변경 내용을 먼저 확인하세요.");
                project = (JsonObject)await Mutate("desktop.projects.initialize", new() { ["projectId"] = ProjectId, ["fingerprint"] = preview["fingerprint"]!.DeepClone() });
                InitializeButton.IsEnabled = false; preview = null; await LoadProject(); await RefreshProjectLabel(); break;
            case "configure":
                project = (JsonObject)await Invoke("desktop.projects.configure", new { projectId = ProjectId, expectedRevision = project?["config"]?["revision"]?.GetValue<int>() ?? 0, name = ProjectNameInput.Text, baseRef = BaseRefInput.Text, outputRoot = string.IsNullOrWhiteSpace(OutputInput.Text) ? null : OutputInput.Text }); await RefreshProjectLabel(); break;
            case "instructions": await LoadInstructions(); break;
            case "save-instruction":
                var selected = (InstructionChoice.SelectedItem as WorkspaceChoice)?.Value;
                var expected = Text(selected, "path") == InstructionPath.Text ? selected?["hash"]?.DeepClone() : null;
                var report = await Invoke("desktop.instructions.save", new JsonObject { ["projectId"] = ProjectId, ["path"] = InstructionPath.Text, ["expectedHash"] = expected, ["content"] = InstructionContent.Text, ["scope"] = InstructionScope.Text }); SetInstructions(report); break;
            case "requests": await LoadRequests(); break;
            case "import-legacy": await Mutate("desktop.requests.import-legacy", new() { ["projectId"] = ProjectId, ["token"] = LegacyToken.Text }); await LoadRequests(); break;
            case "new": ClearPresentation(); ClearMedia(); MediaPreviewPanel.Visibility = Visibility.Collapsed; document = null; token = NewKey(); RequestChoice.SelectedIndex = -1; TitleInput.Text = GoalInput.Text = ScopeInput.Text = ConstraintsInput.Text = ""; PlanText.Text = ResultText.Text = PlanLocation.Text = ExportLocation.Text = ExecutionStatus.Text = ""; renderedPlan = renderedResult = diffIdentity = null; DiffFiles.ItemsSource = TransferChoice.ItemsSource = null; DiffText.Text = TransferKey.Text = ""; RequestStatus.Text = "새 초안 · 아직 저장하지 않았습니다."; PlanConfirmed.IsChecked = QualityConfirmed.IsChecked = ChecksConfirmed.IsChecked = false; break;
            case "save":
                var draft = Command(); draft["input"] = Input(); document = (JsonObject)await Mutate("desktop.requests.save", draft); RenderDocument(false); break;
            case "plan": RequireSavedInput(); await DocumentMutation("plan"); break;
            case "sync-plan": await DocumentMutation("sync-plan"); break;
            case "stop": await DocumentMutation("stop"); break;
            case "attention": var attention = (await Invoke("desktop.requests.attention", Identity())).AsArray(); PermissionChoice.ItemsSource = attention.Select(x => new WorkspaceChoice(Text(x, "title"), Copy(x!.AsObject()))).ToList(); PermissionConfirmed.IsChecked = false; break;
            case "permission":
                if (PermissionChoice.SelectedItem is not WorkspaceChoice permission || PermissionAction.SelectedItem is not WorkspaceChoice decision || PermissionConfirmed.IsChecked != true) throw new IOException("요청과 처리 방법을 먼저 확인하세요.");
                var answer = Command(); answer["requestId"] = permission.Value["id"]!.DeepClone(); answer["requestHash"] = permission.Value["hash"]!.DeepClone(); answer["actionId"] = decision.Value["id"]!.DeepClone(); answer["behavior"] = decision.Value["behavior"]!.DeepClone(); document = (JsonObject)await Mutate("desktop.requests.permission", answer); PermissionConfirmed.IsChecked = false; RenderDocument(false); break;
            case "observe": await Invoke("desktop.requests.observe", Identity()); await LoadDocument(false); break;
            case "start":
                RequireSavedInput();
                if (PlanConfirmed.IsChecked != true) throw new IOException("PLAN 내용을 확인하고 확인란을 선택하세요.");
                var start = Command(); start["planHash"] = document?["planVersions"]?.AsArray().LastOrDefault()?["hash"]?.DeepClone(); document = (JsonObject)await Mutate("desktop.requests.start", start); RenderDocument(false); break;
            case "approve": case "reject":
                var review = Command(); review["resultId"] = ResultId; review["approved"] = action == "approve"; review["qualityConfirmed"] = QualityConfirmed.IsChecked == true; review["checksAcknowledged"] = ChecksConfirmed.IsChecked == true; review["note"] = ReviewNote.Text;
                document = (JsonObject)await Mutate("desktop.requests.review", review); RenderDocument(false); break;
            case "resume": case "revalidate": case "reconcile": case "retry":
                var recovery = Command();
                if (action is "resume" or "revalidate") recovery["resultId"] = ResultId;
                if (action == "resume") recovery["instruction"] = ResumeInput.Text;
                if (action is "reconcile" or "retry") recovery["targetCommandKey"] = document?["engine"]?["commands"]?.AsArray().LastOrDefault(x => Text(x, "status") == (action == "reconcile" ? "unknown" : "failed"))?["key"]?.DeepClone();
                document = (JsonObject)await Mutate("desktop.requests." + action, recovery); RenderDocument(false); break;
            case "export": var export = Command(); export["resultId"] = ResultId; document = (JsonObject)await Mutate("desktop.requests.export", export); RenderDocument(false); break;
            case "diff":
                await LoadDocument(false);
                var identity = Identity(); identity["resultId"] = ResultId; var diff = await Invoke("desktop.requests.diff", identity);
                diffIdentity = ProjectId + ":" + ResultId;
                DiffFiles.ItemsSource = diff["files"]!.AsArray().Select(x => new WorkspaceChoice($"{Text(x, "path")} · {(x!["conflict"]!.GetValue<bool>() ? "충돌" : "반영 가능")}", Copy(x.AsObject()))).ToList(); break;
            case "apply":
                if (diffIdentity != ProjectId + ":" + ResultId) throw new IOException("현재 결과의 소스 차이를 다시 확인하세요.");
                var apply = Command(); apply["resultId"] = ResultId; apply["paths"] = new JsonArray(DiffFiles.SelectedItems.Cast<WorkspaceChoice>().Select(x => JsonValue.Create(Text(x.Value, "path"))).ToArray());
                var applied = await Mutate("desktop.requests.apply", apply); TransferKey.Text = Text(applied, "key"); await LoadTransfers(); break;
            case "undo": var undo = Identity(); undo["resultId"] = ResultId; undo["transferKey"] = TransferKey.Text; await Invoke("desktop.requests.undo", undo); await LoadTransfers(); break;
            case "continue-apply":
                if (TransferChoice.SelectedItem is not WorkspaceChoice transfer || Text(transfer.Value, "state") != "applying") throw new IOException("이력에서 미완료 반영 작업을 선택하세요.");
                var retryApply = Command(); retryApply["resultId"] = ResultId; retryApply["commandKey"] = transfer.Value["key"]!.DeepClone(); retryApply["paths"] = transfer.Value["paths"]!.DeepClone(); await Invoke("desktop.requests.apply", retryApply); await LoadTransfers(); break;
            case "transfers": await LoadTransfers(); break;
        }
        if (action is "new" or "register" or "plan" or "start")
            ShowPage(action switch { "new" => "request", "register" => "projects", "plan" => "plan", _ => "execution" });
    });
    private async Task PreviewMedia()
    {
        ClearMedia();
        var spec = document?["input"]?["media"] ?? throw new IOException("미디어 결과를 먼저 선택하세요.");
        var sound = Text(spec, "kind") == "sound";
        var name = sound ? "tone.wav" : Text(spec, "kind") == "art" ? "shape.png" : "effect.png";
        var request = Identity(); request["resultId"] = ResultId; request["path"] = $"media/{token}/{name}";
        using var content = new MemoryStream(); string? expected = null; int size = 0;
        do
        {
            request["offset"] = content.Length;
            var chunk = await Invoke("desktop.requests.media-preview", request);
            var hash = Text(chunk, "sha256"); var length = chunk["size"]!.GetValue<int>();
            if (length > 32 * 1024 * 1024 || length <= 0 || (expected != null && (expected != hash || size != length))) throw new IOException("RESULT_CHANGED");
            expected = hash; size = length;
            var data = Convert.FromBase64String(Text(chunk, "content"));
            if (data.Length == 0 || content.Length + data.Length > size) throw new IOException("RESULT_CHANGED");
            content.Write(data);
        } while (content.Length < size);
        var bytes = content.ToArray();
        if (Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != expected) throw new IOException("RESULT_CHANGED");
        mediaStream = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(mediaStream.GetOutputStreamAt(0))) { writer.WriteBytes(bytes); await writer.StoreAsync(); await writer.FlushAsync(); writer.DetachStream(); }
        mediaStream.Seek(0);
        if (sound) { MediaPlayer.Source = MediaSource.CreateFromStream(mediaStream, "audio/wav"); MediaPlayer.Visibility = Visibility.Visible; }
        else { var bitmap = new BitmapImage(); await bitmap.SetSourceAsync(mediaStream); MediaImage.Source = bitmap; }
        MediaPreviewInfo.Text = $"{name} · {size:N0} 바이트 · " + (sound ? $"{Text(spec, "sampleRate")} Hz · {Text(spec, "channels")} 채널 · {Text(spec, "seconds")}초 · 재생 버튼으로 청취" : $"{Text(spec, "width")} × {Text(spec, "height")}" + (Text(spec, "kind") == "effect" ? $" / 프레임 · {Text(spec, "frames")}개 가로 시트 · {Text(spec, "seconds")}초 (애니메이션 재생 아님)" : " · 투명 배경은 어두운 바탕으로 표시"));
    }
    private async Task LoadTransfers()
    {
        var selected = TransferKey.Text;
        var history = Identity(); history["resultId"] = ResultId;
        var transfers = (await Invoke("desktop.requests.transfers", history)).AsArray();
        var values = transfers.Select(x => new WorkspaceChoice($"{Text(x, "key")} · {DesktopViewModel.Status(Text(x, "state"))}", Copy(x!.AsObject()))).ToList();
        TransferChoice.ItemsSource = values;
        TransferChoice.SelectedItem = values.FirstOrDefault(x => Text(x.Value, "key") == selected);
    }
    private async Task DocumentMutation(string name) { document = (JsonObject)await Mutate("desktop.requests." + name, Command()); RenderDocument(false); }
    private void RequireSavedInput() { if (document == null || !JsonNode.DeepEquals(Input(), document["input"])) throw new IOException("현재 입력을 먼저 저장하세요. 저장 후 PLAN을 작성하고 확인합니다."); }
    private JsonObject Input()
    {
        if (Discipline.SelectedIndex >= 2)
        {
            if (Discipline.SelectedIndex != 3 && (!double.IsFinite(MediaWidth.Value) || !double.IsFinite(MediaHeight.Value) || MediaWidth.Value % 1 != 0 || MediaHeight.Value % 1 != 0 || !System.Text.RegularExpressions.Regex.IsMatch(MediaColor.Text, "^#[0-9a-fA-F]{6}$"))) throw new IOException("이미지 크기는 정수, 색상은 #RRGGBB 형식으로 입력하세요.");
            if (Discipline.SelectedIndex >= 3 && !double.IsFinite(MediaSeconds.Value)) throw new IOException("길이를 숫자로 입력하세요.");
            if (Discipline.SelectedIndex == 3 && !double.IsFinite(MediaFrequency.Value)) throw new IOException("주파수를 숫자로 입력하세요.");
            if (Discipline.SelectedIndex == 4 && (!double.IsFinite(MediaFrames.Value) || MediaFrames.Value % 1 != 0)) throw new IOException("프레임 수는 정수로 입력하세요.");
        }
        var parent = (ParentChoice.SelectedItem as WorkspaceChoice)?.Value;
        var value = new JsonObject { ["title"] = TitleInput.Text, ["goal"] = GoalInput.Text, ["scope"] = ScopeInput.Text, ["constraints"] = ConstraintsInput.Text, ["discipline"] = Discipline.SelectedIndex switch { 0 => "planning", 1 => "coding", 2 => "art", 3 => "sound", _ => "effect" }, ["mode"] = RequestMode.SelectedIndex == 0 ? "new" : "modify", ["parentToken"] = RequestMode.SelectedIndex == 0 ? null : parent?["token"]?.DeepClone(), ["parentResultId"] = RequestMode.SelectedIndex == 0 ? null : parent?["engine"]?["result"]?["id"]?.DeepClone(), ["provider"] = (ModelChoice.SelectedItem as WorkspaceChoice)?.Value["provider"]?.DeepClone() ?? JsonValue.Create("codex/unavailable"), ["thinkingOptionId"] = (LevelChoice.SelectedItem as WorkspaceChoice)?.Value["id"]?.DeepClone(), ["outputPath"] = OutputPathInput.Text, ["validationProfile"] = ValidationChoice.SelectedIndex == 0 ? "files" : "node-test" };
        if (Discipline.SelectedIndex >= 2)
        {
            value["validationProfile"] = "files";
            value["media"] = Discipline.SelectedIndex switch
            {
                2 => new JsonObject { ["kind"]="art", ["format"]="png", ["width"]=MediaWidth.Value, ["height"]=MediaHeight.Value, ["color"]=MediaColor.Text, ["shape"]="circle", ["transparent"]=true },
                3 => new JsonObject { ["kind"]="sound", ["format"]="wav", ["seconds"]=MediaSeconds.Value, ["frequency"]=MediaFrequency.Value, ["sampleRate"]="44100", ["channels"]=1, ["waveform"]="sine", ["fade"]=true },
                _ => new JsonObject { ["kind"]="effect", ["format"]="png-sheet", ["width"]=MediaWidth.Value, ["height"]=MediaHeight.Value, ["color"]=MediaColor.Text, ["frames"]=MediaFrames.Value, ["seconds"]=MediaSeconds.Value }
            };
        }
        return value;
    }
    private void MediaDisciplineChanged(object sender, SelectionChangedEventArgs e)
    {
        if (MediaSettings == null) return;
        MediaSettings.Visibility = Discipline.SelectedIndex >= 2 ? Visibility.Visible : Visibility.Collapsed;
        if (ValidationChoice != null) { ValidationChoice.IsEnabled = Discipline.SelectedIndex < 2; if (Discipline.SelectedIndex >= 2) ValidationChoice.SelectedIndex = 0; }
    }
    private void RestoreMedia(JsonNode? media)
    {
        if (media == null) return;
        if (media["width"] != null) MediaWidth.Value = media["width"]!.GetValue<double>();
        if (media["height"] != null) MediaHeight.Value = media["height"]!.GetValue<double>();
        if (media["color"] != null) MediaColor.Text = media["color"]!.ToString();
        if (media["seconds"] != null) MediaSeconds.Value = media["seconds"]!.GetValue<double>();
        if (media["frequency"] != null) MediaFrequency.Value = media["frequency"]!.GetValue<double>();
        if (media["frames"] != null) MediaFrames.Value = media["frames"]!.GetValue<double>();
    }
    private async Task LoadProjects()
    {
        var values = (await Invoke("desktop.projects.list", new { })).AsArray(); loading = true;
        ProjectChoice.ItemsSource = values.Select(x => new WorkspaceChoice($"{Text(x, "name")} · {(x!["initialized"]!.GetValue<bool>() ? "준비됨" : "초기화 필요")}", Copy(x.AsObject()))).ToList(); loading = false;
        ProjectListHint.Text = values.Count == 0 ? "등록된 프로젝트가 없습니다. 프로젝트 추가에서 소스 경로를 연결하세요." : "";
        ProjectListHint.Visibility = values.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }
    private async Task RefreshProjectLabel()
    {
        var id = ProjectId;
        await LoadProjects();
        loading = true;
        try { ProjectChoice.SelectedItem = (ProjectChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "projectId") == id); }
        finally { loading = false; }
    }
    private async void ProjectSelected(object sender, SelectionChangedEventArgs e)
    {
        if (loading || ProjectChoice.SelectedItem is not WorkspaceChoice value) return;
        await Run(async () => { project = Copy(value.Value); ClearMedia(); MediaPreviewPanel.Visibility = Visibility.Collapsed; document = null; ClearPresentation(); token = NewKey(); preview = null; InitializeButton.IsEnabled = false; await LoadProject(); ShowPage(project?["initialized"]?.GetValue<bool>() == true ? "home" : "setup"); });
    }
    private void ClearPresentation()
    {
        PlanSummary.Text = "저장한 요청의 PLAN을 확인하세요.";
        ResultCards.ItemsSource = new[] { new Presentation.DetailCard("아직 결과가 없습니다", "PLAN 이력에서 작업을 선택하거나 새 요청을 작성하세요.") };
        HistorySummary.Text = "이력에서 작업을 선택하세요.";
    }
    private async Task LoadProject()
    {
        ProjectLocation.Text = Text(project, "sourceRoot"); ProjectNameInput.Text = Text(project, "name"); SourceInput.Text = Text(project, "sourceRoot"); BaseRefInput.Text = Text(project?["config"], "baseRef");
        var output = Text(project?["config"], "outputRoot"); OutputInput.Text = output.Length == 0 ? "" : Path.GetFullPath(Path.Combine(SourceInput.Text, output));
        HomeProject.Text = Text(project, "name") + "\n소스: " + SourceInput.Text + "\n결과물: " + (OutputInput.Text.Length == 0 ? "아직 지정하지 않았습니다." : OutputInput.Text);
        if (project?["initialized"]?.GetValue<bool>() == true)
        {
            await LoadInstructions(); await LoadRequests();
            var catalog = await Invoke("desktop.models", new { projectId = ProjectId });
            ModelChoice.ItemsSource = catalog["models"]!.AsArray().Select(x => new WorkspaceChoice(Text(x, "label"), Copy(x!.AsObject()))).ToList(); ModelChoice.SelectedIndex = 0;
            if (catalog["ready"]?.GetValue<bool>() != true) throw new IOException("모델 목록을 읽지 못했습니다. 실행부와 Codex 로그인을 확인하세요.");
        }
    }
    private async Task LoadInstructions() => SetInstructions(await Invoke("desktop.instructions.read", new { projectId = ProjectId }));
    private void SetInstructions(JsonNode report)
    {
        InstructionChoice.ItemsSource = report["files"]!.AsArray().Select(x => new WorkspaceChoice(Text(x, "path") + (x!["exists"]!.GetValue<bool>() ? "" : " · 누락"), Copy(x.AsObject()))).ToList();
        Notice.Message = report["ready"]!.GetValue<bool>() ? "등록 지침과 루트 지도 연결을 확인했습니다." : report["issues"]!.ToJsonString();
    }
    private void InstructionSelected(object sender, SelectionChangedEventArgs e)
    {
        if (InstructionChoice.SelectedItem is not WorkspaceChoice item) return;
        InstructionPath.Text = Text(item.Value, "path"); InstructionScope.Text = Text(item.Value, "scope"); InstructionContent.Text = Text(item.Value, "content");
    }
    private async Task LoadRequests()
    {
        var result = await Invoke("desktop.requests.list", new { projectId = ProjectId }); loading = true;
        var values = result["records"]!.AsArray().Select(x => new WorkspaceChoice($"{Text(x?["input"], "title")} · {DesktopViewModel.Status(Text(x?["engine"], "status"))}", Copy(x!.AsObject()))).ToList();
        RequestChoice.ItemsSource = values; ParentChoice.ItemsSource = values; loading = false;
        RequestListHint.Text = values.Count == 0 ? "저장된 요청이 없습니다. 새 요청을 작성해 PLAN을 시작하세요." : "";
        RequestListHint.Visibility = values.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (result["issues"]!.AsArray().Count > 0) throw new IOException("읽을 수 없는 요청 파일: " + result["issues"]!.ToJsonString());
    }
    private async void RequestSelected(object sender, SelectionChangedEventArgs e)
    {
        if (loading || RequestChoice.SelectedItem is not WorkspaceChoice choice) return;
        await Run(async () => { token = Text(choice.Value, "token"); await LoadDocument(true); });
    }
    private async Task LoadDocument(bool fields)
    {
        var previousResult = ResultId; var previousPlan = document?["planVersions"]?.AsArray().LastOrDefault()?["hash"]?.ToString();
        document = (JsonObject)await Invoke("desktop.requests.get", Identity());
        if (previousResult != ResultId) QualityConfirmed.IsChecked = ChecksConfirmed.IsChecked = false;
        if (previousPlan != document["planVersions"]?.AsArray().LastOrDefault()?["hash"]?.ToString()) PlanConfirmed.IsChecked = false;
        RenderDocument(fields);
    }
    private void RenderDocument(bool fields)
    {
        if (document == null) return;
        var engine = document["engine"]!; var versions = document["planVersions"]!.AsArray();
        var planHash = Text(versions.LastOrDefault(), "hash");
        if (renderedResult != ResultId) { QualityConfirmed.IsChecked = ChecksConfirmed.IsChecked = false; renderedResult = ResultId; ClearMedia(); }
        MediaPreviewPanel.Visibility = document["input"]?["media"] != null && ResultId != null ? Visibility.Visible : Visibility.Collapsed;
        if (renderedPlan != planHash) { PlanConfirmed.IsChecked = false; renderedPlan = planHash; }
        RequestStatus.Text = $"{DesktopViewModel.Status(Text(engine, "status"))} · 저장 버전 {document["revision"]} · {token}\nPLAN 작성: {DesktopViewModel.Status(Text(document["planning"], "state"))} {Text(document["planning"], "error")}";
        ExecutionStatus.Text = RequestStatus.Text + "\n" + Text(engine, "error") + "\n" + Text(engine, "observationError");
        ExecutionStatus.Text += "\n" + string.Join("\n", document["journals"]!.AsArray().Where(x => Text(x, "state") is "pending" or "unknown").Select(x => $"{Text(x, "kind")} · {Text(x, "state")} · 확인 대기"));
        PlanText.Text = Text(versions.LastOrDefault(), "content"); PlanLocation.Text = Text(versions.LastOrDefault(), "path");
        ResultText.Text = string.Join("\n\n────────\n\n", engine["results"]!.AsArray().Reverse().Select(FormatResult)) + "\n\n검토 이력\n" + string.Join("\n", document["reviews"]!.AsArray().Select(x => $"{Text(x, "at")} · {(x?["approved"]?.GetValue<bool>() == true ? "완료 승인" : "수정 필요")}\n{Text(x, "note")}"));
        ExportLocation.Text = string.Join("\n", document["exports"]!.AsArray().Select(x => Text(x, "root")));
        PlanSummary.Text = Presentation.WorkspacePresentation.PlanSummary(document);
        ResultCards.ItemsSource = Presentation.WorkspacePresentation.ResultCards(document);
        HistorySummary.Text = Presentation.WorkspacePresentation.History(document);
        if (!fields) return;
        var input = document["input"]!; TitleInput.Text = Text(input, "title"); GoalInput.Text = Text(input, "goal"); ScopeInput.Text = Text(input, "scope"); ConstraintsInput.Text = Text(input, "constraints"); OutputPathInput.Text = Text(input, "outputPath"); Discipline.SelectedIndex = Text(input, "discipline") switch { "planning" => 0, "art" => 2, "sound" => 3, "effect" => 4, _ => 1 }; RestoreMedia(input["media"]); RequestMode.SelectedIndex = Text(input, "mode") == "new" ? 0 : 1; ValidationChoice.SelectedIndex = Text(input, "validationProfile") == "files" ? 0 : 1;
        ModelChoice.SelectedItem = (ModelChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "provider") == Text(input, "provider"));
        LevelChoice.SelectedItem = (LevelChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "id") == Text(input, "thinkingOptionId"));
        ParentChoice.SelectedItem = (ParentChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "token") == Text(input, "parentToken"));
        if (currentPage == "request") ShowPage("request");
    }
    private static string FormatResult(JsonNode? result)
    {
        var checks = result?["checks"]?.AsArray().Select(x => $"{Text(x, "label")} · {DesktopViewModel.Status(Text(x, "status"))}\n명령: {Text(x, "command")}\n종료 코드: {Text(x, "exitCode")}\n{Text(x, "output")}") ?? [];
        var files = result?["changedFiles"]?.AsArray().Select(x => x?.ToString()) ?? [];
        return $"결과 {Text(result, "id")}\n{Text(result, "finalResponse")}\n\n변경 파일\n{string.Join("\n", files)}\n\n자동 검사\n{string.Join("\n", checks)}\n실행 실패: {Text(result, "executionFailure")}\n검증 오류: {Text(result, "failure")}";
    }
    private void ModelSelected(object sender, SelectionChangedEventArgs e)
    {
        if (ModelChoice.SelectedItem is not WorkspaceChoice item) return;
        LevelChoice.ItemsSource = item.Value["levels"]!.AsArray().Select(x => new WorkspaceChoice(Text(x, "label"), Copy(x!.AsObject()))).ToList(); LevelChoice.SelectedIndex = 0;
    }
    private void DiffSelected(object sender, SelectionChangedEventArgs e)
    {
        var file = e.AddedItems.OfType<WorkspaceChoice>().LastOrDefault() ?? DiffFiles.SelectedItem as WorkspaceChoice;
        DiffText.Text = file == null ? "" : $"파일: {Text(file.Value, "path")}\n\n현재 소스\n{Text(file.Value, "beforeText")}\n\n결과물\n{Text(file.Value, "afterText")}";
    }
    private void TransferSelected(object sender, SelectionChangedEventArgs e) { if (TransferChoice.SelectedItem is WorkspaceChoice item) TransferKey.Text = Text(item.Value, "key"); }
    private void PermissionSelected(object sender, SelectionChangedEventArgs e) { if (PermissionChoice.SelectedItem is not WorkspaceChoice item) return; PermissionDetails.Text = Text(item.Value, "details"); PermissionAction.ItemsSource = item.Value["actions"]!.AsArray().Select(x => new WorkspaceChoice(Text(x, "label"), Copy(x!.AsObject()))).ToList(); PermissionConfirmed.IsChecked = false; }
}
