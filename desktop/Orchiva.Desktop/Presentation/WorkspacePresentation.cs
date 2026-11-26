using System.Text.Json.Nodes;

namespace Orchiva.Desktop.Presentation;

public sealed record DetailCard(string Title, string Body);

// Read-only projections. Never change stored records or infer success from missing data.
public static class WorkspacePresentation
{
    private static string Text(JsonNode? node, string key) => node?[key]?.ToString() ?? "";
    private static IEnumerable<JsonNode?> Items(JsonNode? node) => node is JsonArray array ? array : [];
    public static string PlanSummary(JsonObject document)
    {
        var input = document["input"];
        return $"{Text(input, "title")}\n\n분야: {Text(input, "discipline")}\n모델: {Text(input, "provider")}\n수준: {Text(input, "thinkingOptionId")}\n결과물 하위 폴더: {Text(input, "outputPath")}\n\n저장한 입력 기준 · 현재 프로젝트 지침 적용";
    }
    public static IReadOnlyList<DetailCard> ResultCards(JsonObject document)
    {
        var cards = new List<DetailCard>();
        var currentId = Text(document["engine"]?["result"], "id");
        foreach (var result in Items(document["engine"]?["results"]).Reverse())
        {
            var id = Text(result, "id");
            var label = id == currentId ? "현재 결과" : "과거 결과 · 읽기 전용";
            cards.Add(new(label + " · " + id, Text(result, "finalResponse")));
            var files = Items(result?["changedFiles"]).Select(x => x?.ToString() ?? "").ToArray();
            cards.Add(new("산출물 · " + id, files.Length == 0 ? "기록된 변경 파일이 없습니다." : string.Join("\n", files)));
            var checks = Items(result?["checks"]).Select(x => $"{Text(x, "label")} · {CheckStatus(x)}\n{Text(x, "command")}\n{Text(x, "output")}").ToArray();
            cards.Add(new("자동 확인 · " + id, checks.Length == 0 ? "기록된 자동 검사 결과가 없습니다. 통과를 의미하지 않습니다." : string.Join("\n\n", checks)));
            var execution = Text(result, "executionFailure"); var validation = Text(result, "failure");
            if (execution.Length > 0) cards.Add(new("실행 실패 · " + id, execution));
            if (validation.Length > 0) cards.Add(new("검증 오류 · " + id, validation));
        }
        if (cards.Count == 0) cards.Add(new("아직 결과가 없습니다", "실행 상태와 PLAN을 확인하세요."));
        foreach (var review in Items(document["reviews"]))
            cards.Add(new("검토 이력 · " + Text(review, "resultId"), Review(review)));
        return cards;
    }
    public static string History(JsonObject document)
    {
        var lines = new List<string>();
        foreach (var plan in Items(document["planVersions"])) lines.Add($"PLAN {Text(plan, "revision")} · {Text(plan, "createdAt")}\n{Text(plan, "path")}");
        foreach (var attempt in Items(document["engine"]?["attempts"])) lines.Add($"실행 시도 {Text(attempt, "attempt")}\n결과: {Text(attempt?["result"], "id")}\n{Text(attempt, "error")}");
        foreach (var result in Items(document["engine"]?["results"])) lines.Add($"결과 · {Text(result, "id")}\n{Text(result, "collectedAt")}");
        foreach (var review in Items(document["reviews"])) lines.Add("검토 · " + Text(review, "resultId") + "\n" + Review(review));
        foreach (var export in Items(document["exports"])) lines.Add("내보내기\n" + Text(export, "root"));
        return lines.Count == 0 ? "선택한 요청에 아직 기록된 PLAN·결과가 없습니다." : string.Join("\n\n", lines);
    }
    private static string CheckStatus(JsonNode? check) => Text(check, "status") switch
    {
        "passed" => "통과", "failed" => "실패", "error" => "검사 오류", "skipped" => "미실행",
        _ => check?["passed"]?.GetValue<bool>() == true ? "통과" : "통과하지 않음"
    };
    private static string Review(JsonNode? review) => $"{(review?["approved"]?.GetValue<bool>() == true ? "완료 승인" : "수정 필요")} · {Text(review, "at")}\n{Text(review, "note")}";
}
