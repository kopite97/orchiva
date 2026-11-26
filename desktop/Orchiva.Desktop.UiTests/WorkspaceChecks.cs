using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Text.Json.Nodes;
using Orchiva.Desktop.Presentation;

namespace Orchiva.Desktop;

internal static class WorkspaceChecks
{
    public static async Task<List<string>> Run(ProductionWorkspace w, WorkspaceFixture mock)
    {
        var passed = new List<string>();
        void Check(bool condition, string name) { if (!condition) throw new Exception(name); passed.Add(name); }
        T Field<T>(string name) => Access.Get<T>(w, name);
        JsonObject Last(string method) => mock.Calls.Last(x => x["method"]!.ToString() == method)["input"]!.AsObject();
        await Access.Action(w, "projects"); Field<ListView>("ProjectChoice").SelectedIndex = 0; await Access.Idle(w);
        Field<ListView>("RequestChoice").SelectedIndex = 0; await Access.Idle(w);
        var expected = mock.Document["input"]!.DeepClone();
        Check(JsonNode.DeepEquals((JsonNode?)Access.Call(w, "Input"), expected), "01 saved input restores identical payload");
        Field<TextBox>("GoalInput").Text += "\n未保存 · 한글 입력 유지";
        var goal = Field<TextBox>("GoalInput").Text;
        var count = mock.Calls.Count; var timer = Field<DispatcherTimer>("timer");
        foreach (var page in new[] { "projects", "setup", "home", "request", "plan", "execution", "result", "apply", "history", "instructions", "configuration" }) w.ShowPage(page);
        Check(mock.Calls.Count == count && Field<TextBox>("GoalInput").Text == goal && ReferenceEquals(timer, Field<DispatcherTimer>("timer")), "02 navigation preserves input and timer with zero RPC");
        Field<TextBox>("GoalInput").Text = expected["goal"]!.ToString();
        mock.FailNext = "desktop.requests.save"; await Access.Action(w, "save"); var failed = Last("desktop.requests.save").DeepClone();
        w.ShowPage("instructions"); w.ShowPage("request"); await Access.Action(w, "save");
        Check(JsonNode.DeepEquals(failed, Last("desktop.requests.save")), "03 timeout retry preserves command key revision and payload");
        Check(JsonNode.DeepEquals(Last("desktop.requests.save")["input"], expected), "04 save payload equals existing input contract");
        Field<TextBox>("GoalInput").Text += "changed"; count = mock.Calls.Count; await Access.Action(w, "plan");
        Check(mock.Calls.Count == count, "05 unsaved PLAN creation blocked"); Field<TextBox>("GoalInput").Text = expected["goal"]!.ToString();
        await Access.Action(w, "plan"); Field<CheckBox>("PlanConfirmed").IsChecked = false; count = mock.Calls.Count; await Access.Action(w, "start");
        Check(mock.Calls.Count == count, "06 unconfirmed start blocked"); Field<CheckBox>("PlanConfirmed").IsChecked = true; await Access.Action(w, "start");
        Check(Last("desktop.requests.start")["planHash"]!.ToString() == new string('a', 64), "07 confirmed start retains PLAN hash");
        Field<CheckBox>("QualityConfirmed").IsChecked = Field<CheckBox>("ChecksConfirmed").IsChecked = true;
        mock.Document["engine"]!["result"]!["id"] = "ui-result-new"; mock.Document["planVersions"]![0]!["hash"] = new string('d',64);
        await (Task)Access.Call(w, "LoadDocument", false)!;
        Check(Field<CheckBox>("PlanConfirmed").IsChecked == false && Field<CheckBox>("QualityConfirmed").IsChecked == false && Field<CheckBox>("ChecksConfirmed").IsChecked == false, "08 new PLAN and result reset confirmations");
        mock.Document["engine"]!["result"]!["id"] = "ui-result-002"; await (Task)Access.Call(w, "LoadDocument", false)!;
        Field<CheckBox>("QualityConfirmed").IsChecked = true; Field<CheckBox>("ChecksConfirmed").IsChecked = false; Field<TextBox>("ReviewNote").Text = "합성 검토"; await Access.Action(w, "reject");
        Check(Last("desktop.requests.review")["resultId"]!.ToString() == "ui-result-002" && Last("desktop.requests.review")["checksAcknowledged"]!.GetValue<bool>() == false, "09 review retains current result and confirmation values");
        await Access.Action(w, "attention"); Field<ComboBox>("PermissionChoice").SelectedIndex = 0; Field<ComboBox>("PermissionAction").SelectedIndex = 0; count = mock.Calls.Count; await Access.Action(w, "permission");
        Check(mock.Calls.Count == count, "10 unconfirmed permission blocked"); Field<CheckBox>("PermissionConfirmed").IsChecked = true; await Access.Action(w, "permission");
        Check(Last("desktop.requests.permission")["requestHash"]!.ToString() == new string('c',64) && Last("desktop.requests.permission")["behavior"]!.ToString() == "deny", "11 permission preserves hash and selected behavior");
        await Access.Action(w, "diff"); Field<ListView>("DiffFiles").SelectedIndex = 0; w.ShowPage("request"); w.ShowPage("apply"); await Access.Action(w, "apply");
        Check(Last("desktop.requests.apply")["paths"]!.AsArray().Count == 1 && Last("desktop.requests.apply")["paths"]![0]!.ToString() == "src/InventoryView.cs", "12 selected paths survive navigation");
        await Access.Action(w, "transfers"); Field<ComboBox>("TransferChoice").SelectedIndex = 0; await Access.Action(w, "continue-apply");
        Check(Last("desktop.requests.apply")["commandKey"]!.ToString() == "ui-transfer-001", "13 partial apply reuses transfer key"); await Access.Action(w, "undo");
        Check(Last("desktop.requests.undo")["transferKey"]!.ToString() == "ui-transfer-001", "14 undo uses displayed transfer key");
        mock.Hold = new TaskCompletionSource(); var pending = Access.Action(w, "save");
        Check(!Field<ListView>("ProjectChoice").IsEnabled && !Field<ListView>("RequestChoice").IsEnabled, "15 busy disables target selection"); mock.Hold.SetResult(); await pending; mock.Hold = null;
        Field<ComboBox>("RequestMode").SelectedIndex = 1; Field<ComboBox>("ParentChoice").SelectedIndex = 0;
        var modification = (JsonObject)Access.Call(w, "Input")!;
        Check(modification["parentToken"]!.ToString() == mock.Document["token"]!.ToString() && modification["parentResultId"]!.ToString() == "ui-result-002", "16 modification preserves parent token and result");
        Field<ComboBox>("RequestMode").SelectedIndex = 0;
        var cards = WorkspacePresentation.ResultCards(mock.Document);
        Check(cards.Any(x => x.Title.StartsWith("과거 결과")) && cards.Any(x => x.Body.Contains("미실행")) && cards.Any(x => x.Title.StartsWith("실행 실패")), "17 current historical failed skipped evidence remains distinct");
        Check(WorkspacePresentation.History(mock.Document).Contains("PLAN 1"), "18 history maps plan revision");
        Field<ListView>("InstructionChoice").SelectedIndex = 0; await Access.Action(w, "preview");
        var original = mock.Document.DeepClone().AsObject(); await Access.Action(w, "new");
        Check(Field<TextBlock>("PlanSummary").Text == "저장한 요청의 PLAN을 확인하세요.", "19 new draft clears presentation");
        mock.Document = original; Access.Set(w, "token", original["token"]!.ToString()); await (Task)Access.Call(w, "LoadDocument", true)!;
        return passed;
    }
}
