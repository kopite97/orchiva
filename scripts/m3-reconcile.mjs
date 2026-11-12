import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';

const [action = 'help', runId] = process.argv.slice(2);
if (action === 'help') { console.log('npm run m3 -- init|start|wait|checkpoint|verify m3-<unique-id>\ninit backs up all records; start confirms ONE sandbox run; wait reads disk only. Reload owned Plugin after start; after wait/checkpoint restart idle daemon; verify checks startup before RPC.'); process.exit(0); }
assert.ok(['init','start','wait','checkpoint','verify'].includes(action)); assert.match(runId ?? '', /^m3-[a-z0-9-]{8,70}$/);
const root = join(homedir(), '.orchiva'), directory = join(root,'m3',runId), manifestPath = join(directory,'manifest.json'), recordPath = join(root,'requests',`${runId}-request.json`);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path,'utf8'));
const git = (cwd,...args) => execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true}).trim();
let manifest = action === 'init' ? null : await json(manifestPath);
const persist = () => writeFile(manifestPath,JSON.stringify(manifest,null,2));
const runtimeStatus = () => json(join(root,'runtime-status.json'));
async function until(read, predicate, timeout = 180000) { const deadline=Date.now()+timeout; while(Date.now()<deadline) { const value=await read(); if(predicate(value)) return value; await delay(500); } throw Error('Timed out; preserve this run and inspect its state.'); }
if(action === 'wait') {
  let runningAfterReload = false;
  const record = await until(async () => {
    const r = await json(recordPath), status = await runtimeStatus();
    if(status.startedAt !== manifest.beforePluginReload.runtimeStartedAt && r.status === 'running' && r.observation?.lastSuccessAt >= status.startedAt) runningAfterReload = true;
    return r;
  }, r => ['awaiting-review','failed','needs-input'].includes(r.status));
  assert.equal(record.status,'awaiting-review'); assert.equal(record.result.checks[0].passed,true); assert.equal(record.results.length,1);
  manifest.headless = { at:new Date().toISOString(),status:record.status,agentId:record.agentId,workspaceId:record.workspaceId,attempt:record.attempt,resultId:record.result.id,results:record.results.length,runningAfterReload,runtimeStartedAt:(await runtimeStatus()).startedAt,observation:record.observation };
  await persist(); console.log(JSON.stringify(manifest.headless,null,2)); process.exit(0);
}
// Read startup evidence before any API connection in the verification process.
let startup;
if(action === 'verify') {
  startup=await until(runtimeStatus,s=>s.state==='connected' && !s.restoring && s.startedAt!==manifest.beforeDaemonRestart.runtimeStartedAt,45000);
  manifest.daemonStartup ??= manifest.result?.startupBeforeRpc ?? startup;
  assert.equal(sha(await readFile(recordPath)),manifest.beforeDaemonRestart.recordSha256,'Terminal record changed on daemon restart');
}
const client=createHostClient('127.0.0.1:6767',{clientId:runId,clientType:'cli',appVersion:'0.15.4',localCredential:async()=>(await readFile(join(homedir(),'.paseo-orchiva/local-credential'),'utf8')).trim(),reconnect:{enabled:false}});
const api=createPaseoApi(client),rpc=(name,input)=>client.invokePluginRpc('orchiva-plugin',name,input);
try {
 await client.connect(); const agents=await api.agents.list(),workspaces=await api.workspaces.list(); assert.ok(!agents.pageInfo.hasMore && !workspaces.pageInfo.hasMore);
 const idle = () => assert.ok(agents.entries.every(({agent})=>!agent.activeTurn && !agent.pendingPermissions?.length && !['running','initializing'].includes(agent.status)),'Unrelated/active work must not be restarted');
 if(action==='init') {
  idle(); await mkdir(join(directory,'original-requests'),{recursive:true}); const originals=[];
  for(const file of (await readdir(join(root,'requests'))).filter(x=>x.endsWith('.json'))) { const bytes=await readFile(join(root,'requests',file)); await writeFile(join(directory,'original-requests',file),bytes,{flag:'wx'}); originals.push({file,sha256:sha(bytes)}); }
  manifest={runId,baseline:git(process.cwd(),'rev-parse','HEAD'),at:new Date().toISOString(),originals,agents:agents.entries.length,workspaces:workspaces.entries.length,token:`${runId}-request`};
  await writeFile(manifestPath,JSON.stringify(manifest,null,2),{flag:'wx'});
 }
 if(action==='start') {
  idle(); const service=await rpc('runtime.status',{}); assert.equal(service.state,'connected'); assert.equal(service.restoring,false);
  const feature={title:'M3 백그라운드 복원 검증',goal:'Read both PLAN files. First run PowerShell Start-Sleep -Seconds 25 once, then create M3_PROOF.md containing M3_BACKGROUND_OK.',scope:'Only one proof file in this sandbox worktree.',constraints:'Do not commit, push, merge, use network, install dependencies, or access other repositories.',validation:'Orchiva independently checks the marker after the session ends.',completionCriteria:''};
  const draft=await rpc('request.save-draft',{token:manifest.token,commandKey:`${runId}-save`,expectedRevision:0,feature,criteria:[{id:'proof',text:'Proof contains M3_BACKGROUND_OK.',checkIds:['marker'],manualMethod:'',legacy:false}],checks:[{id:'marker',kind:'file-contains',path:'M3_PROOF.md',text:'M3_BACKGROUND_OK',label:'M3 background marker'}]});
  const ready=await rpc('request.prepare-plan',{token:manifest.token,commandKey:`${runId}-plan`,expectedRevision:draft.revision}),plan=ready.plans.at(-1);
  manifest.startInput={token:manifest.token,commandKey:`${runId}-start`,expectedRevision:ready.revision,planRevision:plan.revision,inputHash:plan.inputHash}; manifest.baseCommit=plan.baseCommit; await persist();
  const startedAt=performance.now(),accepted=await rpc('request.start',manifest.startInput); manifest.acceptance={status:accepted.status,elapsedMs:Math.round(performance.now()-startedAt),agentId:accepted.agentId,workspaceId:accepted.workspaceId}; assert.equal(accepted.status,'planned'); assert.equal(accepted.agentId,null);
  const running=await until(()=>json(recordPath),r=>r.status==='running',45000);
  manifest.beforePluginReload={status:running.status,agentId:running.agentId,workspaceId:running.workspaceId,runtimeStartedAt:service.startedAt}; await persist(); console.log(JSON.stringify({acceptance:manifest.acceptance,beforePluginReload:manifest.beforePluginReload}));
 }
 if(action==='checkpoint') { idle(); const r=await json(recordPath); assert.equal(r.status,'awaiting-review'); manifest.beforeDaemonRestart={recordSha256:sha(await readFile(recordPath)),runtimeStartedAt:(await runtimeStatus()).startedAt,agentId:r.agentId,workspaceId:r.workspaceId,resultId:r.result.id,attempt:r.attempt}; await persist(); }
 if(action==='verify') {
  idle(); const r=await rpc('request.get',{token:manifest.token}); assert.equal(r.agentId,manifest.headless.agentId); assert.equal(r.workspaceId,manifest.headless.workspaceId); assert.equal(r.attempt,1); assert.equal(r.results.length,1); assert.equal(r.result.id,manifest.headless.resultId); assert.equal(r.status,'awaiting-review'); assert.equal(r.result.checks[0].passed,true);
  assert.equal(git(r.worktreePath,'rev-parse','HEAD'),manifest.baseCommit);
  for(const p of [r.requestPlan,r.taskPlan]) assert.equal(await readFile(join(r.worktreePath,'.orchiva/plans',`${p.id}.md`),'utf8'),p.content);
  const replay=await rpc('request.start',manifest.startInput); assert.equal(replay.agentId,r.agentId);
  const beforeRead=sha(await readFile(recordPath)); await rpc('request.page',{filter:'all',limit:20}); await rpc('request.detail',{token:r.token}); assert.equal(sha(await readFile(recordPath)),beforeRead);
  for(const original of manifest.originals) assert.equal(sha(await readFile(join(root,'requests',original.file))),original.sha256,`Original changed: ${original.file}`);
  const title = `${r.taskId}: ${r.feature.title}`;
  assert.deepEqual(agents.entries.filter(({agent})=>agent.title===title).map(({agent})=>agent.id),[r.agentId]);
  assert.deepEqual(workspaces.entries.filter(workspace=>workspace.title===title).map(workspace=>workspace.id),[r.workspaceId]);
  manifest.result={at:new Date().toISOString(),status:r.status,agentId:r.agentId,workspaceId:r.workspaceId,attempt:r.attempt,resultId:r.result.id,results:r.results.length,checksPassed:true,head:manifest.baseCommit,originalBytesUnchanged:manifest.originals.length,newAgents:1,newWorkspaces:1,readOnlyQueries:true,startReplaySameId:true,startupBeforeRpc:manifest.daemonStartup}; await persist(); console.log(JSON.stringify(manifest.result,null,2));
 }
 console.log(`${action}: PASS`);
} finally { try { await api.dispose(); } finally { await client.close(); } }
