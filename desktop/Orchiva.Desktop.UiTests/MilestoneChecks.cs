using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Text.Json;
using System.Text.Json.Nodes;
using Windows.Graphics;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;

namespace Orchiva.Desktop;

internal static class MilestoneChecks
{
    public static async Task Run(MainWindow window, ProductionWorkspace w, WorkspaceFixture mock, string output)
    {
        var calls = new List<string>();
        var prHead=new string('b',40);
        JsonNode? mergeRequest=null, lastCreation=null;
        string state="active"; int revision=1;
        var map = new { version = 1, phases = new[] { new { id = "P", milestones = new[] { "One", "Five", "Six" }.Select(id => new { id, features = Array.Empty<object>() }) } } };
        w.Connect(async (method, input) =>
        {
            calls.Add(method);
            if (method == "desktop.roadmap.read") return JsonSerializer.SerializeToElement(new { revision = "r", roadmap = map });
            if (method == "desktop.roadmap.preview")
            {
                var s = JsonSerializer.SerializeToNode(input)!["selection"]!;
                var first = s["first"]!.ToString(); var last = s["last"]!.ToString();
                int count = last == "One" ? 1 : first == "One" ? 6 : 5;
                var nodes = Enumerable.Range(1,count).Select(i => new { id = $"F{i}", title = "점수 표시", milestone = last, dependsOn = Array.Empty<string>(), outputs = new[]{"hud.txt"}, context = new[]{"AGENTS.md"} });
                return JsonSerializer.SerializeToElement(new { revision="r", hash="ui-scope", selection=s, files=Array.Empty<object>(), nodes, issues = last == "Six" ? new[]{"최대 5개 · 다른 Milestone으로 분할하세요."} : Array.Empty<string>() });
            }
            if(method=="desktop.runs.create")
            {
                var submitted=JsonSerializer.SerializeToNode(input)!;
                lastCreation=submitted;
                if (submitted["scopeHash"]?.ToString()!="ui-scope" || submitted["parent"]!=null || submitted["provider"]==null)
                    throw new Exception("Milestone creation changed the confirmed scope or model");
                return JsonSerializer.SerializeToElement(new {runId="ma-ui-0001"});
            }
            if (method=="desktop.runs.list") return JsonSerializer.SerializeToElement(new[] { new {runId="ma-ui-0001"} });
            if (method=="desktop.runs.get" || method=="desktop.runs.control")
            {
                if(method=="desktop.runs.control") { state=JsonSerializer.SerializeToNode(input)!["action"]!.ToString()=="pause"?"paused":"active"; revision++; }
                return JsonSerializer.SerializeToElement(new { runId="ma-ui-0001",state,revision,reason=state=="paused"?"신규 배정 대기":"PLAN 승인 대기",
                    nodes=new[]{new {id="A",token="ui-request-001",status="ready",resultId=(string?)null}},
                    advisors=new[]{new {milestone="One",status="skipped",report=""}} });
            }
            if(method=="desktop.integration.get" || method=="desktop.integration.sync")
            {
                if(method.EndsWith(".sync")) mergeRequest=JsonSerializer.SerializeToNode(input);
                return JsonSerializer.SerializeToElement(new {settings=new {mode="local",target="integration",headPrefix="feature"},
                    entries=new[]{new {feature="A",head=new string('c',40),remote=new {head=prHead,body="Approved fixture",pr=2}}}});
            }
            return await mock.Call(method,input);
        });
        w.EnableRoadmap(true);
        async Task Capture(string filename, UIElement? surface=null)
        {
            var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(surface ?? w);
            var pixels = await bitmap.GetPixelsAsync();
            using var reader = DataReader.FromBuffer(pixels);
            byte[] data = new byte[pixels.Length]; reader.ReadBytes(data);
            using var stream = File.Create(Path.Combine(output,filename));
            using var target = stream.AsRandomAccessStream();
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId,target);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8,BitmapAlphaMode.Premultiplied,(uint)bitmap.PixelWidth,(uint)bitmap.PixelHeight,96,96,data);
            await encoder.FlushAsync();
        }
        var goal = Access.Get<TextBox>(w,"GoalInput").Text;
        await Access.Action(w,"roadmap-open");
        var first = Access.Get<ComboBox>(w,"RoadmapFirst"); var last = Access.Get<ComboBox>(w,"RoadmapLast");
        var summary = Access.Get<TextBlock>(w,"RoadmapSummary");
        foreach (var width in new[]{1280,800})
        {
            window.AppWindow.Resize(new SizeInt32(width,850)); await Task.Delay(250);
            foreach (var (a,b,expected) in new[]{(0,0,"F1"),(1,1,"F5"),(0,1,"F6"),(2,2,"분할")})
            {
                first.SelectedIndex=a; last.SelectedIndex=b;
                await Access.Action(w,"roadmap-preview");
                if (!summary.Text.Contains(expected)) throw new Exception($"Roadmap range preview missing: {expected}; {Access.Get<InfoBar>(w, "Notice").Message}; calls {string.Join(",", calls)}");
            }
            await Capture($"roadmap-{width}.png");
        }
        w.EnableRuns(true);
        await Access.Action(w,"run-create");
        if(calls.Contains("desktop.runs.create")) throw new Exception("Invalid range created a run");
        first.SelectedIndex=0;last.SelectedIndex=0;await Access.Action(w,"roadmap-preview");
        await Access.Action(w,"run-create");
        if(!calls.Contains("desktop.runs.create")) throw new Exception("Valid range did not create a run");
        if(lastCreation?["workers"]!=null) throw new Exception("Default run must use one worker");
        w.EnableIntegration(true);
        Access.Get<ComboBox>(w,"GitAcceptance").SelectedIndex=1;
        Access.Get<CheckBox>(w,"ParallelWorkers").IsChecked=true;
        Access.Get<CheckBox>(w,"UnityGateRequired").IsChecked=true;
        Access.Get<CheckBox>(w,"ContinueIndependent").IsChecked=true;
        await Access.Action(w,"run-create");
        if(lastCreation?["unityProfile"]?.ToString()!="hud-win64-v1" || lastCreation?["workers"]?.GetValue<int>()!=2 || lastCreation["failurePolicy"]?.ToString()!="continue-independent" ||
            lastCreation["integration"]?["mode"]?.ToString()!="local") throw new Exception("Parallel settings missing");
        await Access.Action(w,"run-list");
        await Access.Action(w,"run-pause");
        if (!Access.Get<TextBlock>(w,"RunReport").Text.Contains("paused")) throw new Exception("Run pause status missing");
        w.ShowPage("request");
        if (Access.Get<TextBox>(w,"GoalInput").Text != goal) throw new Exception("Manual request changed during pause");
        w.ShowPage("roadmap");
        await Access.Action(w,"run-resume");
        await Capture("run-resumed-800.png");
        w.EnableIntegration(true);
        await Access.Action(w,"git-read");
        if(!Access.Get<TextBlock>(w,"GitReport").Text.Contains(prHead)) throw new Exception("Remote PR head missing");
        await Access.Action(w,"git-owner-merge");
        if(mergeRequest?["action"]?.ToString()!="owner-merge" || mergeRequest["expectedHead"]?.ToString()!=prHead)
            throw new Exception("Owner approval did not carry the displayed PR head");
        if(!Access.Get<TextBlock>(w,"RunReport").Text.Contains("active")) throw new Exception("Run resume status missing");
        w.ShowPage("request");
        if(Access.Get<TextBox>(w,"GoalInput").Text != goal || calls.Any(c=>c.StartsWith("desktop.requests.start"))) throw new Exception("Unexpected draft or execution effect");
        await File.WriteAllTextAsync(Path.Combine(output,"roadmap-ui.json"),JsonSerializer.Serialize(new { widths=new[]{1280,800}, ranges=new[]{"1","5","1+5","6 blocked"}, calls }));
        var acceptanceRun=Environment.GetEnvironmentVariable("ORCHIVA_MA6_RUN");
        var acceptanceProject=Environment.GetEnvironmentVariable("ORCHIVA_MA6_PROJECT_ID");
        var parallelProject=Environment.GetEnvironmentVariable("ORCHIVA_MA4_PROJECT_ID");
        var projectId=acceptanceProject ?? parallelProject ?? Environment.GetEnvironmentVariable("ORCHIVA_MA3_PROJECT_ID");
        if(!string.IsNullOrEmpty(projectId))
        {
            var config=Environment.GetEnvironmentVariable("ORCHIVA_DESKTOP_CONFIG")!;
            var options=JsonSerializer.Deserialize<Orchiva.Bridge.LaunchOptions>(File.ReadAllText(config),
                new JsonSerializerOptions {PropertyNameCaseInsensitive=true})!;
            var fixture=Path.GetFileName(options.IsolationRoot);
            if(!fixture.StartsWith(acceptanceProject!=null?"d1-ma-accept-":parallelProject==null?"d1-ma3-":"d1-ma-parallel-")) throw new Exception("Isolated milestone fixture required");
            await using var bridge=new Orchiva.Bridge.BridgeClient(options);
            var handshake=await bridge.HandshakeAsync();
            if(!handshake.GetProperty("isolated").GetBoolean())throw new Exception("Unexpected runtime");
            var projects=await bridge.CallAsync("desktop.projects.list",new {});
            var selected=projects.EnumerateArray().Single(p=>p.GetProperty("projectId").GetString()==projectId);
            Access.Set(w,"project",JsonNode.Parse(selected.GetRawText())!.AsObject());
            Access.Set(w,"document",null);
            w.Connect((method,input)=>bridge.CallAsync(method,input)); w.EnableIntegration(true);
            await Access.Action(w,"roadmap-open"); await Access.Action(w,"run-list");
            if(acceptanceProject!=null)
            {
                if(string.IsNullOrWhiteSpace(acceptanceRun) || !(acceptanceRun.StartsWith("d1-ma-accept-") || Guid.TryParse(acceptanceRun,out _)))
                    throw new Exception("Isolated MA6 run required");
                var registered=await bridge.CallAsync("desktop.projects.register",new {sourceRoot=selected.GetProperty("sourceRoot").GetString(),name=selected.GetProperty("name").GetString()});
                if(registered.GetProperty("projectId").GetString()!=projectId)throw new Exception("Project identity changed");
                Access.Get<ComboBox>(w,"RunChoice").SelectedItem=acceptanceRun;
                await Access.Action(w,"run-read");
                var acceptancePanel=Access.Get<StackPanel>(w,"PhasePanel");
                var report=Access.Get<TextBlock>(w,"PhaseReport");
                if(acceptancePanel.Visibility!=Visibility.Visible || report.Text.Length==0)throw new Exception("Missing phase report");
                if(Environment.GetEnvironmentVariable("ORCHIVA_MA6_RECOVERY")=="rerun")
                {
                    if(!fixture.Contains("-recovery-") || !report.Text.Contains("PHASE_LOCAL_EVIDENCE_REQUIRED"))throw new Exception("Missing foreign resource warning: "+report.Text);
                    await File.WriteAllTextAsync(Path.Combine(output,"foreign-ui.txt"),report.Text);
                    var rangeFirst=Access.Get<ComboBox>(w,"RoadmapFirst");
                    var rangeLast=Access.Get<ComboBox>(w,"RoadmapLast");
                    rangeFirst.SelectedItem=rangeLast.SelectedItem="Dependent";
                    await Access.Action(w,"roadmap-preview");
                    var blocked=Access.Get<TextBlock>(w,"RoadmapSummary").Text;
                    if(!blocked.Contains("범위 밖 선행"))throw new Exception("Missing dependency gate: "+blocked);
                    rangeFirst.SelectedItem=rangeLast.SelectedItem="Broken";
                    await Access.Action(w,"roadmap-preview");
                    await (Task)Access.Call(w,"LoadProject")!;
                    var modelList=Access.Get<ComboBox>(w,"ModelChoice").ItemsSource;
                    var model=Access.Get<ComboBox>(w,"RunModel");model.ItemsSource=modelList;
                    model.SelectedItem=((IEnumerable<WorkspaceChoice>)modelList).First(m=>m.Value["provider"]?.ToString()=="codex/gpt-6.1-sol");
                    Access.Get<ComboBox>(w,"GitAcceptance").SelectedIndex=1;
                    Access.Get<TextBox>(w,"GitTarget").Text="orchiva/integration/maze";
                    await Access.Action(w,"run-rerun");
                    var created=Access.Get<ComboBox>(w,"RunChoice").SelectedItem?.ToString();
                    if(!Guid.TryParse(created,out _))throw new Exception("Rerun failed: "+Access.Get<InfoBar>(w,"Notice").Message);
                    await File.WriteAllTextAsync(Path.Combine(output,"rerun.json"),JsonSerializer.Serialize(new {parent=acceptanceRun,runId=created,blocked}));
                }
                if(Environment.GetEnvironmentVariable("ORCHIVA_MA6_FAILURE")=="1")
                {
                    var progress=Access.Get<TextBlock>(w,"RunReport").Text;
                    if(!progress.Contains("Unity integration · Mismatch · failed") || !report.Text.Contains("PHASE_PARTIAL_RANGE") || Access.Get<Button>(w,"PhaseApprove").IsEnabled)
                        throw new Exception("Missing failed build or partial-range gate");
                    await File.WriteAllTextAsync(Path.Combine(output,"failed-build-ui.txt"),progress);
                }
                var verdict=Environment.GetEnvironmentVariable("ORCHIVA_MA6_VERDICT");
                if(verdict!=null)
                {
                    if(verdict!="approve" && verdict!="reject")throw new Exception("Invalid decision");
                    var basis=Environment.GetEnvironmentVariable("ORCHIVA_MA6_BASIS");
                    var note=Environment.GetEnvironmentVariable("ORCHIVA_MA6_NOTE");
                    if(string.IsNullOrWhiteSpace(basis) || string.IsNullOrWhiteSpace(note) || basis!=Access.Get<string>(w,"phaseBasis"))
                        throw new Exception("Decision must match displayed evidence");
                    Access.Get<TextBox>(w,"PhaseNote").Text=note;
                    await Access.Action(w,"phase-"+verdict);
                    if(!report.Text.Contains(note))throw new Exception("Decision missing from history: "+Access.Get<InfoBar>(w,"Notice").Message);
                }
                window.AppWindow.Resize(new SizeInt32(1100,850));
                acceptancePanel.StartBringIntoView(new BringIntoViewOptions { AnimationDesired=false,VerticalAlignmentRatio=0 });
                await Task.Delay(450);
                await Capture("phase-review.png",window.Content);
                await File.WriteAllTextAsync(Path.Combine(output,"phase-ui.json"),JsonSerializer.Serialize(new {projectId,run=acceptanceRun,report=report.Text,registered=true}));
                w.Connect(mock.Call);return;
            }
            if(parallelProject!=null)
            {
                Access.Get<ComboBox>(w,"RunChoice").SelectedItem=fixture+"-parallel";
                await Access.Action(w,"run-read");
                var report=Access.Get<TextBlock>(w,"RunReport");
                if(!report.Text.Contains("예약 ") || !report.Text.Contains("B ·") || !report.Text.Contains("C ·"))
                    throw new Exception("Live parallel reservation report missing: "+report.Text);
                var unity=Environment.GetEnvironmentVariable("ORCHIVA_MA5_UI")=="1";
                if(unity && (!report.Text.Contains("Unity integration · B · failed") || !report.Text.Contains("Unity integration · C · passed") || !report.Text.Contains("SCORE 10")))
                    throw new Exception("Unity verdicts or player evidence missing: "+report.Text);
                foreach (var width in new[]{800,1280})
                {
                    window.AppWindow.Resize(new SizeInt32(width,850));
                    await Task.Delay(200);
                    ((Grid)window.Content).Background=new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.White);
                    report.StartBringIntoView(new BringIntoViewOptions { AnimationDesired=false, VerticalAlignmentRatio=0 });
                    await Task.Delay(250);
                    await Capture($"{(unity?"unity":"parallel")}-{width}.png",window.Content);
                }
                await File.WriteAllTextAsync(Path.Combine(output,"parallel-ui.json"),JsonSerializer.Serialize(new {projectId,report=report.Text}));
                w.Connect(mock.Call);
                return;
            }
            await Access.Action(w,"git-read");
            var panel=Access.Get<Expander>(w,"GitIntegrationPanel");panel.IsExpanded=true;
            var feature=Access.Get<ComboBox>(w,"GitFeature");feature.SelectedItem="B";
            var result=Access.Get<TextBlock>(w,"GitReport");result.StartBringIntoView();
            await Task.Delay(500);
            if(!result.Text.Contains("/issues/") || !result.Text.Contains("/pull/") ||
               !Access.Get<TextBox>(w,"GitPublicPlan").Text.Contains("uppercase label")) throw new Exception("Live PR, Issue or reconciled PLAN missing: "+result.Text);
            await Capture("github-live.png");
            await File.WriteAllTextAsync(Path.Combine(output,"github-ui.json"),JsonSerializer.Serialize(new {projectId,feature="B",report=result.Text,provider="real desktop bridge"}));
        }
        w.Connect(mock.Call);
    }
}
