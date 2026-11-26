import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, statfs, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntimeSettings } from "../../config/runtime-settings";
import { gitBytes, gitText } from "../storage/integration-git";
import { DirectoryOwner } from "../storage/directory-owner";
import { absent, atomic } from "../storage/project-files";
import { boundedText, editorVersion, editTests, fileHash, inspectCommit, inventory, playTests, verifyLog, verifyXml } from "./evidence";

export const unityProfile="hud-win64-v1";
async function installedProfile() {
  if(import.meta.url)return join(dirname(fileURLToPath(import.meta.url)),"hud-profile");
  const config=JSON.parse(await readFile(join(readRuntimeSettings().paseoHome,"config.json"),"utf8"));
  const plugin=config.plugins?.["orchiva-plugin"];
  if(plugin?.source!=="directory" || typeof plugin.path!=="string")throw Error("UNITY_PROFILE_MISSING");
  return join(plugin.path,"server/adapters/unity/hud-profile");
}
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
const json=(f:string,data:unknown)=>atomic(f,JSON.stringify(data,null,2));
const budget=8*1024**3;
const normalize=(text:string)=>text.replace(/\r\n/g,"\n");
async function pins(profileRoot:string) {
  return JSON.parse(await readFile(join(profileRoot,"..","hud-profile.json"),"utf8")) as Record<string,string>;
}
export async function verifyProfile(project:string,baseline:Record<string,string>) {
  for(const [name,hash] of Object.entries(baseline))
    if(digest(normalize(await readFile(join(project,name),"utf8")))!==hash)throw Error("UNITY_PROFILE_CHANGED: "+name);
}
export type UnityStage={name:string;started?:number;pid?:number;exit?:number|null;ms?:number;logHash?:string;libraryBytes?:number;xmlHash?:string;cases?:string[]};
export type UnityResult={version:1;attempt:string;sha:string;profile:string;status:"passed"|"failed"|"blocked";reason:string;directory:string;stages:UnityStage[];peakSampledBytes:number;
  profileHash?:string;inputHash?:string;playerHash?:string;buildHash?:string;signal?:{before:string;after:string;scene:string;score:number};editor:string;level?:{name:string;moves:number;collected:number;cleared:boolean}};

