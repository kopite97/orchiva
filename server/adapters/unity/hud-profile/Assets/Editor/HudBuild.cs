using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class HudBuild
{
    public const string ScenePath = "Assets/Hud.unity";
    public static void Build()
    {
        var path=Environment.GetEnvironmentVariable("ORCHIVA_BUILD_EXE");
        var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes=new[]{ScenePath}, locationPathName=path,
            target=BuildTarget.StandaloneWindows64, options=BuildOptions.None });
        var s=report.summary;
        File.WriteAllText(Environment.GetEnvironmentVariable("ORCHIVA_BUILD_REPORT"),JsonUtility.ToJson(new Summary {
            result=s.result.ToString(),target=s.platform.ToString(), errors=(int)s.totalErrors, bytes=s.totalSize.ToString(),output=s.outputPath }));
        if(s.result!=BuildResult.Succeeded || s.totalErrors!=0) EditorApplication.Exit(2);
    }
    [Serializable] private class Summary { public string result,target,bytes,output; public int errors; }
}

public class HudSceneCheck : IProcessSceneWithReport
{
    public int callbackOrder => 0;
    public void OnProcessScene(UnityEngine.SceneManagement.Scene scene, BuildReport report)
    {
        if(report==null || scene.path!=HudBuild.ScenePath) return;
        var hud=UnityEngine.Object.FindFirstObjectByType<ScoreHud>();
        if(!hud || !hud.display || !hud.rules || !hud.expectedLabel || hud.Label!=hud.expectedLabel.text.Trim())
            throw new BuildFailedException("HUD_SCENE_LABEL_REFERENCE_MISMATCH");
    }
}
