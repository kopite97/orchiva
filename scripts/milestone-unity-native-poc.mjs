// Exercise the committed Unity-project path and a PLAN-selected check beyond the v3 snapshot limit.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cp,mkdir,open,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gitText} from '../server/adapters/storage/integration-git.ts';
import {runUnityGate} from '../server/adapters/unity/gate.ts';
const [prior,trial]=process.argv.slice(2);
assert.match(prior,/^d1-ma-parallel-[a-z0-9-]+$/);assert.match(trial,/^ma5-[a-z0-9-]+$/);
const base=resolve('.desktop-local',prior),dir=resolve('.desktop-local',trial);await mkdir(dir);
const proof=JSON.parse(await readFile(join(base,'parallel-report.json'),'utf8'));
const repo=join(dir,'native'),src=join(base,'data/desktop/integrations',proof.projectId,'repository.git');
await gitText(dir,['clone','--branch',proof.target,'--single-branch',src,repo]);assert.equal(await gitText(repo,['rev-parse','HEAD']),proof.tip);
await cp(resolve('server/adapters/unity/hud-profile'),repo,{recursive:true});
await cp(join(repo,'Shared.unity'),join(repo,'Assets/Input/Rules.txt'));await cp(join(repo,'label.txt'),join(repo,'Assets/Input/Label.txt'));
const bin=await open(join(repo,'Assets/Input/Large.bytes'),'wx');try{await bin.truncate(17*1024**2);}finally{await bin.close();}
await writeFile(join(repo,'Assets/Input/Large.bytes.meta'),'fileFormatVersion: 2\nguid: fa114cbd650e4cef9ffd01d9d96da535\nTextScriptImporter:\n  externalObjects: {}\n');
await gitText(repo,['-c','core.autocrlf=false','add','--','Assets','Packages','ProjectSettings']);
await gitText(repo,['-c','user.name=Fixture','-c','user.email=f@localhost','commit','-m','Import HUD as a native Unity project with large content']);
const sha=await gitText(repo,['rev-parse','HEAD']);
const result=await runUnityGate(repo,sha,join(dir,'validation'),randomUUID(),'plan',['HudRulesTests.ApprovedAward']);
console.log(JSON.stringify(result));assert.equal(result.status,'passed',result.reason);
const manifest=JSON.parse(await readFile(join(result.directory,'input.json'),'utf8'));
assert.ok(manifest.total>16*1024**2);assert.equal(manifest.files.find(f=>f.path.endsWith('Large.bytes')).bytes,17*1024**2);
assert.deepEqual(result.stages.map(s=>s.cases),[['HudRulesTests.ApprovedAward']]);
await writeFile(join(dir,'native.json'),JSON.stringify({parent:proof.tip,scope:'plan',inputBytes:manifest.total,result},null,2));
