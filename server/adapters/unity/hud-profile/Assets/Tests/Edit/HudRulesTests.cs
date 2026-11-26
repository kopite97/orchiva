using NUnit.Framework;
using UnityEditor;
using UnityEngine;

public class HudRulesTests
{
    [Test] public void ApprovedAward()
    {
        var rules=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Input/Rules.txt");
        Assert.That(rules.text.Replace("\r","").Split('\n'),Does.Contain("score: 10"));
    }
    [Test] public void ApprovedLabel()
    {
        Assert.AreEqual("SCORE",AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Input/Label.txt").text.Trim());
    }
}
