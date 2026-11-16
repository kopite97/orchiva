using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Text.Json;
using System.Text.Json.Nodes;
using Button = Microsoft.UI.Xaml.Controls.Button;
using SelectionChangedEventArgs = Microsoft.UI.Xaml.Controls.SelectionChangedEventArgs;

namespace Orchiva.Desktop;

public sealed record WorkspaceChoice(string Label, JsonObject Value);
public sealed partial class ProductionWorkspace : UserControl
{
    private Func<string, object, Task<JsonElement>>? call;
    private JsonObject? project, document, preview;
    private bool busy, loading;
    private string token = NewKey();
    private string? renderedResult, renderedPlan, diffIdentity;
    private readonly Dictionary<string, JsonObject> pendingCommands = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(4) };
    public ProductionWorkspace()
    {
        InitializeComponent();
        timer.Tick += async (_, _) => { if (!busy && document != null && IsLoaded && !Choices.Any(x => x.IsDropDownOpen)) await Run(async () => await LoadDocument(false), false); };
        Loaded += (_, _) => timer.Start(); Unloaded += (_, _) => timer.Stop();
    }
    private IEnumerable<ComboBox> Choices => [ProjectChoice, RequestChoice, InstructionChoice, Discipline, RequestMode, ParentChoice, ModelChoice, LevelChoice, ValidationChoice, PermissionChoice, PermissionAction, TransferChoice];
    public event Action<string>? ConnectionFailed;
    public void Connect(Func<string, object, Task<JsonElement>> invoke) { call = invoke; Notice.Severity = InfoBarSeverity.Informational; Notice.Title = "연결됨"; Notice.Message = project == null ? "프로젝트 목록을 불러와 작업을 시작하세요." : "연결을 복구했습니다. 입력한 내용은 유지됩니다."; }
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
            case "new": document = null; token = NewKey(); RequestChoice.SelectedIndex = -1; TitleInput.Text = GoalInput.Text = ScopeInput.Text = ConstraintsInput.Text = ""; PlanText.Text = ResultText.Text = ""; RequestStatus.Text = "새 초안 · 아직 저장하지 않았습니다."; PlanConfirmed.IsChecked = QualityConfirmed.IsChecked = ChecksConfirmed.IsChecked = false; break;
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
    });
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
        var parent = (ParentChoice.SelectedItem as WorkspaceChoice)?.Value;
        return new() { ["title"] = TitleInput.Text, ["goal"] = GoalInput.Text, ["scope"] = ScopeInput.Text, ["constraints"] = ConstraintsInput.Text, ["discipline"] = Discipline.SelectedIndex == 0 ? "planning" : "coding", ["mode"] = RequestMode.SelectedIndex == 0 ? "new" : "modify", ["parentToken"] = RequestMode.SelectedIndex == 0 ? null : parent?["token"]?.DeepClone(), ["parentResultId"] = RequestMode.SelectedIndex == 0 ? null : parent?["engine"]?["result"]?["id"]?.DeepClone(), ["provider"] = (ModelChoice.SelectedItem as WorkspaceChoice)?.Value["provider"]?.DeepClone() ?? JsonValue.Create("codex/unavailable"), ["thinkingOptionId"] = (LevelChoice.SelectedItem as WorkspaceChoice)?.Value["id"]?.DeepClone(), ["outputPath"] = OutputPathInput.Text, ["validationProfile"] = ValidationChoice.SelectedIndex == 0 ? "files" : "node-test" };
    }
    private async Task LoadProjects()
    {
        var values = (await Invoke("desktop.projects.list", new { })).AsArray(); loading = true;
        ProjectChoice.ItemsSource = values.Select(x => new WorkspaceChoice($"{Text(x, "name")} · {(x!["initialized"]!.GetValue<bool>() ? "준비됨" : "초기화 필요")}", Copy(x.AsObject()))).ToList(); loading = false;
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
        await Run(async () => { project = Copy(value.Value); document = null; token = NewKey(); preview = null; InitializeButton.IsEnabled = false; await LoadProject(); });
    }
    private async Task LoadProject()
    {
        ProjectLocation.Text = Text(project, "sourceRoot"); ProjectNameInput.Text = Text(project, "name"); SourceInput.Text = Text(project, "sourceRoot"); BaseRefInput.Text = Text(project?["config"], "baseRef");
        var output = Text(project?["config"], "outputRoot"); OutputInput.Text = output.Length == 0 ? "" : Path.GetFullPath(Path.Combine(SourceInput.Text, output));
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
        if (renderedResult != ResultId) { QualityConfirmed.IsChecked = ChecksConfirmed.IsChecked = false; renderedResult = ResultId; }
        if (renderedPlan != planHash) { PlanConfirmed.IsChecked = false; renderedPlan = planHash; }
        RequestStatus.Text = $"{DesktopViewModel.Status(Text(engine, "status"))} · 저장 버전 {document["revision"]} · {token}\nPLAN 작성: {DesktopViewModel.Status(Text(document["planning"], "state"))} {Text(document["planning"], "error")}";
        ExecutionStatus.Text = RequestStatus.Text + "\n" + Text(engine, "error") + "\n" + Text(engine, "observationError");
        ExecutionStatus.Text += "\n" + string.Join("\n", document["journals"]!.AsArray().Where(x => Text(x, "state") is "pending" or "unknown").Select(x => $"{Text(x, "kind")} · {Text(x, "state")} · 확인 대기"));
        PlanText.Text = Text(versions.LastOrDefault(), "content"); PlanLocation.Text = Text(versions.LastOrDefault(), "path");
        ResultText.Text = string.Join("\n\n────────\n\n", engine["results"]!.AsArray().Reverse().Select(FormatResult)) + "\n\n검토 이력\n" + string.Join("\n", document["reviews"]!.AsArray().Select(x => $"{Text(x, "at")} · {(x?["approved"]?.GetValue<bool>() == true ? "완료 승인" : "수정 필요")}\n{Text(x, "note")}"));
        ExportLocation.Text = string.Join("\n", document["exports"]!.AsArray().Select(x => Text(x, "root")));
        if (!fields) return;
        var input = document["input"]!; TitleInput.Text = Text(input, "title"); GoalInput.Text = Text(input, "goal"); ScopeInput.Text = Text(input, "scope"); ConstraintsInput.Text = Text(input, "constraints"); OutputPathInput.Text = Text(input, "outputPath"); Discipline.SelectedIndex = Text(input, "discipline") == "planning" ? 0 : 1; RequestMode.SelectedIndex = Text(input, "mode") == "new" ? 0 : 1; ValidationChoice.SelectedIndex = Text(input, "validationProfile") == "files" ? 0 : 1;
        ModelChoice.SelectedItem = (ModelChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "provider") == Text(input, "provider"));
        LevelChoice.SelectedItem = (LevelChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "id") == Text(input, "thinkingOptionId"));
        ParentChoice.SelectedItem = (ParentChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "token") == Text(input, "parentToken"));
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
