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
    public static string Error(string value) => value switch
    {
        "SOURCE_FILE_CONFLICT" => "소스 파일이 외부에서 변경되었습니다. 소스 차이를 다시 확인하세요. 기존 파일은 보존했습니다.",
        "FILE_CHANGED" => "파일이 외부에서 변경되었습니다. 입력을 보존했으니 최신 파일과 비교한 뒤 다시 저장하세요.",
        "REVISION_CONFLICT" => "다른 변경이 먼저 저장되었습니다. 최신 상태를 다시 읽고 입력을 확인하세요.",
        "PLAN_EXTERNAL_CHANGE" => "PLAN 파일이 변경되었습니다. 외부에서 수정한 PLAN을 다시 읽고 확인하세요.",
        "PLAN_INPUT_CHANGED" or "PLAN_STALE" => "PLAN 작성 후 입력이 변경되었습니다. 현재 입력으로 PLAN을 다시 작성하세요.",
        "PLANNING_IN_PROGRESS" => "PLAN을 작성 중입니다. 완료될 때까지 기다려 주세요.",
        "GLOBAL_EXECUTION_BUSY" => "진행 중인 작업이 있습니다. 기존 작업의 상태를 확인하세요.",
        "CONVERSATION_TURN_PENDING" => "현재 턴이 진행 중이거나 전송 확인 중입니다. 상태를 확인한 뒤 다음 메시지를 보내세요.",
        "CONVERSATION_POLICY_UNAVAILABLE" => "현재 Codex는 보수적 승인(untrusted)을 지원하지 않습니다. 필요 시 승인 또는 승인 요청 없음을 선택하세요.",
        "CONVERSATION_TURN_LIMIT" => "대화당 100개 턴 한도에 도달했습니다. 이력은 보존되며 새 대화를 시작할 수 있습니다.",
        "DELIVERY_UNKNOWN" => "전송 결과를 확인 중입니다. 중복 실행을 막기 위해 자동 재전송하지 않습니다.",
        "PERMISSION_CHANGED" => "승인 요청이 변경되거나 종료됐습니다. 최신 요청을 확인하세요.",
        "QUESTION_ANSWER_REQUIRED" => "이 요청에는 구체적인 답변이 필요합니다. 단순 허용으로 응답할 수 없습니다. 거부하거나 현재 작업을 중단한 뒤 메시지로 답변하세요.",
        "MODEL_SELECTION_UNAVAILABLE" => "선택한 모델을 사용할 수 없습니다. 모델 목록과 인증 상태를 확인하세요.",
        "PROJECT_RECORD_INVALID" => "프로젝트 기록에 손상되거나 지원되지 않는 파일이 있습니다. 원본을 보존하고 복구가 필요합니다.",
        "REVIEW_NOT_READY" => "아직 완료를 승인할 수 없습니다. 실행 상태와 최신 검사 결과를 확인하세요.",
        "CONNECTION_FAILED" or "HANDSHAKE_REQUIRED" or "BRIDGE_CLOSED" or "TIMEOUT" => "실행부 연결을 확인하지 못했습니다. 입력과 마지막 결과는 유지됩니다. 연결 상태에서 다시 연결하세요.",
        _ => value
    };
    public static string Text(JsonElement value, string name) => value.TryGetProperty(name, out var field) ? field.ToString() : "";
    public static string Status(string value) => value switch { "draft" => "초안", "ready" => "PLAN 확인 대기", "completed" => "완료", "awaiting-review" => "결과 검토 대기", "failed" => "실패", "needs-input" => "응답 필요", "running" => "실행 중", "planned" => "실행 준비", "creating-worktree" => "작업 폴더 준비 중", "writing-plan" => "PLAN 고정 중", "starting-session" => "세션 시작 중", "started" => "실행 시작됨", "validating" => "자동 검사 중", "passed" => "통과", "complete" => "작성 완료", "applied" => "반영 완료", "applying" => "반영 중", "undoing" => "되돌리는 중", "undone" => "되돌림 완료", _ => value };
}