export async function checkEditor(editor:string) {
  await access(editor).catch(()=>{throw Error("UNITY_EDITOR_MISSING");});
  await access(join(dirname(editor),"Data/PlaybackEngines/WindowsStandaloneSupport")).catch(()=>{throw Error("UNITY_MODULE_MISSING");});
}
function alive(pid:number) {
  if(!Number.isInteger(pid) || pid<=0)return true;
  try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=="ESRCH";}
}
export async function editorReserved(storage:string) {
  let owner:{pid:number;attempt:string};
  try{owner=JSON.parse(await readFile(join(storage,"editor.lock"),"utf8"));}catch(e){if(absent(e))return false;throw e;}
  if(alive(owner.pid) || !/^[a-f0-9-]{36}$/.test(owner.attempt))return true;
  try{
    const proc=JSON.parse(await readFile(join(storage,owner.attempt,"process.json"),"utf8"));
    return proc.attempt!==owner.attempt || alive(proc.pid);
  }catch(e){if(absent(e))return false;throw e;}
}
export async function runUnityGate(repo:string,sha:string,storage:string,attempt:string,kind:"integration"|"plan"="integration",planTests:string[]=editTests,levelProfile=false):Promise<UnityResult> {
  if(!/^[a-f0-9-]{36}$/.test(attempt) || !/^[a-f0-9]{40}$/.test(sha))throw Error("UNITY_ATTEMPT_INVALID");
  const directory=join(storage,attempt),source=join(directory,"source");
  let project=join(directory,"project");
  const editor=join(process.env.ProgramFiles??"C:/Program Files","Unity","Hub","Editor",editorVersion,"Editor","Unity.exe");
  const result:UnityResult={version:1,attempt,sha,profile:unityProfile,status:"blocked",reason:"",directory,stages:[],peakSampledBytes:0,editor:editorVersion};
  await mkdir(storage,{recursive:true});
  const lock=join(storage,"editor.lock");
  const admission=new DirectoryOwner(storage);
  await admission.open().catch(()=>{throw Error("UNITY_EDITOR_BUSY");});
  try{
    if(await editorReserved(storage))throw Error("UNITY_EDITOR_BUSY");
    await json(lock,{pid:process.pid,attempt});
  }finally{await admission.close();}
  try {
    await mkdir(directory);
    const report=join(directory,"result.json");
    const measure=async()=>{
      const used=(await inventory(directory)).reduce((sum,f)=>sum+f.bytes,0);
      result.peakSampledBytes=Math.max(result.peakSampledBytes,used);
      if(used>budget)throw Error("UNITY_DISK_BUDGET");
    };
    async function launch(name:string,exe:string,args:string[],env:Record<string,string>={}) {
      const row:UnityStage={name},log=join(directory,name+".log");
      result.stages.push(row);
      await json(join(directory,"process.json"),{attempt,stage:name,exe,phase:"launching"});
      const start=Date.now(),child=spawn(exe,[...args,"-logFile",log],{cwd:project,windowsHide:true,stdio:"ignore",env:{...process.env,...env}});
      row.pid=child.pid;row.started=start;
      let timeout=false;
      const timer=setTimeout(()=>{timeout=true;child.kill();},name==="player"?60000:600000);
      let sampling:Promise<void>|undefined,overBudget=false;
      const sampler=setInterval(()=>{
        if(!sampling)sampling=measure().catch(e=>{
          if(!absent(e)){overBudget=true;child.kill();}
        }).finally(()=>{sampling=undefined;});
      },5000);
      const ended=new Promise<number|null>((yes,no)=>{child.once("error",no);child.once("close",yes);});
      void ended.catch(()=>{});
      try {
        await json(join(directory,"process.json"),{attempt,stage:name,pid:child.pid,exe,started:new Date(start).toISOString()});
        row.exit=await ended;
      } catch(error) {child.kill();await ended.catch(()=>{});throw error;}
      finally {clearTimeout(timer);clearInterval(sampler);await sampling;row.ms=Date.now()-start;}
      if(overBudget)throw Error("UNITY_DISK_BUDGET");
      if(timeout) throw Error("UNITY_TIMEOUT: "+name);
      const logText=await boundedText(log,32*1024*1024);
      row.logHash=await fileHash(log);
      if(row.exit!==0)throw Error(/No valid Unity Editor license|No valid license found|Failed to activate license/i.test(logText)?"UNITY_LICENSE":"UNITY_PROCESS_FAILED: "+name);
      verifyLog(name,logText);
      if(exe===editor && !logText.includes(editorVersion))throw Error("UNITY_EDITOR_VERSION");
      row.libraryBytes=(await inventory(join(project,"Library"))).reduce((n,f)=>n+f.bytes,0);
      await measure();
      return row;
    }
    try {
      await checkEditor(editor);
      const disk=await statfs(directory);if(disk.bavail*disk.bsize<budget)throw Error("UNITY_DISK_BUDGET");
      const manifest=await inspectCommit(repo,sha);
      await json(join(directory,"input.json"),manifest);result.inputHash=await fileHash(join(directory,"input.json"));
      const native=manifest.files.some(f=>f.path==="ProjectSettings/ProjectVersion.txt");
      if(native)project=source;
      await mkdir(source);await gitText(source,["init","-q"]);
      await gitText(source,["fetch","-q","--depth=1","--no-tags",repo,sha]);
      await gitBytes(source,["-c","core.autocrlf=false","checkout","-q","--detach",sha],undefined,{GIT_LFS_SKIP_SMUDGE:"1"});
      if(await gitText(source,["rev-parse","HEAD"])!==sha || await gitText(source,["status","--porcelain"]))throw Error("UNITY_CHECKOUT_CHANGED");
      const gitDir=resolve(repo,await gitText(repo,["rev-parse","--git-common-dir"]));
      for(const f of manifest.files)if(f.lfs){
        const h=f.lfs.sha256;
        await copyFile(join(gitDir,"lfs","objects",h.slice(0,2),h.slice(2,4),h),join(source,f.path));
      }
      const profileRoot=await installedProfile(),baseline=await pins(profileRoot);result.profileHash=digest(JSON.stringify(baseline));
      if(native){
        if(!manifest.files.some(f=>f.path==="Assets/Hud.unity"))throw Error("UNITY_PROFILE_INPUT_MISMATCH");
        // Keep the actual committed scene, its references and the project's player settings.
        for(const name of ["Assets/Hud.unity","Assets/Hud.unity.meta","ProjectSettings/ProjectSettings.asset","ProjectSettings/EditorBuildSettings.asset"])delete baseline[name];
      }
      for(const name of Object.keys(baseline)) {
        if(native && manifest.files.some(f=>f.path===name))continue;
        if(native && (name.startsWith("Packages/") || name.startsWith("ProjectSettings/")))throw Error("UNITY_PROFILE_INPUT_MISMATCH");
        const dest=join(project,name);await mkdir(dirname(dest),{recursive:true});
        await writeFile(dest,normalize(await readFile(join(profileRoot,name),"utf8")));
      }
      await verifyProfile(project,baseline);
      if(!native)for(const [src,dst] of [["Shared.unity","Rules.txt"],["label.txt","Label.txt"]]) {
        const entry=manifest.files.find(f=>f.path===src);
        if(!entry || entry.bytes>65536)throw Error("UNITY_PROFILE_INPUT_MISMATCH");
        if(entry.lfs && entry.lfs.bytes>65536)throw Error("UNITY_PROFILE_INPUT_MISMATCH");
        await copyFile(join(source,src),join(project,"Assets/Input",dst));
      }
      const common=["-batchmode","-nographics","-projectPath",project,"-buildTarget","Win64"];
      for(const mode of kind==="plan"?["EditMode"]:["EditMode","PlayMode"]) {
        const xml=join(directory,mode+".xml");
        const expected=kind==="plan"?[...new Set(planTests)]:mode==="EditMode"?editTests:playTests;
        if(kind==="plan" && (!expected.length || expected.some(t=>!editTests.includes(t))))throw Error("UNITY_UNKNOWN_TEST");
        const row=await launch(mode,editor,[...common,"-runTests","-testPlatform",mode,"-testResults",xml,...(kind==="plan"?["-testFilter",expected.join(";")]:[])]);
        row.cases=verifyXml(await boundedText(xml),expected,{started:row.started!,ended:row.started!+row.ms!});
        row.xmlHash=await fileHash(xml);
      }
      if(kind==="integration") {
        const playerDir=join(directory,"build"),exe=join(playerDir,"Hud.exe"),buildReport=join(directory,"build.json");
        await mkdir(playerDir);
        await launch("build",editor,[...common,"-quit","-executeMethod","HudBuild.Build"],{ORCHIVA_BUILD_EXE:exe,ORCHIVA_BUILD_REPORT:buildReport});
        const build=JSON.parse(await boundedText(buildReport));
        if(build.result!=="Succeeded" || build.target!=="StandaloneWindows64" || build.errors!==0 || resolve(build.output)!==resolve(exe) || !(Number(build.bytes)>0))throw Error("UNITY_BUILD_REPORT");
        const files=await inventory(playerDir,true);await json(join(directory,"build-files.json"),files);
        result.buildHash=await fileHash(join(directory,"build-files.json"));
        result.playerHash=await fileHash(exe);
        const nonce=randomUUID(),signal=join(directory,"signal.json");
        await launch("player",exe,["-batchmode","-force-d3d11","-screen-fullscreen","0","-screen-width","640","-screen-height","360"],{ORCHIVA_PLAYER_NONCE:nonce,ORCHIVA_PLAYER_SIGNAL:signal,...(levelProfile?{ORCHIVA_LEVEL_SIGNAL:join(directory,"level.json")}:{})});
        const s=JSON.parse(await boundedText(signal));
        if(s.nonce!==nonce || s.scene!=="Hud" || s.before!=="SCORE 0" || s.after!=="SCORE 10" || s.score!==10 || s.frame<1 || !s.visible ||
           result.playerHash!==await fileHash(exe))throw Error("UNITY_PLAYER_SIGNAL");
        if(levelProfile){
          const level=JSON.parse(await boundedText(join(directory,"level.json")));
          if(level.nonce!==nonce || !level.cleared || !level.wallBlocked || !Number.isInteger(level.moves) || level.moves<1 ||
            !Number.isInteger(level.collected) || level.collected<0 || typeof level.name!=="string" || !level.name)throw Error("UNITY_PLAYER_SIGNAL: level");
          result.level={name:level.name,moves:level.moves,collected:level.collected,cleared:true};
        }
        result.signal={scene:s.scene,before:s.before,after:s.after,score:s.score};
      }
      await verifyProfile(project,baseline);
      result.status="passed";
    } catch(error) {
      result.reason=error instanceof Error?error.message:"UNITY_ERROR";
      if(/^UNITY_(PROCESS_FAILED|TEST_|PLAYER_SIGNAL|META_|PROFILE_CHANGED|BUILD_REPORT)/.test(result.reason))result.status="failed";
    }
    await json(report,result);return result;
  } finally {await unlink(lock);}
}
