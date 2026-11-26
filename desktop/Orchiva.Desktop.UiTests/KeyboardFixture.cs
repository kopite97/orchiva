using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Orchiva.Desktop;

// Display conditional controls through the production renderer, without a bridge or model.
internal static class KeyboardFixture
{
    public static async Task ShowPhase(ProductionWorkspace workspace, WorkspaceFixture mock)
    {
        const string run = "keyboard-phase-fixture";
        workspace.Connect(async (method, input) => method switch
        {
            "desktop.roadmap.read" => JsonSerializer.SerializeToElement(new
            {
                revision = "keyboard-only",
                roadmap = new { version = 1, acceptance = new { }, phases = new[]
                {
                    new { id = "P1", milestones = new[] { new { id = "M1", features = Array.Empty<object>() } } }
                } }
            }),
            "desktop.runs.get" => JsonSerializer.SerializeToElement(new
            {
                runId = run, state = "completed", reason = "합성 키보드 관측 전용",
                nodes = Array.Empty<object>(), advisors = Array.Empty<object>()
            }),
            "desktop.runs.phase" => JsonSerializer.SerializeToElement(new
            {
                eligible = true, basis = "keyboard-only", next = "P2", elapsedMs = 0,
                calls = 0, sha = new string('a', 40), buildHash = new string('b', 64),
                artifact = "합성 빌드 · 실제 제작/플레이 결과 아님", decisions = Array.Empty<object>()
            }),
            "desktop.runs.decide" => throw new InvalidOperationException("키보드 관측 전용 · 판정 저장 없음"),
            _ => await mock.Call(method, input)
        });
        workspace.EnableRoadmap(true);
        workspace.EnableRuns(true);
        await Access.Action(workspace, "roadmap-open");
        var choice = Access.Get<ComboBox>(workspace, "RunChoice");
        choice.ItemsSource = new[] { run };
        choice.SelectedIndex = 0;
        await Access.Action(workspace, "run-read");
        workspace.ShowPage("roadmap");
        var panel = Access.Get<StackPanel>(workspace, "PhasePanel");
        if (panel.Visibility != Visibility.Visible || !Access.Get<Button>(workspace, "PhaseApprove").IsEnabled)
            throw new InvalidOperationException("합성 Phase 검토 화면을 표시하지 못했습니다.");
        panel.StartBringIntoView(new BringIntoViewOptions { AnimationDesired = false });
    }
}
