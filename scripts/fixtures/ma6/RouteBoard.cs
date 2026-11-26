using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

public class RouteBoard : MonoBehaviour
{
    [Serializable] private class Level { public string title, solution; public string[] rows; public int required; }
    [Serializable] private class Signal { public string name, nonce; public int moves, collected; public bool cleared, wallBlocked; }
    private Level level;
    private Vector2Int position;
    private readonly HashSet<Vector2Int> picked = new HashSet<Vector2Int>();
    private int moves;
    private bool cleared;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Open() { new GameObject("Playable level").AddComponent<RouteBoard>(); }

    void Awake()
    {
        level = JsonUtility.FromJson<Level>(Resources.Load<TextAsset>("Route").text);
        ResetBoard();
        string report = Environment.GetEnvironmentVariable("ORCHIVA_LEVEL_SIGNAL");
        if (Application.isEditor || String.IsNullOrEmpty(report)) return;
        bool blocked = !Move('L');
        foreach (char step in level.solution) Move(step);
        File.WriteAllText(report, JsonUtility.ToJson(new Signal {
            name=level.title, nonce=Environment.GetEnvironmentVariable("ORCHIVA_PLAYER_NONCE"),
            moves=moves, collected=picked.Count, cleared=cleared, wallBlocked=blocked
        }));
    }

    void ResetBoard()
    {
        moves=0; cleared=false; picked.Clear();
        for(int y=0;y<level.rows.Length;y++)
            for(int x=0;x<level.rows[y].Length;x++) if(level.rows[y][x]=='S') position=new Vector2Int(x,y);
    }

    private bool Move(char direction)
    {
        if(cleared) return false;
        var offset = direction=='R'?Vector2Int.right:direction=='L'?Vector2Int.left:direction=='D'?Vector2Int.up:Vector2Int.down;
        var next=position+offset;
        if(next.y<0 || next.y>=level.rows.Length || next.x<0 || next.x>=level.rows[next.y].Length) return false;
        char tile=level.rows[next.y][next.x];
        if(tile=='#' || (tile=='E' && !GoalRule.Open(picked.Count,level.required)))return false;
        position=next; moves++;
        if(tile=='*')picked.Add(position);
        cleared=tile=='E'; return true;
    }

    void OnGUI()
    {
        GUI.Box(new Rect(8,78,390,275),level.title);
        for(int y=0;y<level.rows.Length;y++) for(int x=0;x<level.rows[y].Length;x++) {
            var cell=new Vector2Int(x,y);
            string symbol=cell==position?"YOU":picked.Contains(cell)?" ":level.rows[y][x].ToString();
            GUI.Box(new Rect(20+x*45,108+y*35,43,33),symbol);
        }
        if(Event.current.type==EventType.KeyDown){
            var keys=new Dictionary<KeyCode,char>{{KeyCode.UpArrow,'U'},{KeyCode.DownArrow,'D'},{KeyCode.LeftArrow,'L'},{KeyCode.RightArrow,'R'}};
            if(keys.TryGetValue(Event.current.keyCode,out char d)){Move(d);Event.current.Use();}
        }
        GUI.Label(new Rect(20,265,360,30),cleared?"CLEAR":"Arrow keys to move   |   Stars "+picked.Count+" / "+level.required);
        if(GUI.Button(new Rect(20,301,80,34),"Restart")) ResetBoard();
    }
}
