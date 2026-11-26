import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,rename,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {inspectCommit, verifyLog, verifyXml} from "../adapters/unity/evidence";
import {checkEditor, editorReserved, verifyProfile} from "../adapters/unity/gate";
import {gitText} from "../adapters/storage/integration-git";

test("Unity gates require complete logs, exact NUnit names/counts and an unmodified verifier",async t=>{
  const xml='<test-run result="Passed" total="1" passed="1" failed="0" skipped="0" inconclusive="0"><test-case fullname="Award" result="Passed"/></test-run>';
  assert.deepEqual(verifyXml(xml,["Award"]),["Award"]);
  const old=xml.replace('total="1"','total="1" start-time="2020-01-01T00:00:00Z" end-time="2020-01-01T00:00:01Z"');
  assert.throws(()=>verifyXml(old,["Award"],{started:Date.now()-5000,ended:Date.now()}),/XML_STALE/);
  for(const bad of [xml.replace('total="1"','total="0"'),xml.replace('skipped="0"','skipped="1"'),xml.replace("Award","OldCase"),xml.split("</test-run>")[0],"<!DOCTYPE foo>"+xml])
    assert.throws(()=>verifyXml(bad,["Award"]));
  assert.throws(()=>verifyLog("build","Build started"),/INCOMPLETE/);
  const dir=await mkdtemp(join(tmpdir(),"orchiva-unity-profile-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const exe=join(dir,"Unity.exe");await assert.rejects(checkEditor(exe),/EDITOR_MISSING/);
  await writeFile(exe,"fixture");await assert.rejects(checkEditor(exe),/MODULE_MISSING/);
  await writeFile(join(dir,"validator.cs"),"modified");await assert.rejects(verifyProfile(dir,{"validator.cs":"0".repeat(64)}),/PROFILE_CHANGED/);
  assert.equal(await editorReserved(dir),false);
  await writeFile(join(dir,"editor.lock"),JSON.stringify({pid:process.pid,attempt:"test"}));assert.equal(await editorReserved(dir),true);
});

test("committed Unity assets require matching metadata, stable GUIDs on rename and local LFS bytes",async t=>{
  const repo=await mkdtemp(join(tmpdir(),"orchiva-unity-input-"));t.after(()=>rm(repo,{recursive:true,force:true}));
  await gitText(repo,["init","-q"]);await mkdir(join(repo,"Assets"));
  const save=async(name:string,body:string)=>writeFile(join(repo,"Assets",name),body);
  const commit=async()=>{await gitText(repo,["add","-A"]);await gitText(repo,["-c","user.name=Fixture","-c","user.email=f@localhost","commit","-qm","fixture"]);return gitText(repo,["rev-parse","HEAD"]);};
  const meta="guid: "+"1".repeat(32)+"\n";await save("Rule.asset","score");await assert.rejects(inspectCommit(repo,await commit()),/META_MISSING/);
  await save("Rule.asset.meta",meta);await inspectCommit(repo,await commit());
  await rename(join(repo,"Assets/Rule.asset"),join(repo,"Assets/New.asset"));
  await rename(join(repo,"Assets/Rule.asset.meta"),join(repo,"Assets/New.asset.meta"));
  await save("New.asset.meta",meta.replaceAll("1","2"));await assert.rejects(inspectCommit(repo,await commit()),/META_RENAME/);
  await save("Other.asset","other");await save("Other.asset.meta",meta.replaceAll("1","2"));await assert.rejects(inspectCommit(repo,await commit()),/META_INVALID/);
  await save("Other.asset.meta",meta);
  const content=Buffer.from("local LFS bytes"),hash=createHash("sha256").update(content).digest("hex");
  await save("Other.asset","version https://git-lfs.github.com/spec/v1\noid sha256:"+hash+"\nsize "+content.length+"\n");
  const sha=await commit();await assert.rejects(inspectCommit(repo,sha),/LFS_MISSING/);
  const pool=join(repo,".git/lfs/objects",hash.slice(0,2),hash.slice(2,4));await mkdir(pool,{recursive:true});
  await writeFile(join(pool,hash),content);assert.equal((await inspectCommit(repo,sha)).files.find(f=>f.path==="Assets/Other.asset")?.lfs?.sha256,hash);
});
