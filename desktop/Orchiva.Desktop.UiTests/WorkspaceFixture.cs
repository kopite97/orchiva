using System.Text.Json;
using System.Text.Json.Nodes;

namespace Orchiva.Desktop;

internal sealed class WorkspaceFixture
{
    public List<JsonObject> Calls { get; } = [];
    public string? FailNext { get; set; }
    public TaskCompletionSource? Hold { get; set; }
    public bool Empty { get; set; }
    public JsonObject Project { get; } = JsonNode.Parse("""
        {"projectId":"11111111-1111-4111-8111-111111111111","name":"별빛 탐험 · 합성 프로젝트","sourceRoot":"C:/UI-Fixture/한글 프로젝트/Source","initialized":true,"config":{"revision":1,"baseRef":"main","outputRoot":"../Output"}}
        """)!.AsObject();
    public JsonObject Document { get; set; } = JsonNode.Parse("""
        {"token":"ui-request-001","revision":3,"input":{"title":"인벤토리 정렬 화면 개선","goal":"아이템을 종류와 이름순으로 정리하고 긴 한국어 이름도 읽기 쉽게 표시합니다.","scope":"인벤토리 화면과 관련 표시 코드","constraints":"저장 형식과 게임 규칙은 유지합니다.","discipline":"coding","mode":"new","parentToken":null,"parentResultId":null,"provider":"codex/fixture","thinkingOptionId":"medium","outputPath":"features/inventory","validationProfile":"files"},"planning":{"state":"complete","error":null},"planVersions":[{"revision":1,"path":"docs/plans/inventory-layout.md","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","createdAt":"2026-11-17T00:00:00Z","content":"# 인벤토리 정렬 화면 개선\n\n## 목표\n아이템 정보를 쉽게 비교할 수 있는 화면을 만듭니다.\n\n## 작업 범위\n1. 기존 표시 컴포넌트를 확인합니다.\n2. 정렬 버튼과 목록의 간격을 맞춥니다.\n3. 긴 한국어 이름과 빈 목록을 확인합니다.\n\n## 완료 조건\n기능과 저장 형식은 유지하며 화면의 잘림이 없어야 합니다.\n\n합성 UI 검증용 문서입니다. 실제 제작은 실행하지 않습니다."}],"engine":{"status":"awaiting-review","error":null,"observationError":null,"commands":[{"key":"unknown-command-001","status":"unknown"},{"key":"failed-command-001","status":"failed"}],"attempts":[{"attempt":1,"result":null,"error":"합성 과거 시도"}],"result":{"id":"ui-result-002"},"results":[{"id":"ui-result-001","collectedAt":"2026-11-17T00:01:00Z","finalResponse":"이전 표시 결과 · 원문 보존","changedFiles":["src/InventoryView.cs"],"checks":[],"failure":null,"executionFailure":"합성 실행 실패"},{"id":"ui-result-002","collectedAt":"2026-11-17T00:02:00Z","finalResponse":"목록 간격과 정렬 버튼 배치를 정리했습니다. 합성 결과이며 실제 소스 변경은 없습니다.","changedFiles":["src/InventoryView.cs","docs/design/inventory.md"],"checks":[{"label":"기존 검사","status":"passed","command":"node --test","passed":true,"output":"합성 검사 통과"},{"label":"파일 확인","status":"skipped","command":"","passed":false,"output":"합성 미실행 사례"}],"failure":null,"executionFailure":null}]},"journals":[],"reviews":[{"resultId":"ui-result-001","approved":false,"note":"간격을 보완하세요. 합성 검토 이력","at":"2026-11-17T00:01:30Z"}],"exports":[{"root":"C:/UI-Fixture/Output/inventory"}]}
        """)!.AsObject();
    public async Task<JsonElement> Call(string method, object input)
    {
        var payload = JsonSerializer.SerializeToNode(input)!.AsObject();
        Calls.Add(new() { ["method"] = method, ["input"] = payload.DeepClone() });
        if (Hold != null) await Hold.Task;
        if (FailNext == method) { FailNext = null; throw new IOException("합성 응답 유실 · 다시 시도하세요."); }
        if (Empty && method == "desktop.projects.list") return JsonSerializer.SerializeToElement(Array.Empty<object>());
        object result = method switch
        {
            "desktop.projects.list" => new[] { Project, JsonNode.Parse("""{"projectId":"22222222-2222-4222-8222-222222222222","name":"긴 한국어 프로젝트 이름과 경로 확인을 위한 초기화 전 프로젝트","sourceRoot":"C:/UI-Fixture/아주 긴 프로젝트 경로/개발 중인 프로젝트/Source","initialized":false,"config":null} """) },
            "desktop.projects.register" or "desktop.projects.initialize" or "desktop.projects.configure" => Project,
            "desktop.projects.preview" => new { projectId = Project["projectId"]!.ToString(), fingerprint = new string('a', 64), changes = new[] { new { path = "AGENTS.md", reason = "생성 예정 · 합성", content = "# 지침 지도\n- docs/agents/project.md\n- docs/plans/plans.md\n- docs/decisions/decisions.md\n- docs/evidence/evidence.md" } }, issues = Array.Empty<string>() },
            "desktop.instructions.read" or "desktop.instructions.save" => new { ready = true, issues = Array.Empty<string>(), files = new[] { "AGENTS.md", "docs/agents/project.md", "docs/plans/plans.md", "docs/decisions/decisions.md", "docs/evidence/evidence.md" }.Select(path => new { path, scope = "all", exists = true, hash = new string('b', 64), content = "# 프로젝트 지침\n\n합성 파일입니다. 실제 파일에 저장하지 않습니다.\n\n## 작업 원칙\n프로젝트의 기존 기능과 결과 이력을 보존합니다.\n파일 이름은 프로젝트 명명 규칙을 따릅니다." }) },
            "desktop.models" => new { ready = true, models = new[] { new { provider = "codex/fixture", label = "합성 검증 모델", levels = new[] { new { id = "medium", label = "보통" } } } } },
            "desktop.requests.list" => new { records = new[] { Document }, issues = Array.Empty<string>() },
            "desktop.requests.attention" => new[] { new { id = "permission-001", hash = new string('c', 64), title = "합성 명령 확인", details = "시험 전용 요청 · 실제 명령은 실행되지 않습니다.", actions = new[] { new { id = "deny-001", label = "거부", behavior = "deny" } } } },
            "desktop.requests.diff" => new { files = new[] { new { path = "src/InventoryView.cs", conflict = false, beforeText = "간격 = 4;", afterText = "간격 = 12;" }, new { path = "docs/design/inventory.md", conflict = true, beforeText = "현재 사용자가 수정한 문서", afterText = "합성 결과 문서" } } },
            "desktop.requests.transfers" => new[] { new { key = "ui-transfer-001", state = "applying", paths = new[] { "src/InventoryView.cs" } } },
            "desktop.requests.apply" or "desktop.requests.undo" => new { key = "ui-transfer-001", state = "applied" },
            "desktop.requests.save" => Save(payload),
            _ when method.StartsWith("desktop.requests.") => Document,
            _ => throw new Exception("Unexpected mock method " + method)
        };
        return JsonSerializer.SerializeToElement(result);
    }
    private JsonObject Save(JsonObject payload)
    {
        Document["input"] = payload["input"]!.DeepClone(); Document["token"] = payload["token"]!.DeepClone(); return Document;
    }
}
