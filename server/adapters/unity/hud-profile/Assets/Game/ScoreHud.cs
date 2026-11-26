using System;
using System.Collections;
using System.IO;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.SceneManagement;

public class ScoreHud : MonoBehaviour
{
    public TextAsset rules;
    public TextAsset expectedLabel;
    public TextMesh display;
    public int Score { get; private set; }
    public int Award => int.Parse(Field("score"));
    public string Label => Field("label");

    private string Field(string name)
    {
        var match = Regex.Match(rules.text, "^" + name + @": ([^\r\n]+)\r?$", RegexOptions.Multiline);
        if (!match.Success) throw new InvalidDataException(name);
        return match.Groups[1].Value;
    }
    private void Awake() { RefreshHud(); }
    private void RefreshHud() { display.text = Label + " " + Score; }
    public void Collect() { Score += Award; RefreshHud(); }
    private void OnGUI()
    {
        if (GUI.Button(new Rect(20,20,150,50), "Collect score")) Collect();
    }

    private IEnumerator Start()
    {
        string nonce = Environment.GetEnvironmentVariable("ORCHIVA_PLAYER_NONCE");
        if (Application.isEditor || string.IsNullOrEmpty(nonce)) yield break;
        yield return null;
        string before = display.text;
        Collect();
        yield return null;
        var signal = new Signal { nonce=nonce, scene=SceneManager.GetActiveScene().name, before=before,
            score=Score, after=display.text, frame=Time.frameCount, visible=display.GetComponent<Renderer>().enabled };
        File.WriteAllText(Environment.GetEnvironmentVariable("ORCHIVA_PLAYER_SIGNAL"), JsonUtility.ToJson(signal));
        Application.Quit();
    }
    [Serializable] private class Signal { public string nonce, scene, before, after; public int score, frame; public bool visible; }
}
