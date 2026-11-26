import assert from 'node:assert/strict';
import {createHostClient} from '@getpaseo/client/node';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {gitText} from '../server/adapters/storage/integration-git.ts';

import {editTests,playTests,fileHash,inventory,verifyLog,verifyXml} from '../server/adapters/unity/evidence.ts';
const [fixture,trial,action]=process.argv.slice(2);
assert.match(fixture??'',/^d1-ma-parallel-[a-z0-9-]+$/);
assert.match(trial??'',/^ma5-[a-z0-9-]+$/);
const root=resolve('.desktop-local'), previous=join(root,fixture);
const proof=JSON.parse(await readFile(join(previous,'parallel-report.json'),'utf8'));
const repo=join(previous,'data','desktop','integrations',proof.projectId,'repository.git');
assert.equal(await gitText(repo,['rev-parse','refs/heads/'+proof.target]),proof.tip);
const dir=join(root,trial);
if(action==='audit'){
  const results=JSON.parse(await readFile(join(dir,'poc.json'),'utf8'));
  assert.deepEqual(results.map(r=>r.sha),proof.entries.slice(-2).map(e=>e.integrated));
  for(const r of results){
    assert.equal(await fileHash(join(r.directory,'input.json')),r.inputHash);
    for(const stage of r.stages){
      const log=join(r.directory,stage.name+'.log'),txt=await readFile(log,'utf8');
      assert.equal(await fileHash(log),stage.logHash);
      if(stage.exit===0)verifyLog(stage.name,txt);
      if(stage.cases){
        const xml=join(r.directory,stage.name+'.xml'), times=await stat(log);
        if(stage.xmlHash)assert.equal(await fileHash(xml),stage.xmlHash);
        verifyXml(await readFile(xml,'utf8'),stage.name==='EditMode'?editTests:playTests,{started:times.birthtimeMs,ended:times.mtimeMs});
      }
    }
  }
  const [bad,good]=results;
  assert.equal(bad.status,'failed');assert.equal(good.status,'passed');
  assert.equal(JSON.parse(await readFile(join(bad.directory,'build.json'),'utf8')).result,'Failed');
  const manifest=join(good.directory,'build-files.json');
  assert.equal(await fileHash(manifest),good.buildHash);
  assert.deepEqual(await inventory(join(good.directory,'build'),true),JSON.parse(await readFile(manifest,'utf8')));
  assert.equal(await fileHash(join(good.directory,'build/Hud.exe')),good.playerHash);
  assert.equal(good.signal.after,'SCORE 10');
  console.log('PASS current XML freshness, logs, both SHAs and full Player distribution');process.exit(0);
}
await mkdir(dir);
const config=JSON.parse(await readFile(join(previous,'desktop.json'),'utf8'));
assert.equal(config.isolationRoot,previous);
const client=createHostClient(config.endpoint,{clientId:trial,clientType:'cli',appVersion:'0.15.4',reconnect:{enabled:false},
  localCredential:async()=>(await readFile(join(config.paseoHome,'local-credential'),'utf8')).trim()});
const rpc=(name,args)=>client.invokePluginRpc('orchiva-plugin','desktop.runs.'+name,{projectId:proof.projectId,runId:proof.runId,...args});
const results=[];
await client.connect();
try {
for(const entry of proof.entries.slice(-2)){
  const args={feature:entry.feature,expectedSha:entry.integrated,kind:'integration',commandKey:trial+'-'+entry.feature};
  const first=await rpc('unity',args);
  assert.equal((await rpc('unity',args)).attempt,first.attempt);
  let current=first;const deadline=Date.now()+2400000;
  while(current.status==='running'){
    assert.ok(Date.now()<deadline);await sleep(1500);
    current=(await rpc('get',{})).unityEvidence.find(r=>r.attempt===first.attempt);
  }
  const r=JSON.parse(await readFile(join(current.directory,'result.json'),'utf8'));assert.equal(r.status,current.status);
  console.log(JSON.stringify([entry.feature,r.status,r.reason,r.stages.map(s=>[s.name,s.exit,s.ms]),r.directory]));
  results.push(r);await writeFile(join(dir,'poc.json'),JSON.stringify(results,null,2));
  if(entry.feature==='B'){
    assert.ok(r.status==='failed' && r.reason==='UNITY_PROCESS_FAILED: build',r.reason);
    assert.equal(JSON.parse(await readFile(join(r.directory,'build.json'),'utf8')).result,'Failed');
    assert.match(await readFile(join(r.directory,'build.log'),'utf8'),/BuildFailedException: HUD_SCENE_LABEL_REFERENCE_MISMATCH/);
  }
  else assert.ok(r.status==='passed',r.reason);
}
assert.equal(results[1].sha,proof.tip);
console.log('PASS failed build blocked, corrected SHA passed');
} finally { await client.close(); }
