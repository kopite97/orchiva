import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
const [action='help',runId]=process.argv.slice(2);
if(action==='help'){console.log('npm run m4 -- init|start|wait|exercise|verify m4-<unique-id>\ninit backs up existing requests; start creates ONE owned sandbox task; exercise changes only M4_SUM files and revalidates; review in GUI before verify.');process.exit(0);}
assert.ok(['init','start','wait','exercise','verify'].includes(action)); assert.match(runId??'',/^m4-[a-z0-9-]{8,65}$/);
const root=join(homedir(),'.orchiva'),dir=join(root,'m4',runId),mp=join(dir,'manifest.json');
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true}).trim();
let manifest=action==='init'?null:await json(mp);
const persist=()=>writeFile(mp,JSON.stringify(manifest,null,2));
const recordPath=()=>join(root,'requests',`${manifest.token}.json`);
if(action==='wait'){
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){const r=await json(recordPath());if(['awaiting-review','failed','needs-input'].includes(r.status)){assert.equal(r.status,'awaiting-review',r.error??r.status);manifest.first={agentId:r.agentId,workspaceId:r.workspaceId,resultId:r.result.id,result: r.result,attempt:r.attempt};await persist();console.log(JSON.stringify({status:r.status,agentId:r.agentId,workspaceId:r.workspaceId,resultId:r.result.id,checks:r.result.checks.map(x=>({id:x.checkId,status:x.status}))}));process.exit(0);}await delay(500);}throw Error('Timed out; inspect existing run, do not create a duplicate.');
}
const client=createHostClient('127.0.0.1:6767',{clientId:runId,clientType:'cli',appVersion:'0.15.4',localCredential:async()=>(await readFile(join(homedir(),'.paseo-orchiva/local-credential'),'utf8')).trim(),reconnect:{enabled:false}});
const api=createPaseoApi(client),rpc=(name,input)=>client.invokePluginRpc('orchiva-plugin',name,input);
try{
 await client.connect();const agents=await api.agents.list(),workspaces=await api.workspaces.list();assert.ok(!agents.pageInfo.hasMore&&!workspaces.pageInfo.hasMore);
 assert.ok(agents.entries.every(({agent})=>!agent.activeTurn&&!agent.pendingPermissions?.length&&!['running','initializing'].includes(agent.status)),'Run only while all sessions are stopped.');
 if(action==='init'){
  await mkdir(join(dir,'original-requests'),{recursive:true});const originals=[];
  for(const file of(await readdir(join(root,'requests'))).filter(x=>x.endsWith('.json'))){const bytes=await readFile(join(root,'requests',file));await writeFile(join(dir,'original-requests',file),bytes,{flag:'wx'});originals.push({file,sha256:sha(bytes)});}
  manifest={runId,token:`${runId}-request`,at:new Date().toISOString(),baseline:git(process.cwd(),'rev-parse','HEAD'),originals,agents:agents.entries.length,workspaces:workspaces.entries.length};await writeFile(mp,JSON.stringify(manifest,null,2),{flag:'wx'});
 }
 if(action==='start'){
  assert.equal(await rpc('request.get',{token:manifest.token}),null);
  const feature={title:'M4 조건별 판정 검증',goal:'Read both PLAN files. Create M4_SUM.mjs exporting sum(a,b) as a named export. Create M4_SUM.test.mjs using node:test and node:assert/strict with two named tests: sum(2,3) equals 5, and sum(-2,3) equals 1. Run the test and report.',scope:'Only the two M4_SUM files in this worktree.',constraints:'Do not commit, push, merge, install dependencies, use network or access other repositories. Keep existing files unchanged.',validation:'Orchiva runs the Node test independently.',completionCriteria:''};
  const draft=await rpc('request.save-draft',{token:manifest.token,commandKey:`run-${runId}-save`,expectedRevision:0,feature,criteria:[{id:'positive',text:'양수 두 수를 더하면 올바른 합을 반환한다.',checkIds:['sum-test'],manualMethod:'sum(2,3) = 5 확인',legacy:false},{id:'negative',text:'음수를 포함한 두 수의 합을 반환한다.',checkIds:['sum-test'],manualMethod:'sum(-2,3) = 1 확인',legacy:false}],checks:[{id:'sum-test',kind:'node-test',path:'M4_SUM.test.mjs',label:'합계 동작 검사 (테스트 2개)'}]});
  const ready=await rpc('request.prepare-plan',{token:manifest.token,commandKey:`run-${runId}-plan`,expectedRevision:draft.revision}),plan=ready.plans.at(-1);
  manifest.startInput={token:manifest.token,commandKey:`run-${runId}-start`,expectedRevision:ready.revision,planRevision:plan.revision,inputHash:plan.inputHash};manifest.baseCommit=plan.baseCommit;await persist();
  const accepted=await rpc('request.start',manifest.startInput);assert.equal(accepted.status,'planned');console.log('Accepted ONE owned M4 execution.');
 }
 if(action==='exercise'||action==='verify'){
  let r=await rpc('request.get',{token:manifest.token});assert.equal(r.agentId,manifest.first.agentId);assert.equal(r.workspaceId,manifest.first.workspaceId);assert.equal(r.attempt,1);
  const config=await rpc('project.read',{}),common=async cwd=>realpath(resolve(cwd,git(cwd,'rev-parse','--git-common-dir')));
  assert.equal((await common(r.worktreePath)).toLowerCase(),(await common(config.repositoryPath)).toLowerCase());assert.notEqual(await realpath(r.worktreePath),await realpath(config.repositoryPath));assert.equal(git(r.worktreePath,'rev-parse','HEAD'),manifest.baseCommit);
  const file=join(r.worktreePath,'M4_SUM.mjs'),test=join(r.worktreePath,'M4_SUM.test.mjs');
  if(action==='exercise'){
   assert.equal(r.status,'awaiting-review');assert.equal(r.results.length,1);assert.equal(r.result.id,manifest.first.resultId);
   const input={token:r.token,resultId:r.result.id,expectedRevision:r.revision,commandKey:`run-${runId}-review`,approved:true,note:'M4 automated boundary verification',criteriaReviews:r.criteria.map(c=>({criterionId:c.id,satisfied:true,evidenceRefs:[{kind:'check',id:'sum-test'}],note:''})),testChangesAcknowledged:false,testChangeNote:''};
   await assert.rejects(rpc('request.review',{...input,criteriaReviews:[]}),/REVIEW_REQUIRED/);
   const implementation=await readFile(file),testBytes=await readFile(test);await writeFile(join(dir,'M4_SUM.original.mjs'),implementation,{flag:'wx'});await writeFile(join(dir,'M4_SUM.test.original.mjs'),testBytes,{flag:'wx'});
   await writeFile(file,Buffer.concat([implementation,Buffer.from('\n// M4 external edit: behavior intentionally unchanged.\n')]));
   await assert.rejects(rpc('request.review',input),/STALE_RESULT/);
   assert.equal((await rpc('request.get',{token:r.token})).result.id,manifest.first.resultId);
   await writeFile(test,Buffer.concat([testBytes,Buffer.from('\n// M4 reviewed check-file change: comments only; both assertions retained.\n')]));
   const revalidate={token:r.token,resultId:r.result.id,expectedRevision:r.revision,commandKey:`run-${runId}-revalidate`};
   r=await rpc('request.revalidate',revalidate);assert.equal(r.status,'awaiting-review',r.observationError??r.error);assert.equal(r.results.length,2);assert.equal(r.result.testChanges.length,1);assert.equal(r.attempt,1);
   const first=r.results[0],{attemptNumber,validationRun,legacy,...original}=first;assert.deepEqual(original,manifest.first.result);
   assert.equal((await rpc('request.revalidate',revalidate)).results.length,2);
   await assert.rejects(rpc('request.review',{...input,expectedRevision:r.revision}),/STALE_RESULT/);
   await assert.rejects(rpc('request.review',{...input,resultId:r.result.id,expectedRevision:r.revision}),/TEST_CHANGE_REQUIRED/);
   manifest.exercise={at:new Date().toISOString(),secondResultId:r.result.id,oldResultPreserved:true,missingCriteriaRejected:true,staleFileRejected:true,oldResultRejected:true,testChangeRequired:true,revalidationReplay:true,attempt:r.attempt};await persist();console.log(JSON.stringify(manifest.exercise));
  } else {
   assert.equal(r.status,'completed');assert.equal(r.results.length,2);assert.equal(r.result.id,manifest.exercise.secondResultId);assert.equal(r.decisions.length,1);assert.equal(r.decisions[0].criteriaReviews.length,2);assert.equal(r.decisions[0].testChangesAcknowledged,true);
   const bytes=await readFile(recordPath()),current=await readFile(file);
   assert.equal((await rpc('request.inspect-result',{token:r.token,resultId:r.result.id})).matches,true);
   try{await writeFile(file,Buffer.concat([current,Buffer.from('\n// M4 post-completion comparison only.\n')]));assert.equal((await rpc('request.inspect-result',{token:r.token,resultId:r.result.id})).matches,false);assert.deepEqual(await readFile(recordPath()),bytes);}finally{await writeFile(file,current);}
   assert.equal((await rpc('request.inspect-result',{token:r.token,resultId:r.result.id})).matches,true);
   const {attemptNumber,validationRun,legacy,...original}=r.results[0];assert.deepEqual(original,manifest.first.result);
   await rpc('request.page',{filter:'all',limit:20});await rpc('request.detail',{token:r.token});assert.deepEqual(await readFile(recordPath()),bytes);
   for(const x of manifest.originals)assert.equal(sha(await readFile(join(root,'requests',x.file))),x.sha256,`Original changed: ${x.file}`);
   const title=`${r.taskId}: ${r.feature.title}`;assert.deepEqual(agents.entries.filter(({agent})=>agent.title===title).map(({agent})=>agent.id),[r.agentId]);assert.deepEqual(workspaces.entries.filter(x=>x.title===title).map(x=>x.id),[r.workspaceId]);
   manifest.result={at:new Date().toISOString(),status:r.status,agentId:r.agentId,workspaceId:r.workspaceId,attempt:1,results:2,decisions:1,criteriaReviews:r.decisions[0].criteriaReviews,checkChangesAcknowledged:true,postCompletionDifference:true,completedBytesUnchanged:true,originalBytesUnchanged:manifest.originals.length,newAgents:1,newWorkspaces:1};await persist();console.log(JSON.stringify(manifest.result,null,2));
  }
 }
 console.log(`${action}: PASS`);
}finally{try{await api.dispose();}finally{await client.close();}}
