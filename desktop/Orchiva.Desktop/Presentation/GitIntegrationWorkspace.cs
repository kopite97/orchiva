using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Orchiva.Desktop;

public sealed partial class ProductionWorkspace
{
    private JsonNode? integrationState;
    public void EnableIntegration(bool enabled) => GitIntegrationPanel.Visibility=enabled?Visibility.Visible:Visibility.Collapsed;

    private void ClearGitView()
    {
        integrationState=null;
        GitFeature.ItemsSource=null;
        GitReport.Text=GitPublicPlan.Text="";
    }
    private JsonObject GitPolicy()
    {
        var policy=new JsonObject { ["mode"]=GitAcceptance.SelectedIndex==2?"github":"local", ["target"]=GitTarget.Text.Trim(), ["headPrefix"]=GitPrefix.Text.Trim() };
        if (!string.IsNullOrWhiteSpace(GitRepository.Text))
        {
            if(!long.TryParse(GitRepoId.Text,out var id) || id<1) throw new IOException("저장소 숫자 ID를 확인하세요.");
            var checks=new JsonArray();
            foreach(var name in GitChecks.Text.Split(',',StringSplitOptions.RemoveEmptyEntries|StringSplitOptions.TrimEntries)) checks.Add(name);
            policy["github"]=new JsonObject { ["repo"]=GitRepository.Text.Trim(), ["repoId"]=id, ["base"]=GitBase.Text.Trim(), ["checks"]=checks };
        }
        return policy;
    }
    private void ApplyGitPolicy(JsonNode? settings)
    {
        if(settings==null) throw new IOException("저장된 프로젝트 정책이 없습니다.");
        GitTarget.Text=Text(settings,"target");GitPrefix.Text=Text(settings,"headPrefix");
        GitAcceptance.SelectedIndex=Text(settings,"mode")=="github"?2:1;
        var remote=settings["github"];
        GitRepository.Text=Text(remote,"repo");GitRepoId.Text=Text(remote,"repoId");GitBase.Text=Text(remote,"base");
        GitChecks.Text=string.Join(", ",remote?["checks"]?.AsArray().Select(c=>c!.ToString())??Array.Empty<string>());
    }
    private void GitFeatureChanged(object sender, SelectionChangedEventArgs args)
    {
        if(integrationState==null || GitFeature.SelectedItem is not string feature) return;
        var entry=integrationState["entries"]!.AsArray().First(e=>Text(e,"feature")==feature);
        var remote=entry!["remote"];
        GitPublicPlan.Text=Text(remote,"body");
        var repo=Text(integrationState["settings"]?["github"],"repo");
        GitReport.Text=$"{feature} · {Text(entry,"branch")}\n기준 {Text(entry,"base")}\nFeature {Text(entry,"head")}\n통합 {Text(entry,"integrated")}\n결과 {Text(entry,"result")}";
        if(remote!=null)
        {
            GitReport.Text+="\n"+Text(remote,"phase")+" "+Text(remote,"pending")+" "+Text(remote,"lastError");
            GitReport.Text+="\nPR 커밋 "+Text(remote,"head")+"\n원격 기준 "+Text(remote,"base");
            if(remote["merge"]!=null)
            {
                var approval=Text(remote["gate"],"mode")=="owner"?"소유자 승인":"독립 리뷰";
                GitReport.Text+=$"\n원격 병합 {Text(remote,"merge")} · {approval}";
            }
            if(remote["issue"]!=null) GitReport.Text+=$"\nhttps://github.com/{repo}/issues/{remote["issue"]}";
            if(remote["pr"]!=null) GitReport.Text+=$"\nhttps://github.com/{repo}/pull/{remote["pr"]}";
            if(remote["remoteBody"]!=null) GitReport.Text+="\n원격에서 변경된 본문\n"+Text(remote,"remoteBody");
        }
    }
    private async Task GitAction(string action)
    {
        if(displayedRun==null || loadedProject!=ProjectId || RunChoice.SelectedItem is not string id || Text(displayedRun,"runId")!=id)
            throw new IOException("현재 프로젝트에서 실행을 선택하고 진행 상황을 먼저 조회하세요.");
        var input=new JsonObject { ["projectId"]=ProjectId,["runId"]=id };
        string? selected=GitFeature.SelectedItem as string;
        string method;
        switch(action)
        {
            case "git-configure": method="configure";input["settings"]=GitPolicy();break;
            case "git-read":method="get";break;
            case "git-advance":method="advance";break;
            default:
                if(selected==null || integrationState==null) throw new IOException("통합 결과를 조회하고 Feature를 선택하세요.");
                method="sync";input["feature"]=selected;input["body"]=GitPublicPlan.Text;input["action"]=action.Substring(4);
                var entry=integrationState["entries"]!.AsArray().First(e=>Text(e,"feature")==selected);
                if(action=="git-owner-merge") input["expectedHead"]=Text(entry?["remote"],"head");
                if(entry?["remote"]?["remoteBody"] is JsonNode observed)
                    input["observedHash"]=Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(observed.ToString())));
                break;
        }
        integrationState=await Invoke("desktop.integration."+method,input);
        if(integrationState==null){ClearGitView();GitReport.Text="이 실행에 통합 정책을 먼저 설정하세요.";return;}
        ApplyGitPolicy(integrationState["settings"]);
        var features=integrationState["entries"]!.AsArray().Select(e=>Text(e,"feature")).ToList();
        GitReport.Text=Text(integrationState["settings"],"target")+" · 통합 대상 "+features.Count+"건";
        GitFeature.ItemsSource=features;
        GitFeature.SelectedItem=selected!=null && features.Contains(selected)?selected:features.LastOrDefault();
    }
}
