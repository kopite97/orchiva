import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { JsonRequestStore } from '../server/adapters/storage/json-request-store.ts';
import { PaseoRuntime } from '../server/adapters/paseo/runtime.ts';
import { StartFeatureRequest } from '../server/application/start-feature-request.ts';
import { DraftRequest } from '../server/application/draft-request.ts';
import { RecoverRequest } from '../server/application/recover-request.ts';
import { TrackExecution } from '../server/application/track-execution.ts';
import { loadConfig } from '../server/config/project-config.ts';
import { payloadHash } from '../server/domain/record-v2.ts';
const [action='help',runId,stage]=process.argv.slice(2);
if(action==='help'){console.log('npm run m5 -- init|fixture|start|wait|revalidate|checkpoint|verify m5-<unique-id> [stage]\nwait stage is expected attempt 1/2/3. checkpoint stage is recovered/rejected. New main request: intentional failure → revalidate → GUI resume → reject → GUI resume → approve. Fixture uses an isolated store and real effects followed by injected response exceptions.');process.exit(0);}
assert.ok(['init','fixture','start','wait','revalidate','checkpoint','verify'].includes(action));assert.match(runId??'',/^m5-[a-z0-9-]{8,60}$/);
const root=join(homedir(),'.orchiva'),dir=join(root,'m5',runId),mp=join(dir,'manifest.json');
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true}).trim();
let manifest=action==='init'?null:await json(mp);const persist=()=>writeFile(mp,JSON.stringify(manifest,null,2));
const recordPath=()=>join(root,'requests',`${manifest.token}.json`);
async function until(read,predicate,timeout=180000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const r=await read();if(predicate(r))return r;await delay(500);}throw Error('Timed out; keep existing resources and inspect manifest.');}
if(action==='wait'){
 const attempt=Number(stage??1);const r=await until(()=>json(recordPath()),r=>r.attempt===attempt&&['failed','awaiting-review','completed','needs-input'].includes(r.status));
 console.log(JSON.stringify({status:r.status,attempt:r.attempt,agentId:r.agentId,workspaceId:r.workspaceId,results:r.results.length,failure:r.failure,checks:r.result?.checks.map(x=>({id:x.checkId,status:x.status}))}));
 if(attempt===1){assert.equal(r.status,'failed');assert.equal(r.failure.kind,'validation');manifest.first={agentId:r.agentId,workspaceId:r.workspaceId,resultId:r.result.id,resultHash:payloadHash(r.results[0]),testHash:sha(await readFile(join(r.worktreePath,'M5_INCREMENT.test.mjs')))};await persist();}process.exit(0);
}
const client=createHostClient('127.0.0.1:6767',{clientId:runId,clientType:'cli',appVersion:'0.15.4',localCredential:async()=>(await readFile(join(homedir(),'.paseo-orchiva/local-credential'),'utf8')).trim(),reconnect:{enabled:false}});
const api=createPaseoApi(client),rpc=(name,input)=>client.invokePluginRpc('orchiva-plugin',name,input);
try{
 await client.connect();const agents=await api.agents.list(),workspaces=await api.workspaces.list();assert.ok(!agents.pageInfo.hasMore&&!workspaces.pageInfo.hasMore);
 assert.ok(agents.entries.every(({agent})=>!agent.activeTurn&&!agent.pendingPermissions?.length&&!['running','initializing'].includes(agent.status)),'Unrelated active sessions: wait before testing.');
 if(action==='init'){
  const diagnostics=await rpc('storage.diagnostics',{});assert.equal(diagnostics.activeTokens.length,0);assert.equal(diagnostics.issues.length,0);
  await mkdir(join(dir,'original-requests'),{recursive:true});const originals=[];
  for(const file of(await readdir(join(root,'requests'))).filter(x=>x.endsWith('.json'))){const b=await readFile(join(root,'requests',file));await writeFile(join(dir,'original-requests',file),b,{flag:'wx'});originals.push({file,sha256:sha(b)});}
  manifest={runId,token:`${runId}-request`,fixtureToken:`${runId}-fixture`,baseline:git(process.cwd(),'rev-parse','HEAD'),at:new Date().toISOString(),originals,agents:agents.entries.length,workspaces:workspaces.entries.length};await writeFile(mp,JSON.stringify(manifest,null,2),{flag:'wx'});
 }
 if(action==='fixture'){
  assert.ok(!manifest.fixture,'Fixture already completed; do not rerun effects.');
  const store=new JsonRequestStore(join(dir,'fixture-requests'));await store.open();
  try{
   assert.equal(await store.get(manifest.fixtureToken),null,'Existing fixture: inspect checkpoint instead of resetting.');
   const runtime=new PaseoRuntime(api,await loadConfig()),drafts=new DraftRequest(store),start=new StartFeatureRequest(store),recover=new RecoverRequest(store,start.locks),tracker=new TrackExecution(store,start.locks);
   const feature={title:'M5 전달 대조 fixture',goal:'Read both PLAN files and create M5_DELIVERY.md containing M5_DELIVERY_OK. Report completion.',scope:'One marker file in this worktree only.',constraints:'Do not commit, push, merge, access other repositories, network or install dependencies.',validation:'Marker matches.',completionCriteria:'Marker exists.'};
   const draft=await drafts.save({token:manifest.fixtureToken,commandKey:`${runId}-fixture-save`,expectedRevision:0,feature,criteria:[{id:'marker',text:'Marker exists.',checkIds:['marker'],manualMethod:'',legacy:false}],checks:[{id:'marker',kind:'file-contains',path:'M5_DELIVERY.md',text:'M5_DELIVERY_OK',label:'Delivery marker'}]});
   const ready=await drafts.prepare({token:draft.token,commandKey:`${runId}-fixture-plan`,expectedRevision:draft.revision},runtime),plan=ready.plans.at(-1);
   const startInput={token:ready.token,commandKey:`${runId}-fixture-start`,expectedRevision:ready.revision,planRevision:plan.revision,inputHash:plan.inputHash};
   let phase='plans',creates=0,agentCreates=0,sends=0;
   const fault={projectSnapshot:runtime.projectSnapshot,validate:()=>runtime.validate(),preflight:c=>runtime.preflight(c),createWorkspace:async r=>{creates++;return runtime.createWorkspace(r);},writePlans:async r=>{if(phase==='plans')throw Error('M5 injected PLAN write failure before agent creation');return runtime.writePlans(r);},startAgent:async r=>{agentCreates++;const id=await runtime.startAgent(r);manifest.fixtureCreated={agentId:id,workspaceId:r.workspaceId};await persist();throw Error('M5 injected response loss AFTER real agent creation');}};
   let r=await start.start(startInput,fault);assert.equal(r.status,'failed');assert.equal(r.workspaceId!==null,true);assert.equal(r.agentId,null);assert.equal(agentCreates,0);console.log('fixture: confirmed PLAN failure preserved');
   const retryInput={token:r.token,commandKey:`${runId}-fixture-retry`,expectedRevision:r.revision,targetCommandKey:startInput.commandKey};await Promise.all([recover.retry(retryInput),recover.retry(retryInput)]);
   phase='agent';r=await start.advance(r.token,fault);assert.equal(r.status,'needs-input');assert.equal(r.agentId,null);assert.equal(agentCreates,1);assert.ok(manifest.fixtureCreated, r.error);
   const reconcileInput={token:r.token,commandKey:`${runId}-fixture-reconcile`,expectedRevision:r.revision,targetCommandKey:retryInput.commandKey};r=await recover.reconcile(reconcileInput,runtime);assert.equal(r.agentId,manifest.fixtureCreated.agentId);assert.equal(r.deliveryChecks.at(-1).outcome,'found');
   await recover.reconcile(reconcileInput,runtime);await recover.retry(retryInput);assert.equal(creates,1);assert.equal(agentCreates,1);console.log('fixture: lost creation response reconciled without recreate');
   r=await until(()=>tracker.refresh(r.token,runtime),x=>['awaiting-review','failed'].includes(x.status));assert.equal(r.status,'awaiting-review',r.error);
   const resumeInput={token:r.token,key:`${runId}-fixture-resume`,expectedRevision:r.revision,resultId:r.result.id,instruction:'Keep M5_DELIVERY.md unchanged. Read the marker and report that M5_DELIVERY_OK remains present. Do not change any file or commit.'};
   const lost={verifyResources:x=>runtime.verifyResources(x),observe:x=>runtime.observe(x),collect:(x,o)=>runtime.collect(x,o),fingerprint:x=>runtime.fingerprint(x),resume:async x=>{sends++;await runtime.resume(x);throw Error('M5 injected response loss AFTER real send');}};
   r=await tracker.resume(resumeInput,lost);assert.equal(r.status,'needs-input');assert.equal(r.attempt,2);
   r=await recover.reconcile({token:r.token,commandKey:`${runId}-fixture-message`,expectedRevision:r.revision,targetCommandKey:resumeInput.key},runtime);assert.equal(r.recovery.pending,false,'Original message identity must be found; never force resolution.');
   await tracker.resume(resumeInput,lost);assert.equal(sends,1);
   r=await until(()=>tracker.refresh(r.token,runtime),x=>['awaiting-review','failed'].includes(x.status));assert.equal(r.status,'awaiting-review',r.error);assert.equal(r.results.length,2);
   const page=await api.agents.ref(r.agentId).timeline.refetch({direction:'tail',limit:100});const matching=page.entries.filter(x=>x.item.type==='user_message'&&x.item.clientMessageId===r.recovery.messageId);assert.equal(matching.length,1);
   manifest.fixture={status:r.status,token:r.token,agentId:r.agentId,workspaceId:r.workspaceId,attempt:r.attempt,results:r.results.length,creates,agentCreates,sends,matchingMessages:matching.length,deliveryChecks:r.deliveryChecks,recordHash:sha(await readFile(join(dir,'fixture-requests',`${r.token}.json`))),startInput,retryInput,resumeInput};await persist();console.log('fixture: PASS, real workspace/agent/send each exactly once');
  }finally{await store.close();}
 }
 if(action==='start'){
  assert.ok(manifest.fixture);assert.equal(await rpc('request.get',{token:manifest.token}),null);
  const feature={title:'M5 실패·재개 검증',goal:'Read both PLAN files. This is an intentional failure/recovery fixture: create M5_INCREMENT.mjs exporting increment(n) returning n - 1 initially. Create M5_INCREMENT.test.mjs using node:test and node:assert/strict with two tests expecting increment(0) === 1 and increment(-2) === -1. Run the tests and report the expected failures. DO NOT fix the implementation in this initial turn; a later recovery instruction will request that.',scope:'Only the two M5_INCREMENT files in this worktree.',constraints:'Do not commit, push, merge, install dependencies, use network or access other repositories. Never change the test expectations to make them pass.',validation:'Orchiva independently runs the original Node test file.',completionCriteria:''};
  const draft=await rpc('request.save-draft',{token:manifest.token,commandKey:`${runId}-save`,expectedRevision:0,feature,criteria:[{id:'zero',text:'0을 증가시키면 1을 반환한다.',checkIds:['increment-test'],manualMethod:'increment(0) = 1',legacy:false},{id:'negative',text:'음수 -2를 증가시키면 -1을 반환한다.',checkIds:['increment-test'],manualMethod:'increment(-2) = -1',legacy:false}],checks:[{id:'increment-test',kind:'node-test',path:'M5_INCREMENT.test.mjs',label:'증가 동작 검사 (테스트 2개)'}]});
  const ready=await rpc('request.prepare-plan',{token:draft.token,commandKey:`${runId}-plan`,expectedRevision:draft.revision}),plan=ready.plans.at(-1);manifest.baseCommit=plan.baseCommit;manifest.startInput={token:ready.token,commandKey:`${runId}-start`,expectedRevision:ready.revision,planRevision:plan.revision,inputHash:plan.inputHash};await persist();
  const [a,b]=await Promise.all([rpc('request.start',manifest.startInput),rpc('request.start',manifest.startInput)]);assert.equal(a.id,b.id);console.log('Main request accepted with duplicate command key.');
 }
 if(action==='revalidate'){
  const r=await rpc('request.get',{token:manifest.token});assert.equal(r.status,'failed');assert.equal(r.attempt,1);assert.equal(r.results.length,1);
  manifest.revalidateInput={token:r.token,resultId:r.result.id,expectedRevision:r.revision,commandKey:`${runId}-revalidate`};await persist();const [a,b]=await Promise.all([rpc('request.revalidate',manifest.revalidateInput),rpc('request.revalidate',manifest.revalidateInput)]);assert.equal(a.result.id,b.result.id);assert.equal(a.results.length,2);assert.equal(a.attempt,1);assert.equal(a.status,'failed');manifest.failedRevalidation={resultId:a.result.id,results:2,attempt:1};await persist();
 }
 if(action==='checkpoint'){
  const r=await rpc('request.get',{token:manifest.token});assert.equal(r.attempt,2);assert.equal(r.results.length,3);assert.equal(sha(await readFile(join(r.worktreePath,'M5_INCREMENT.test.mjs'))),manifest.first.testHash);
  if(stage==='recovered'){assert.equal(r.status,'awaiting-review');manifest.resumeInput={token:r.token,key:r.recovery.key,expectedRevision:0,resultId:r.attempts.find(x=>x.attempt===1).result.id,instruction:r.recovery.instruction};const before=sha(await readFile(recordPath()));await rpc('request.resume',manifest.resumeInput);await rpc('request.resume',manifest.resumeInput);await assert.rejects(rpc('request.resume',{...manifest.resumeInput,instruction:'Changed input'}),/IDEMPOTENCY_CONFLICT/);assert.equal(sha(await readFile(recordPath())),before);manifest.recovered={resultId:r.result.id,status:r.status,attempt:r.attempt};}
  else{assert.equal(stage,'rejected');assert.equal(r.status,'failed');assert.equal(r.failure.kind,'review-rejected');assert.equal(r.decisions.length,1);manifest.rejected={decisionHash:payloadHash(r.decisions[0]),resultId:r.result.id,note:r.decision.note};}await persist();
 }
 if(action==='verify'){
  const r=await rpc('request.get',{token:manifest.token});assert.equal(r.status,'completed');assert.equal(r.attempt,3);assert.equal(r.results.length,4);assert.equal(r.decisions.length,2);assert.equal(r.agentId,manifest.first.agentId);assert.equal(r.workspaceId,manifest.first.workspaceId);assert.equal(payloadHash(r.results[0]),manifest.first.resultHash);assert.equal(payloadHash(r.decisions[0]),manifest.rejected.decisionHash);assert.equal(sha(await readFile(join(r.worktreePath,'M5_INCREMENT.test.mjs'))),manifest.first.testHash);assert.equal(r.result.testChanges.length,0);assert.equal(git(r.worktreePath,'rev-parse','HEAD'),manifest.baseCommit);
  await assert.rejects(rpc('request.refresh',{token:r.token,revalidate:true}), /false|Invalid/);
  const before=sha(await readFile(recordPath()));await rpc('request.start',manifest.startInput);await rpc('request.resume',manifest.resumeInput);await rpc('request.revalidate',manifest.revalidateInput);await rpc('request.detail',{token:r.token});assert.equal(sha(await readFile(recordPath())),before);
  for(const x of manifest.originals)assert.equal(sha(await readFile(join(root,'requests',x.file))),x.sha256,`Original changed: ${x.file}`);
  assert.equal(sha(await readFile(join(dir,'fixture-requests',`${manifest.fixtureToken}.json`))),manifest.fixture.recordHash);
  for(const item of [r,manifest.fixture]){const title=item===r?`${r.taskId}: ${r.feature.title}`:`TASK-${item.token}: M5 전달 대조 fixture`;assert.deepEqual(agents.entries.filter(({agent})=>agent.title===title).map(({agent})=>agent.id),[item.agentId]);assert.deepEqual(workspaces.entries.filter(x=>x.title===title).map(x=>x.id),[item.workspaceId]);}
  const timeline=await api.agents.ref(r.agentId).timeline.refetch({direction:'tail',limit:100});assert.equal(timeline.hasOlder,false);const users=timeline.entries.filter(x=>x.item.type==='user_message');assert.equal(users.length,3);
  manifest.result={at:new Date().toISOString(),status:r.status,attempt:3,results:4,decisions:2,agentId:r.agentId,workspaceId:r.workspaceId,testHash:manifest.first.testHash,testChanges:0,initialFailurePreserved:true,rejectedDecisionPreserved:true,oldCommandReplayNoWrites:true,originalBytesUnchanged:manifest.originals.length,mainMessages:users.length,newAgents:2,newWorkspaces:2};await persist();console.log(JSON.stringify(manifest.result,null,2));
 }
 console.log(`${action}: PASS`);
}finally{try{await api.dispose();}finally{await client.close();}}
