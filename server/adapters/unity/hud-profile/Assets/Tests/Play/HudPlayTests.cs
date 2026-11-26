using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

public class HudPlayTests
{
    [UnityTest] public IEnumerator CollectUpdatesSceneHud()
    {
        yield return SceneManager.LoadSceneAsync("Hud");
        var hud=Object.FindFirstObjectByType<ScoreHud>();
        Assert.AreEqual(hud.Label+" 0",hud.display.text);
        hud.Collect();
        yield return null;
        Assert.AreEqual(10,hud.Score);
        Assert.AreEqual(hud.Label+" 10",hud.display.text);
    }
}
