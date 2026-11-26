// Runs only inside an explicitly prepared, isolated desktop verification home.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { createHostClient } from '@getpaseo/client/node';

const [action, isolation] = process.argv.slice(2);
assert.match(isolation ?? '', /^d1-ma-[a-zA-Z0-9-]{4,50}$/);
const directory = resolve(import.meta.dirname, '../.desktop-local', isolation);
const config = JSON.parse(await readFile(join(directory, 'desktop.json'), 'utf8'));
assert.equal(await realpath(directory), config.isolationRoot);
assert.equal(config.paseoHome, join(directory,'paseo'));
const source = join(directory, 'game'), output = join(directory, 'artifacts');
const client = createHostClient(config.endpoint, { clientId: isolation + '-milestone', clientType: 'cli', appVersion: '0.15.4', reconnect: { enabled: false }, localCredential: async () => (await readFile(join(config.paseoHome, 'local-credential'), 'utf8')).trim() });
async function rpc(name, input) {
  for(let attempt=0;;attempt++) {
    try { return await client.invokePluginRpc('orchiva-plugin','desktop.'+name,input); }
    catch(error) {
      if(!String(error).includes('GLOBAL_EXECUTION_BUSY') || attempt>=90) throw error;
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
  }
}
const fixture = [
  ['A','rules.txt','score=10',[]], ['B','label.txt','SCORE',[]], ['C','score.cjs','module.exports = 10;',['A']],
  ['D','hud.cjs',"module.exports = 'SCORE 10';",['B','C']], ['E','qa.txt','Verified score=10',['A']], ['F','handoff.txt','HUD verified',['D','E']]
];
const selection = { phase:'P', first:'HUD', last:'Handoff' };
const statePath = join(directory,'milestone-poc.json');
const git = (...args) => promisify(execFile)('git', ['-C',source,...args], { windowsHide:true });
let state;
const save = () => writeFile(statePath, JSON.stringify(state,null,2));
try {
  await client.connect();
  if (action === 'setup') {
    await mkdir(source); await mkdir(output); await mkdir(join(source,'checks'));
    await git('init','-b','main'); await git('config','core.autocrlf','false');
    for (const [id,path,value] of fixture) {
      await writeFile(join(source,'checks',id+'.test.cjs'), "const assert=require('node:assert/strict');const fs=require('node:fs');assert.equal(fs.readFileSync("+JSON.stringify(path)+",'utf8').trim(),"+JSON.stringify(value)+");\n");
    }
    await git('add','checks'); await git('-c','user.email=fixture@test.invalid','-c','user.name=Fixture','commit','-m','Frozen HUD checks');
    const { projectId } = await rpc('projects.register',{sourceRoot:source,name:'Milestone 점수 HUD'});
    const p = await rpc('projects.preview',{projectId}); assert.deepEqual(p.issues,[]);
    await rpc('projects.initialize',{projectId,fingerprint:p.fingerprint,commandKey:isolation+'-init'});
    await rpc('projects.configure',{projectId,expectedRevision:1,name:'Milestone 점수 HUD',baseRef:'main',outputRoot:output});
    const models = await rpc('models',{projectId});
    const model = models.models.find(m=>m.provider==='codex/gpt-6.1-sol') ?? models.models[0]; assert.ok(model);
    const nodes = fixture.map(([id,path,value,dependsOn])=>({id,title:id+' '+path,goal:path+' 파일의 내용은 다음 한 줄이다. '+value,outputs:[path],checks:['checks/'+id+'.test.cjs'],dependsOn}));
    await rpc('roadmap.save',{projectId,expectedRevision:null,roadmap:{version:1,phases:[{id:'P',milestones:[{id:'HUD',features:nodes.slice(0,5)},{id:'Handoff',features:nodes.slice(5)}]}]}});
    const scope = await rpc('roadmap.preview',{projectId,selection}); assert.deepEqual(scope.issues,[]); assert.equal(scope.nodes.length,6);
    state={projectId,selection,scopeHash:scope.hash,provider:model.provider,thinkingOptionId:model.levels.find(l=>l.id==='low')?.id ?? null,results:[]}; await save();
    console.log(JSON.stringify(state));
  } else {
    state=JSON.parse(await readFile(statePath,'utf8'));
    await exercise();
  }
} finally { await client.close(); }

async function exercise() {
  const projectId=state.projectId, runId=isolation+'-hud', identity={projectId,runId};
  const get=()=>rpc('runs.get',identity);
  if(action==='recover-idle') {
    const run=await get(), n=run.nodes.find(n=>n.status==='running');
    if(!n) {console.log('No running fixture node');return;}
    const identity={projectId,token:n.token}, current=()=>rpc('requests.get',identity);
    let doc=await current();
    if(doc.engine.status!=='running') return;
    assert.ok(doc.milestone.runId===runId && doc.engine.agentId && doc.engine.workspaceId);
    assert.ok((await realpath(doc.engine.worktreePath)).toLowerCase().startsWith(config.paseoHome.toLowerCase()+'\\'));
    const agent=doc.engine.agentId, workspace=doc.engine.workspaceId;
    await rpc('requests.stop',{...identity,expectedRevision:doc.revision,commandKey:n.token+'-idle-stop'});
    for(let i=0;i<60;i++) {doc=await current();if(doc.engine.status==='failed')break;await new Promise(r=>setTimeout(r,1000));}
    assert.equal(doc.engine.status,'failed');assert.ok(doc.engine.result.executionFailure);
    const resultId=doc.engine.result.id;
    await rpc('requests.resume',{...identity,expectedRevision:doc.revision,commandKey:n.token+'-idle-resume',resultId,instruction:'중단된 격리 검증을 재개한다. 승인된 Feature의 PLAN과 지정된 출력만 구현하고 결과를 보고한다.'});
    state.recoveries=[...(state.recoveries??[]),{id:n.id,agent,workspace,resultId}];await save();
    console.log('Resumed same fixture session '+n.id);return;
  }
  if(action==='conflict') {
    const negativeSource=join(directory,'score-conflict'),negativeOutput=join(directory,'score-conflict-output');
    const proofPath=join(directory,"conflict-fixture.json");
    let proof=await readFile(proofPath,"utf8").then(JSON.parse).catch(error=>{if(error.code!=="ENOENT") throw error; return state.conflict;});
    if(!proof) {
      await mkdir(negativeSource);await mkdir(negativeOutput);
      const cmd=(...args)=>promisify(execFile)('git',['-C',negativeSource,...args],{windowsHide:true});
      await cmd('init','-b','main');await cmd('-c','user.email=fixture@test.invalid','-c','user.name=Fixture','commit','--allow-empty','-m','fixture');
      const {projectId:id}=await rpc('projects.register',{sourceRoot:negativeSource,name:'충돌하는 점수 명세'});
      const preview=await rpc('projects.preview',{projectId:id});await rpc('projects.initialize',{projectId:id,fingerprint:preview.fingerprint,commandKey:isolation+'-conflict-init'});
      await rpc('projects.configure',{projectId:id,expectedRevision:1,name:'충돌하는 점수 명세',baseRef:'main',outputRoot:negativeOutput});
      const features=[10,20].map(score=>({id:'Score'+score,title:'최종 점수 '+score,goal:'최종 배포 파일 score.txt 전체의 값이 반드시 '+score+' 하나여야 한다. 이 값은 고정 승인 규칙이며 어느 항목에도 우선순위가 없다.',outputs:['score.txt']}));
      const selection={phase:'P',first:'Conflict',last:'Conflict'};
      await rpc('roadmap.save',{projectId:id,expectedRevision:null,roadmap:{version:1,phases:[{id:'P',milestones:[{id:'Conflict',features}]}]}});
      const scope=await rpc('roadmap.preview',{projectId:id,selection});assert.deepEqual(scope.issues,[]);
      proof={projectId:id,runId:isolation+'-conflict',selection,scopeHash:scope.hash,startedAt:new Date().toISOString()};
      await writeFile(proofPath,JSON.stringify(proof,null,2));
    }
    await writeFile(proofPath,JSON.stringify(proof,null,2));
    const {projectId:id,runId:negativeId,selection,scopeHash}=proof;
    const run=await rpc('runs.create',{projectId:id,runId:negativeId,selection,scopeHash,provider:state.provider,thinkingOptionId:state.thinkingOptionId,parent:null});
    for(let i=0;i<150;i++) {
      const observed=await rpc('runs.get',{projectId:id,runId:negativeId}), advisor=observed.advisors[0];
      if(advisor.status==='blocked') {
        const list=await rpc('requests.list',{projectId:id});assert.equal(list.records.length,1);assert.equal(list.records[0].token,advisor.token);
        assert.ok(advisor.report.split(/\r?\n/).some(line=>line.trim()==='MA_VERDICT '+scopeHash+' BLOCKED'));
        const paused=await rpc('runs.control',{projectId:id,runId:negativeId,expectedRevision:observed.revision,commandKey:isolation+'-negative-close',action:'pause'});
        assert.equal(paused.state,'paused');
        await writeFile(join(directory,'milestone-conflict.json'),JSON.stringify({...proof,completedAt:new Date().toISOString(),advisor,featureRequests:0},null,2));console.log('PASS conflicting scores blocked before dispatch');return;
      }
      if(advisor.status==='accepted' || /FAILED/.test(observed.reason)) throw new Error('Conflict case: '+advisor.status+' '+observed.reason);
      await new Promise(r=>setTimeout(r,2000));
    }
    throw new Error('Conflict advisor pending');
  }
  if(action==='audit') {
    const run=await get(); assert.equal(run.state,'completed');
    const index=new Map(), intervals=[], nodes=[];
    const readJson=async path=>JSON.parse(await readFile(join(source,'docs/.orchiva',path),'utf8'));
    for(const n of run.nodes) {
      const doc=await readJson('requests/'+n.token+'.json');
      const result=doc.engine.result, plan=doc.planVersions.at(-1);
      const snapshot=await readJson('snapshots/'+plan.snapshotId+'.json');
      assert.equal(result.id,n.resultId);assert.equal(result.fingerprint,n.fingerprint);
      assert.ok(doc.reviews.at(-1).approved);assert.equal(doc.engine.status,'completed');
      assert.equal(doc.journals.filter(j=>j.kind==='start' && j.state==='applied').length,1);
      const [,path,expected,dependsOn]=fixture.find(f=>f[0]===n.id);
      const actual=await readFile(join(source,path));assert.equal(actual.toString().trim(),expected);
      assert.equal(n.files[0].hash,createHash('sha256').update(actual).digest('hex'));
      const inputs=[];
      for(const dep of dependsOn) for(const f of index.get(dep).files) {
        assert.equal(snapshot.files.find(x=>x.path===f.path)?.hash,f.hash);
        inputs.push({from:dep,...f});
      }
      const check=doc.milestone.checks[0];assert.equal(result.checks.length,1);assert.equal(result.checks[0].inputFingerprint,check.hash);assert.ok(result.checks[0].passed);
      const from=doc.journals.find(j=>j.kind==='start').at, to=doc.journals.find(j=>j.kind==='apply').at;
      intervals.push({id:n.id,from,to});index.set(n.id,n);
      nodes.push({id:n.id,token:n.token,workspace:doc.engine.workspaceId,agent:doc.engine.agentId,planHash:plan.hash,resultId:n.resultId,fingerprint:n.fingerprint,inputs,files:n.files,transfers:n.transfers,
        review:doc.reviews.at(-1).id,checks:result.checks,attempts:doc.engine.results.map(r=>({id:r.id,at:r.collectedAt,failure:r.failure,checks:r.checks.map(c=>({passed:c.passed,input:c.inputFingerprint,output:c.output}))}))});
    }
    assert.ok(intervals.slice(1).every((v,i)=>v.from>=intervals[i].to));
    assert.equal(new Set(nodes.map(n=>n.workspace)).size,6);assert.equal(new Set(nodes.map(n=>n.agent)).size,6);
    assert.equal(nodes[0].agent,state.original.agent);assert.equal(nodes[0].workspace,state.original.worktree);assert.ok(nodes[0].attempts.some(a=>a.id===state.failed && a.checks.some(c=>!c.passed)));
    const read=async p=>(await readFile(join(source,p),'utf8')).trim();
    const checks=await promisify(execFile)(process.execPath,['--test',...fixture.map(f=>'checks/'+f[0]+'.test.cjs')],{cwd:source,windowsHide:true});
    const score=Number((await read('rules.txt')).split('=')[1]);
    const code="const fs=require('node:fs'), a=require('node:assert/strict'); a.equal(require('./score.cjs'),Number(process.argv[1])); a.equal(require('./hud.cjs'),fs.readFileSync('label.txt','utf8').trim()+' '+require('./score.cjs'));";
    await promisify(execFile)(process.execPath,['-e',code,String(score)],{cwd:source,windowsHide:true});
    assert.equal(await read('qa.txt'),'Verified score='+score);assert.equal(await read('handoff.txt'),'HUD verified');
    const raw=await readJson('runs/'+runId+'.json');
    const fixtureLog=await readFile(join(config.paseoHome,'daemon.log'),'utf8');
    const pids=new Set();
    for(const line of fixtureLog.split(/\r?\n/)) {try{const row=JSON.parse(line); if(row.module==='bootstrap' && row.pid) pids.add(row.pid);}catch{}}
    assert.ok(pids.size>=2);assert.ok(raw.history.some(h=>h.event==='pause') && raw.history.some(h=>h.event==='resume'));
    assert.equal(run.advisors[0].handoff?.verdict,'accepted');
    const requests=await rpc('requests.list',{projectId});
    const advising=[];
    for(const row of requests.records) {
      const doc=await readJson('requests/'+row.token+'.json');
      if(doc.milestone?.coordinator) {
        assert.equal(doc.engine.agentId,null);assert.equal(doc.engine.workspaceId,null);
        advising.push({token:doc.token,owner:doc.milestone.milestone,title:doc.input.title,planHash:doc.planVersions.at(-1)?.hash,requestedAt:doc.journals.find(j=>j.kind==='plan')?.at,completedAt:doc.planVersions.at(-1)?.createdAt});
      }
    }
    for(const recovered of state.recoveries??[]) {
      const n=nodes.find(n=>n.id===recovered.id);
      assert.equal(n.agent,recovered.agent);assert.equal(n.workspace,recovered.workspace);assert.ok(n.attempts.some(a=>a.id===recovered.resultId));
    }
    const bridge=spawn(process.execPath,['--import','tsx',join(config.sourceRoot,'bridge/index.ts')],{cwd:config.sourceRoot,windowsHide:true,stdio:['pipe','pipe','ignore'],
      env:{...process.env,ORCHIVA_ISOLATION_ROOT:directory,ORCHIVA_DATA_HOME:config.dataHome,ORCHIVA_PASEO_HOME:config.paseoHome,ORCHIVA_PASEO_ENDPOINT:config.endpoint}});
    const timer=setTimeout(()=>bridge.kill(),30000);const lines=createInterface({input:bridge.stdout})[Symbol.asyncIterator]();
    const closed=once(bridge,'exit');
    async function frame(id,method,params) {
      bridge.stdin.write(JSON.stringify({protocolVersion:1,id,method,params})+'\n');
      const next=await lines.next();assert.ok(!next.done);const response=JSON.parse(next.value);assert.equal(response.id,id);assert.ok(!response.error,JSON.stringify(response.error));return response.result;
    }
    try {
      const info=await frame('hello','handshake',{});assert.ok(info.capabilities.includes('desktop.runs.get'));
      const actual=await frame('run','desktop.runs.get',identity);assert.equal(actual.state,'completed');assert.deepEqual(actual.nodes,run.nodes);
      const listing=await frame('list','desktop.runs.list',{projectId});assert.ok(listing.some(r=>r.runId===runId && r.state==='completed'));
    } finally {bridge.stdin.end();await closed;clearTimeout(timer);}
    const report={runId,projectId,desktopBridgeVerified:true,advising,sameSessionRecovery:state.recoveries??[],scopeHash:state.scopeHash,model:state.provider,selection,isolatedWorkerPids:[...pids],maxOverlappingExecutions:1,
      manualDraftOutsideRun:!(await readJson('requests/'+isolation+'-manual.json')).milestone,coordinators:run.advisors.map(a=>({milestone:a.milestone,token:a.token,status:a.status,planHash:a.planHash,priorHandoffs:a.priorHandoffs,handoff:a.handoff})),intervals,nodes,history:raw.history,integratedChecks:checks.stdout};
    assert.ok(report.manualDraftOutsideRun);
    await writeFile(join(directory,'milestone-report.json'),JSON.stringify(report,null,2));console.log('PASS audited local integration, handoff, same-session repair and serialization');return;
  }
  if (action==='create') {
    const input={...identity,scopeHash:state.scopeHash,selection,provider:state.provider,thinkingOptionId:state.thinkingOptionId,parent:null};
    const run=await rpc('runs.create',input); assert.equal((await rpc('runs.create',input)).runId,run.runId); return;
  }
  if(['pause','resume','pause-upgrade','resume-upgrade'].includes(action)) {
    const transition=action.startsWith('pause')?'pause':'resume';
    const run=await get(), request={...identity,expectedRevision:run.revision,commandKey:isolation+'-'+action,action:transition};
    let changed=run;
    if (run.state !== (transition==='pause'?'paused':'active')) {
      changed=await rpc('runs.control',request);
      assert.equal((await rpc('runs.control',request)).state,changed.state);
    }
    if(action==='pause') {
      const draft=await rpc('requests.save',{projectId,token:isolation+'-manual',commandKey:isolation+'-manual-draft',expectedRevision:0,input:{
        title:'긴급 단건 초안',goal:'별도 수동 요청의 인계 여부 확인',scope:'manual.txt',constraints:'격리 시험',discipline:'planning',mode:'new',parentToken:null,parentResultId:null,provider:state.provider,thinkingOptionId:state.thinkingOptionId,outputPath:'',validationProfile:'files'}});
      assert.equal(draft.engine.status,'draft'); assert.ok(!draft.milestone);
      assert.ok(!(await get()).nodes.some(n=>n.token===draft.token));
    }
    console.log(changed.state);return;
  }
  if (action==='status') {
    const run=await get(); console.log(JSON.stringify({state:run.state,reason:run.reason,nodes:run.nodes.map(n=>[n.id,n.status]),advisors:run.advisors.map(a=>[a.milestone,a.status])})); return;
  }
  assert.equal(action,'verify');
  let previous='', unchangedSince=Date.now();
  for (;;) {
    const run=await get();
    for(const accepted of run.nodes.filter(n=>n.status==='accepted' && !state.results.some(r=>r.id===n.id))) {
      const doc=await rpc('requests.get',{projectId,token:accepted.token});
      assert.equal(doc.engine.result.id,accepted.resultId);
      state.results.push({id:accepted.id,token:accepted.token,resultId:accepted.resultId,agent:doc.engine.agentId,workspace:doc.engine.workspaceId,fingerprint:accepted.fingerprint,checks:doc.engine.result.checks.map(c=>({status:c.status,input:c.inputFingerprint})),files:accepted.files});
      await save();
    }
    const node=run.nodes.find(n=>n.status!=='accepted');
    const stamp=JSON.stringify([run.state,run.reason,run.nodes.map(n=>n.status),run.advisors.map(a=>a.status)]);
    if(stamp!==previous) { console.log(stamp); previous=stamp; unchangedSince=Date.now(); }
    if(run.state==='completed') { assert.equal(state.results.length,6); console.log('PASS 5 + 1 features'); return; }
    if(Date.now()-unchangedSince>300000 || /FAILED|INVALID|CHANGED|BLOCKED|VIOLATION/.test(run.reason)) throw new Error('Local run needs inspection: '+stamp);
    if(!node || node.status==='waiting' || node.status.startsWith('plan-')) { await new Promise(r=>setTimeout(r,1500)); continue; }
    const target={projectId,token:node.token};
    const doc=await rpc('requests.get',target), engine=doc.engine, result=engine.result;
    const command=(kind)=>({...target,expectedRevision:doc.revision,commandKey:node.token+'-'+kind});
    const [,path,value]=fixture.find(f=>f[0]===node.id);
    if(engine.status==='ready') {
      const plan=doc.planVersions.at(-1);
      assert.deepEqual(doc.milestone.outputs,[path]); assert.ok(plan.content.includes(path));
      assert.equal(doc.milestone.scopeHash,state.scopeHash);
      await rpc('requests.start',{...command('start'),planHash:plan.hash});
    } else if(engine.status==='awaiting-review') {
      assert.ok(result.checks.length===1 && result.checks[0].passed && !result.failure);
      assert.equal(await readFile(join(engine.worktreePath,path),'utf8').then(x=>x.trim()),value);
      if(node.id==='A' && !state.injected) {
        assert.ok((await realpath(engine.worktreePath)).toLowerCase().startsWith(config.paseoHome.toLowerCase()+'\\'));
        state.original={agent:engine.agentId,worktree:engine.workspaceId,result:result.id}; await save();
        await writeFile(join(engine.worktreePath,path),'score=0\n');
        await rpc('requests.revalidate',{...command('negative'),resultId:result.id});
        state.injected=true; await save(); continue;
      }
      if(node.id==='A') { assert.ok(state.failed); assert.equal(engine.agentId,state.original.agent); assert.equal(engine.workspaceId,state.original.worktree); }
      await rpc('requests.review',{...command('review'),resultId:result.id,approved:true,qualityConfirmed:true,checksAcknowledged:true,note:'격리 fixture의 고정 검사와 산출물 원문을 확인함'});
    } else if(engine.status==='failed') {
      if(node.id!=='A' || !state.injected || !result.checks.some(c=>!c.passed)) throw new Error(JSON.stringify({error:engine.error,failure:result?.failure,execution:result?.executionFailure}));
      state.failed=result.id; await save();
      await rpc('requests.resume',{...command('repair'),resultId:result.id,instruction:'rules.txt 한 파일만 수정하여 score=10 으로 복구한다. 기존 검사와 기타 파일을 유지한다.'});
    } else if(engine.status==='completed') {
      if(!doc.exports.length) await rpc('requests.export',{...command('export'),resultId:result.id});
      else if(!state.results.some(r=>r.id===node.id)) {
        const transfer=await rpc('requests.apply',{...command('apply'),resultId:result.id,paths:[path]});
        assert.equal(transfer.state,'applied'); assert.equal((await readFile(join(source,path),'utf8')).trim(),value);
        state.results.push({id:node.id,token:node.token,resultId:result.id,agent:engine.agentId,workspace:engine.workspaceId,fingerprint:result.fingerprint,checks:result.checks.map(c=>({status:c.status,input:c.inputFingerprint})),files:[{path,hash:createHash('sha256').update(await readFile(join(source,path))).digest('hex')}]}); await save();
        // Return at the first durable handoff to allow the caller to restart this isolated worker.
        if(node.id==='A' && !state.restarted) {state.restarted='pending';await save();console.log('RESTART_CHECKPOINT');return;}
      }
    } else if(engine.status==='needs-input') throw new Error('WORKER_NEEDS_INPUT');
    await new Promise(r=>setTimeout(r,1500));
  }
}
