using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Text.Json;
using System.Text.Json.Nodes;
using Button = Microsoft.UI.Xaml.Controls.Button;
using SelectionChangedEventArgs = Microsoft.UI.Xaml.Controls.SelectionChangedEventArgs;

namespace Orchiva.Desktop;

public sealed partial class ConversationWorkspace : UserControl
{
    private Func<string, object, Task<JsonElement>>? call;
    private JsonObject? project, document;
    private string conversationId = Guid.NewGuid().ToString();
    private bool busy, loading;
    private string? renderedDocument, renderedRequests;
    private readonly Dictionary<string, JsonObject> pending = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(4) };
    private IEnumerable<ComboBox> Choices => [ProjectChoice, ConversationChoice, ModelChoice, LevelChoice, AccessChoice, ApprovalChoice, TurnChoice, PermissionChoice, PermissionAction];
    public event Action<string>? ConnectionFailed;
    public ConversationWorkspace()
    {
        InitializeComponent(); UpdatePolicy(); UpdateEnabled();
        timer.Tick += async (_, _) => { if (!busy && document != null && IsLoaded && Visibility == Visibility.Visible && !Choices.Any(x => x.IsDropDownOpen)) await Run(RefreshDocument, false); };
        Loaded += (_, _) => timer.Start(); Unloaded += (_, _) => timer.Stop();
    }
    public void Connect(Func<string, object, Task<JsonElement>> invoke) { call = invoke; Notice.Title = "연결됨"; Notice.Message = "프로젝트를 선택하거나 기존 대화를 불러오세요. 입력은 유지됩니다."; }
    private static string Text(JsonNode? value, string key) => value?[key]?.ToString() ?? "";
    private static WorkspaceChoice Choice(string label, JsonObject value) => new(label, (JsonObject)value.DeepClone());
    private string ProjectId => Text(project, "projectId");
    private JsonObject Identity() { if (project == null) throw new IOException("프로젝트를 선택하세요."); return new() { ["projectId"] = ProjectId, ["conversationId"] = conversationId }; }
    private JsonObject Command() { var input = Identity(); input["expectedRevision"] = document?["revision"]?.DeepClone() ?? JsonValue.Create(0); return input; }
    private async Task<JsonNode> Invoke(string method, object input) { if (call == null) throw new IOException("먼저 실행부에 연결하세요."); return JsonNode.Parse((await call(method, input)).GetRawText())!; }
    private async Task<JsonObject> Mutate(string suffix, JsonObject input)
    {
        var identity = (JsonObject)input.DeepClone(); identity.Remove("expectedRevision"); var signature = suffix + identity.ToJsonString();
        if (!pending.TryGetValue(signature, out var command)) { command = (JsonObject)input.DeepClone(); command["commandKey"] = Guid.NewGuid().ToString("N"); pending[signature] = command; }
        try { var result = (JsonObject)await Invoke("desktop.conversations." + suffix, command); pending.Remove(signature); return result; }
        catch (IOException e) when (e.Message is "REVISION_CONFLICT" or "GLOBAL_EXECUTION_BUSY" or "CONVERSATION_TURN_PENDING" or "PERMISSION_CHANGED" or "MODEL_SELECTION_UNAVAILABLE" or "INSTRUCTIONS_NOT_READY") { pending.Remove(signature); throw; }
    }
    private async Task Run(Func<Task> action, bool announce = true)
    {
        if (busy) return; busy = true;
        try { await action(); if (announce) { Notice.Severity = InfoBarSeverity.Success; Notice.Title = "반영됨"; Notice.Message = "대화 기록과 실행 상태를 확인했습니다."; } }
        catch (Exception e) { Notice.Severity = InfoBarSeverity.Warning; Notice.Title = "확인 필요 · 입력 유지"; Notice.Message = DesktopViewModel.Error(e.Message); if (e is OperationCanceledException || e.Message is "BRIDGE_CLOSED" or "TIMEOUT" or "CONNECTION_FAILED") ConnectionFailed?.Invoke(Notice.Message); }
        finally { busy = false; UpdateEnabled(); }
    }
    private void UpdateEnabled()
    {
        var active = document?["turns"]?.AsArray().Any(t => Text(t, "state") is not ("answered" or "failed")) == true;
        SendButton.IsEnabled = project != null && !active && document?["policy"]?["approval"]?.ToString() != "untrusted";
        StopButton.IsEnabled = active;
        ModelChoice.IsEnabled = LevelChoice.IsEnabled = AccessChoice.IsEnabled = ApprovalChoice.IsEnabled = document == null;
    }
    private void NewConversation()
    {
        loading = true; document = null; renderedDocument = renderedRequests = null; conversationId = Guid.NewGuid().ToString(); ConversationChoice.SelectedIndex = -1; TurnChoice.ItemsSource = null; PermissionChoice.ItemsSource = null; PermissionAction.ItemsSource = null; loading = false;
        StateText.Text = "새 대화 · 아직 저장하지 않았습니다."; QuestionText.Text = "질문이 여기에 표시됩니다."; ResponseText.Text = "답변이 여기에 표시됩니다."; PermissionText.Text = "대기 중인 승인 요청이 없습니다."; JournalText.Text = ""; UpdatePolicy(); UpdateEnabled();
    }
    private async Task LoadProjects()
    {
        var list = (await Invoke("desktop.projects.list", new { })).AsArray(); var selected = ProjectId;
        loading = true; ProjectChoice.ItemsSource = list.Where(x => x?["available"]?.GetValue<bool>() == true && x?["initialized"]?.GetValue<bool>() == true).Select(x => Choice(Text(x, "name"), (JsonObject)x!)).ToArray();
        ProjectChoice.SelectedItem = (ProjectChoice.ItemsSource as WorkspaceChoice[])?.FirstOrDefault(x => Text(x.Value, "projectId") == selected); loading = false;
        if (ProjectChoice.SelectedItem == null) { project = null; NewConversation(); }
    }
    private async Task LoadList()
    {
        var result = await Invoke("desktop.conversations.list", new { projectId = ProjectId });
        loading = true; ConversationChoice.ItemsSource = result["records"]!.AsArray().Reverse().Select(x => Choice($"{Text(x, "title")} · {State(Text(x, "state"))}", (JsonObject)x!)).ToArray(); ConversationChoice.SelectedItem = (ConversationChoice.ItemsSource as WorkspaceChoice[])?.FirstOrDefault(x => Text(x.Value, "id") == conversationId); loading = false;
        if (result["issues"]!.AsArray().Count > 0) throw new IOException("PROJECT_RECORD_INVALID");
    }
    private async Task LoadModels()
    {
        var catalog = await Invoke("desktop.models", new { projectId = ProjectId });
        loading = true; ModelChoice.ItemsSource = catalog["models"]!.AsArray().Select(x => Choice(Text(x, "label"), (JsonObject)x!)).ToArray(); ModelChoice.SelectedIndex = 0; loading = false; UpdateLevels();
        if (catalog["ready"]?.GetValue<bool>() != true) throw new IOException("MODEL_SELECTION_UNAVAILABLE");
    }
    private void UpdateLevels() { var model = (ModelChoice.SelectedItem as WorkspaceChoice)?.Value; LevelChoice.ItemsSource = new[] { Choice("모델 기본값", new JsonObject()) }.Concat(model?["levels"]?.AsArray().Select(x => Choice(Text(x, "label"), (JsonObject)x!)) ?? []); LevelChoice.SelectedIndex = 0; }
    private async void ProjectChanged(object sender, SelectionChangedEventArgs e) { if (loading || busy || ProjectChoice.SelectedItem is not WorkspaceChoice selected) return; await Run(async () => { project = selected.Value; NewConversation(); PathText.Text = "원본 프로젝트 경로: " + Text(project, "sourceRoot"); await LoadModels(); await LoadList(); }); }
    private async void ConversationChanged(object sender, SelectionChangedEventArgs e) { if (loading || busy || ConversationChoice.SelectedItem is not WorkspaceChoice selected) return; await Run(async () => { conversationId = Text(selected.Value, "id"); document = null; await RefreshDocument(); }); }
    private void ModelChanged(object sender, SelectionChangedEventArgs e) { if (!loading && LevelChoice != null) UpdateLevels(); }
    private void PolicyChanged(object sender, SelectionChangedEventArgs e) { if (PolicyText != null) UpdatePolicy(); }
    private void UpdatePolicy()
    {
        var access = document?["policy"]?["access"]?.ToString() ?? (AccessChoice.SelectedItem as ComboBoxItem)?.Tag?.ToString();
        var approval = document?["policy"]?["approval"]?.ToString() ?? (ApprovalChoice.SelectedItem as ComboBoxItem)?.Tag?.ToString();
        var accessLabel = access switch { "workspace-write" => "작업 폴더 내 수정", "danger-full-access" => "전체 접근", _ => "읽기 전용" };
        var approvalLabel = approval switch { "untrusted" => "보수적 승인", "never" => "승인 요청 없음", _ => "필요 시 승인" };
        PolicyText.Text = $"{accessLabel} · {approvalLabel}\n" + (access == "danger-full-access" ? "명령의 네트워크 접근 제한 없음 · 웹 검색 도구 꺼짐" : "파일 쓰기와 명령의 네트워크 접근 제한 · 웹 검색 도구 꺼짐 · 조회 명령 사용 가능") + "\n추가 권한 요청을 허용하면 표시된 작업은 기존 제한을 넘을 수 있습니다.";
    }
    private static string State(string value) => value switch { "accepted" => "전송 준비", "dispatching" => "전송 확인 중", "unknown" => "전송 미확정 · 자동 재전송 안 함", "running" => "진행 중", "answered" => "응답 완료", "failed" => "실패·중단", "ready" => "대화 준비", _ => value };
    private async Task RefreshDocument()
    {
        document = (JsonObject)await Invoke("desktop.conversations.get", Identity());
        var renderKey = conversationId + ":" + Text(document, "revision");
        if (renderKey != renderedDocument)
        {
        var selectedTurn = Text((TurnChoice.SelectedItem as WorkspaceChoice)?.Value, "id");
        var turns = document["turns"]!.AsArray(); loading = true;
        TurnChoice.ItemsSource = turns.Select((x, n) => Choice($"{n + 1}. {Text(x, "preview")} · {State(Text(x, "state"))}", (JsonObject)x!)).ToArray();
        TurnChoice.SelectedItem = (TurnChoice.ItemsSource as WorkspaceChoice[])?.FirstOrDefault(x => Text(x.Value, "id") == selectedTurn) ?? (TurnChoice.ItemsSource as WorkspaceChoice[])?.LastOrDefault();
        var provider = Text(document, "provider"); ModelChoice.SelectedItem = (ModelChoice.ItemsSource as WorkspaceChoice[])?.FirstOrDefault(x => Text(x.Value, "provider") == provider);
        UpdateLevels(); LevelChoice.SelectedItem = (LevelChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(x => Text(x.Value, "id") == Text(document, "thinkingOptionId")) ?? (LevelChoice.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault();
        AccessChoice.SelectedIndex = document["policy"]?["access"]?.ToString() switch { "workspace-write" => 1, "danger-full-access" => 2, _ => 0 }; ApprovalChoice.SelectedIndex = document["policy"]?["approval"]?.ToString() switch { "untrusted" => 0, "never" => 2, _ => 1 }; loading = false;
        StateText.Text = $"{State(Text(turns.LastOrDefault(), "state"))} · {turns.Count}개 턴" + (document["observationError"] == null ? "" : "\n" + DesktopViewModel.Error(Text(document, "observationError")));
        PathText.Text = "원본 프로젝트 경로: " + Text(document, "cwd"); UpdatePolicy(); await LoadTurn();
        renderedDocument = renderKey;
        }
        var requests = (await Invoke("desktop.conversations.attention", Identity())).AsArray();
        var requestsKey = conversationId + requests.ToJsonString();
        if (requestsKey != renderedRequests)
        {
        var oldPermission = Text((PermissionChoice.SelectedItem as WorkspaceChoice)?.Value, "id");
        var previousRequest = (PermissionChoice.SelectedItem as WorkspaceChoice)?.Value; var previousAction = Text((PermissionAction.SelectedItem as WorkspaceChoice)?.Value, "id");
        loading = true; PermissionChoice.ItemsSource = requests.Select(x => Choice(Text(x, "title"), (JsonObject)x!)).ToArray(); PermissionChoice.SelectedItem = (PermissionChoice.ItemsSource as WorkspaceChoice[])?.FirstOrDefault(x => Text(x.Value, "id") == oldPermission) ?? (PermissionChoice.ItemsSource as WorkspaceChoice[])?.FirstOrDefault(); loading = false; RenderPermission();
        if (Text(previousRequest, "hash") == Text((PermissionChoice.SelectedItem as WorkspaceChoice)?.Value, "hash")) PermissionAction.SelectedItem = (PermissionAction.ItemsSource as WorkspaceChoice[])?.FirstOrDefault(x => Text(x.Value, "id") == previousAction);
        renderedRequests = requestsKey;
        }
        JournalText.Text = string.Join("\n", document["journals"]!.AsArray().TakeLast(10).Select(j => $"{Text(j, "at")} · {Text(j, "kind")} {Text(j, "behavior")} · {Text(j, "state")}")); UpdateEnabled();
    }
    private async Task LoadTurn() { if (TurnChoice.SelectedItem is not WorkspaceChoice choice) return; var input = Identity(); input["turnId"] = Text(choice.Value, "id"); var turn = await Invoke("desktop.conversations.turn", input); QuestionText.Text = "사용자\n" + Text(turn, "input"); ResponseText.Text = "응답\n" + (turn["response"]?.ToString() ?? State(Text(turn, "state"))) + (turn["failure"] == null ? "" : "\n" + Text(turn, "failure")); }
    private async void TurnChanged(object sender, SelectionChangedEventArgs e) { if (!loading && !busy) await Run(LoadTurn, false); }
    private void PermissionChanged(object sender, SelectionChangedEventArgs e) { if (!loading) RenderPermission(); }
    private void RenderPermission() { var request = (PermissionChoice.SelectedItem as WorkspaceChoice)?.Value; PermissionText.Text = request == null ? "대기 중인 승인 요청이 없습니다." : Text(request, "details"); PermissionAction.ItemsSource = request?["actions"]?.AsArray().Select(x => Choice(Text(x, "label"), (JsonObject)x!)).ToArray(); PermissionAction.SelectedIndex = -1; }
    private async void Action(object sender, RoutedEventArgs e) => await Run(async () =>
    {
        switch ((sender as Button)?.Tag?.ToString())
        {
            case "projects": await LoadProjects(); break;
            case "list": await LoadList(); break;
            case "new": NewConversation(); break;
            case "refresh": await RefreshDocument(); break;
            case "send":
                var text = InputText.Text.Trim(); if (text.Length == 0) throw new IOException("메시지를 입력하세요.");
                if (document == null)
                {
                    if (ModelChoice.SelectedItem is not WorkspaceChoice model) throw new IOException("MODEL_SELECTION_UNAVAILABLE");
                    var create = Command(); create["selection"] = new JsonObject { ["provider"] = Text(model.Value, "provider"), ["thinkingOptionId"] = (LevelChoice.SelectedItem as WorkspaceChoice)?.Value["id"]?.DeepClone(), ["policy"] = new JsonObject { ["access"] = (AccessChoice.SelectedItem as ComboBoxItem)?.Tag?.ToString(), ["approval"] = (ApprovalChoice.SelectedItem as ComboBoxItem)?.Tag?.ToString() } }; document = await Mutate("create", create);
                }
                var send = Command(); send["text"] = text; document = await Mutate("send", send); if (InputText.Text.Trim() == text) InputText.Text = ""; TurnChoice.SelectedIndex = -1; await LoadList(); await RefreshDocument(); break;
            case "stop": document = await Mutate("stop", Command()); await RefreshDocument(); break;
            case "permission":
                if (PermissionChoice.SelectedItem is not WorkspaceChoice request || PermissionAction.SelectedItem is not WorkspaceChoice action) throw new IOException("승인 요청과 응답을 선택하세요.");
                var reply = Command(); reply["requestId"] = Text(request.Value, "id"); reply["requestHash"] = Text(request.Value, "hash"); reply["actionId"] = Text(action.Value, "id"); reply["behavior"] = Text(action.Value, "behavior"); document = await Mutate("permission", reply); await RefreshDocument(); break;
        }
    });
}
