using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Orchiva.Desktop;

public sealed partial class ProductionWorkspace
{
    private JsonNode? roadmap, scope;
    private string? roadmapRevision, loadedProject;
    private string savedRoadmap = "";
    private readonly Dictionary<string, string> lastInputs = new();
    public void EnableRoadmap(bool enabled) => RoadmapEntry.Visibility = enabled ? Visibility.Visible : Visibility.Collapsed;

    public void EnableRuns(bool enabled) => RunControls.Visibility = enabled ? Visibility.Visible : Visibility.Collapsed;
    private JsonNode? displayedRun;
    private string? createKey;
    private async Task ReadRuns(string? select = null)
    {
        var runs = await Invoke("desktop.runs.list", new { projectId = ProjectId });
        var ids = runs.AsArray().Select(r => Text(r,"runId")).ToList();
        RunChoice.ItemsSource = ids;
        RunChoice.SelectedItem = select ?? ids.LastOrDefault();
        if (RunChoice.SelectedItem != null) await ReadMilestoneRun();
    }
    private void RunModelChanged(object sender, SelectionChangedEventArgs e)
    {
        if (RunModel.SelectedItem is not WorkspaceChoice model || RunLevel == null) return;
        RunLevel.ItemsSource=model.Value["levels"]!.AsArray().Select(x=>new WorkspaceChoice(Text(x,"label"),Copy(x!.AsObject()))).ToList();
        RunLevel.SelectedIndex=0;
    }
    private async Task CreateMilestoneRun(bool rerun)
    {
        if (loadedProject != ProjectId || scope == null || scope["issues"]!.AsArray().Count > 0 || RunModel.SelectedItem is not WorkspaceChoice model)
            throw new IOException("모델을 선택하고 실행 가능한 구간을 미리 확인하세요.");
        if (rerun && RunChoice.SelectedItem is not string) throw new IOException("원본 실행을 선택하세요.");
        createKey ??= NewKey();
        var payload = JsonSerializer.SerializeToNode(new { projectId = ProjectId, runId = createKey, scopeHash = Text(scope,"hash"), selection = scope["selection"],
            provider = Text(model.Value,"provider"), thinkingOptionId = RunLevel.SelectedItem is WorkspaceChoice level ? Text(level.Value,"id") : null, parent = rerun ? RunChoice.SelectedItem as string : null })!.AsObject();
        if (GitIntegrationPanel.Visibility==Visibility.Visible && GitAcceptance.SelectedIndex>0) payload["integration"]=GitPolicy();
        if (UnityGateRequired.IsChecked==true) {
            if(payload["integration"]==null) throw new IOException("Unity 검사를 사용할 통합 브랜치를 선택하세요.");
            payload["unityProfile"]="hud-win64-v1";
        }
        if (ParallelWorkers.IsChecked==true) {
            if(GitAcceptance.SelectedIndex!=1) throw new IOException("병렬 실행에는 로컬 통합 브랜치를 선택하세요.");
            payload["workers"]=2; payload["failurePolicy"]=ContinueIndependent.IsChecked==true?"continue-independent":"pause";
        }
        var result=await Invoke("desktop.runs.create",payload);
        createKey = null;
        await ReadRuns(Text(result,"runId"));
    }
    private string? phaseBasis;
    private async Task DecidePhase(string verdict)
    {
        if (phaseBasis==null || loadedProject!=ProjectId || displayedRun==null || RunChoice.SelectedItem?.ToString()!=Text(displayedRun,"runId"))
            throw new IOException("현재 프로젝트와 빌드의 근거를 먼저 조회하세요.");
        if (string.IsNullOrWhiteSpace(PhaseNote.Text)) throw new IOException("플레이 판단과 사유를 입력하세요.");
        await Mutate("desktop.runs.decide",new() { ["projectId"]=ProjectId,["runId"]=Text(displayedRun,"runId"),
            ["basis"]=phaseBasis,["note"]=PhaseNote.Text.Trim(),["verdict"]=verdict });
        PhaseNote.Text="";
        await ReadMilestoneRun();
    }
    private async Task ReadMilestoneRun()
    {
        if (loadedProject != ProjectId || RunChoice.SelectedItem is not string id) throw new IOException("현재 프로젝트의 실행을 선택하세요.");
        phaseBasis=null;
        PhasePanel.Visibility=Visibility.Collapsed;
        if (displayedRun==null || id!=Text(displayedRun,"runId")) PhaseNote.Text="";
        ClearGitView();
        displayedRun = await Invoke("desktop.runs.get",new {projectId=ProjectId,runId=id});
        var rows = displayedRun["nodes"]!.AsArray();
        var lines = new List<string> { Text(displayedRun,"state")+" · "+Text(displayedRun,"reason") };
        if(displayedRun["unityEvidence"] is JsonArray evidence) foreach(var check in evidence.Reverse()) {
            lines.Add($"Unity {Text(check,"kind")} · {Text(check,"feature")} · {Text(check,"status")} · {Text(check,"sha")}");
            lines.Add($"{Text(check,"reason")} {Text(check,"hud")} {Text(check,"playerHash")}\n{Text(check,"directory")}");
        }
        foreach (var n in rows) {
            var worker=n?["lease"] is JsonNode lease ? $" · 예약 {Text(lease,"generation")} · {Text(lease,"base")}" : "";
            var info=n?["worker"];
            lines.Add(Text(n,"id")+" · "+Text(n,"status")+" "+Text(n,"waitReason")+worker+" "+Text(n,"resultId")+" "+Text(n,"integrationSha"));
            if(info?["session"]!=null) lines.Add($"  {Text(info,"workspace")} · {Text(info,"session")} · {Text(info,"started")} — {Text(info,"ended")}");
        }
        foreach (var a in displayedRun["advisors"]!.AsArray())
        {
            lines.Add(Text(a,"milestone")+" 조율 · "+Text(a,"status")+"\n"+Text(a,"report"));
            if (a?["handoff"] is JsonNode handoff) lines.Add("결과 인계 · "+Text(handoff,"verdict")+"\n"+Text(handoff,"report"));
        }
        if(roadmap?["acceptance"]!=null)
        {
            var phase=await Invoke("desktop.runs.phase",new {projectId=ProjectId,runId=id});
            bool eligible=phase["eligible"]!.GetValue<bool>();
            phaseBasis=eligible?Text(phase,"basis"):null;
            PhasePanel.Visibility=Visibility.Visible;
            PhaseApprove.IsEnabled=PhaseReject.IsEnabled=eligible;
            var log=new List<string>{eligible?"플레이 검토 가능":"진행 차단 · "+Text(phase,"reason"),
                $"다음 Phase {Text(phase,"next")} · 소요 {TimeSpan.FromMilliseconds(phase["elapsedMs"]!.GetValue<double>()):g} · 제작 PLAN·실행 호출 {Text(phase,"calls")} · 청구 금액 미제공",
                $"커밋 {Text(phase,"sha")}\n빌드 SHA-256 {Text(phase,"buildHash")}\n{Text(phase,"artifact")}"};
            if(phase["level"] is JsonNode level)log.Add($"{Text(level,"name")} · {Text(level,"moves")}회 이동 · {Text(level,"collected")}개 수집 · 클리어");
            foreach(var decision in phase["decisions"]!.AsArray())log.Add($"{Text(decision,"at")} · {Text(decision,"verdict")} · {Text(decision,"note")}");
            PhaseReport.Text=string.Join("\n",log);
        }
        RunReport.Text=string.Join("\n",lines);
        RunNode.ItemsSource=rows.Where(n=>Text(n,"status")!="waiting").Select(n=>new WorkspaceChoice(Text(n,"id"),Copy(n!.AsObject()))).ToList();
        RunNode.SelectedIndex=0;
    }
    private async Task VerifyUnity(string kind)
    {
        if(displayedRun==null || loadedProject!=ProjectId || RunNode.SelectedItem is not WorkspaceChoice node ||
            Text(node.Value,"status")!="accepted" || string.IsNullOrEmpty(Text(node.Value,"integrationSha")))
            throw new IOException("통합 커밋이 생성된 Feature를 선택하세요.");
        await Mutate("desktop.runs.unity",new() { ["projectId"]=ProjectId, ["runId"]=Text(displayedRun,"runId"), ["feature"]=Text(node.Value,"id"),
            ["kind"]=kind, ["expectedSha"]=Text(node.Value,"integrationSha") });
        await ReadMilestoneRun();
    }
    private async Task ControlMilestoneRun(string action)
    {
        if (displayedRun==null || loadedProject!=ProjectId || RunChoice.SelectedItem?.ToString()!=Text(displayedRun,"runId"))
            throw new IOException("실행의 현재 상태를 먼저 조회하세요.");
        await Mutate("desktop.runs.control",new() { ["projectId"]=ProjectId, ["runId"]=Text(displayedRun,"runId"), ["expectedRevision"]=displayedRun["revision"]!.DeepClone(), ["action"]=action });
        await ReadMilestoneRun();
    }
    private async Task OpenRoadmap()
    {
        var response = await Invoke("desktop.roadmap.read", new { projectId = ProjectId });
        if (loadedProject != ProjectId) { lastInputs.Clear(); displayedRun=null; RunChoice.ItemsSource=null; RunNode.ItemsSource=null; RunReport.Text=""; }
        if(loadedProject!=ProjectId) {
            ClearGitView(); GitRepository.Text=GitRepoId.Text=GitBase.Text=GitChecks.Text="";
            GitTarget.Text="develop"; GitPrefix.Text="feature"; GitAcceptance.SelectedIndex=0;
            ParallelWorkers.IsChecked=ContinueIndependent.IsChecked=UnityGateRequired.IsChecked=false;
        }
        RunModel.ItemsSource=ModelChoice.ItemsSource;
        RunModel.SelectedItem=ModelChoice.SelectedItem;
        if (LevelChoice.SelectedItem is WorkspaceChoice selectedLevel)
            RunLevel.SelectedItem=(RunLevel.ItemsSource as IEnumerable<WorkspaceChoice>)?.FirstOrDefault(l=>Text(l.Value,"id")==Text(selectedLevel.Value,"id"));
        phaseBasis=null; PhasePanel.Visibility=Visibility.Collapsed; PhaseNote.Text="";
        loadedProject = ProjectId;
        SetRoadmap(response);
        ShowPage("roadmap");
    }
    private void SetRoadmap(JsonNode response)
    {
        roadmap = response["roadmap"]!.DeepClone();
        roadmapRevision = response["revision"]?.ToString();
        if (roadmapRevision == null)
            roadmap = JsonNode.Parse("""{"version":1,"phases":[{"id":"P01","milestones":[{"id":"M01","features":[{"id":"A","title":"점수 규칙","goal":"점수 규칙 문서를 작성한다.","discipline":"planning","outputs":["score.md"]}]}]}]}""");
        savedRoadmap = roadmap!.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        RoadmapEditor.Text = savedRoadmap;
        savedRoadmap = RoadmapEditor.Text;
        RoadmapPhase.ItemsSource = roadmap["phases"]!.AsArray().Select(p => Text(p, "id")).ToList();
        RoadmapPhase.SelectedIndex = 0;
        ClearScope();
    }
    private void ClearScope()
    {
        scope = null; createKey = null;
        if (RoadmapSummary != null) RoadmapSummary.Text = "";
    }
    private void RoadmapEdited(object sender, TextChangedEventArgs e) => ClearScope();
    private void RoadmapRangeChanged(object sender, SelectionChangedEventArgs e) => ClearScope();
    private void RoadmapPhaseChanged(object sender, SelectionChangedEventArgs e)
    {
        if (RoadmapFirst == null || RoadmapLast == null) return;
        var phase = roadmap?["phases"]?.AsArray().FirstOrDefault(p => Text(p, "id") == RoadmapPhase.SelectedItem?.ToString());
        var items = phase?["milestones"]?.AsArray().Select(m => Text(m, "id")).ToList();
        RoadmapFirst.ItemsSource = items; RoadmapLast.ItemsSource = items;
        RoadmapFirst.SelectedIndex = 0; RoadmapLast.SelectedIndex = 0;
        ClearScope();
    }
    private async Task SaveRoadmap()
    {
        if (loadedProject != ProjectId) throw new IOException("현재 프로젝트의 로드맵을 먼저 읽으세요.");
        var response = await Invoke("desktop.roadmap.save", new { projectId = ProjectId, expectedRevision = roadmapRevision, roadmap = JsonNode.Parse(RoadmapEditor.Text) });
        SetRoadmap(response);
    }
    private async Task PreviewRoadmap()
    {
        ClearScope();
        if (loadedProject != ProjectId || roadmapRevision == null || RoadmapEditor.Text != savedRoadmap) throw new IOException("편집한 로드맵을 먼저 저장하세요.");
        var selection = new { phase = RoadmapPhase.SelectedItem, first = RoadmapFirst.SelectedItem, last = RoadmapLast.SelectedItem };
        scope = await Invoke("desktop.roadmap.preview", new { projectId = ProjectId, selection });
        if (Text(scope, "revision") != roadmapRevision) { ClearScope(); throw new IOException("파일이 바뀌었습니다. 로드맵을 다시 읽으세요."); }
        var issues = scope["issues"]!.AsArray();
        var lines = new List<string> { issues.Count == 0 ? "실행 가능한 구간" : "확인 필요" };
        lines.AddRange(issues.Select(i => i!.ToString()));
        var inputs = scope["files"]!.AsArray().ToDictionary(f => Text(f, "path"), f => Text(f, "hash"));
        if (scope["excerpts"] is JsonArray sections)
            foreach (var section in sections) inputs[Text(section,"reference")] = Text(section,"hash");
        if (lastInputs.Count > 0)
            foreach (var path in lastInputs.Keys.Union(inputs.Keys).Where(k => lastInputs.GetValueOrDefault(k) != inputs.GetValueOrDefault(k)))
                lines.Add("변경된 입력 · " + path);
        lastInputs.Clear();
        foreach (var pair in inputs) lastInputs.Add(pair.Key, pair.Value);
        foreach (var node in scope["nodes"]!.AsArray())
            lines.Add($"{Text(node, "milestone")} / {Text(node, "id")} · {Text(node, "title")}\n선행 {node!["dependsOn"]} · 허용 파일 {node["outputs"]}\n적용 문서 {node["context"]}");
        RoadmapSummary.Text = string.Join("\n", lines);
    }
}
