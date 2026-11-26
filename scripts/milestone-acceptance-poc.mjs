// Local two-game acceptance. Human decisions are submitted separately after inspecting each build.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPaseoApi} from '@getpaseo/client';
import {createHostClient} from '@getpaseo/client/node';
import {gitText} from '../server/adapters/storage/integration-git.ts';

const [action,trial,gameKey,...args]=process.argv.slice(2);
assert.match(trial??'',/^d1-ma-accept-[a-z0-9-]+$/);
const games={
  maze:{title:'Lantern Maze',rows:['S.#','.#.','..E'],required:0,solution:'DDRR'},
  orchard:{title:'Star Orchard',rows:['S.E','*#*','...'],required:2,solution:'DDRRUU'}
};
const game=games[gameKey]; assert.ok(game);
const dir=resolve('.desktop-local',trial),source=join(dir,gameKey), output=join(dir,gameKey+'-out');
const config=JSON.parse(await readFile(join(dir,'desktop.json'),'utf8'));
assert.equal(await realpath(dir),config.isolationRoot);
const client=createHostClient(config.endpoint,{clientId:trial+'-'+gameKey,clientType:'cli',appVersion:'0.15.4',reconnect:{enabled:false},
  localCredential:async()=>(await readFile(join(config.paseoHome,'local-credential'),'utf8')).trim()});
async function rpc(name,input){
  for(let attempt=0;;attempt++){
    try{return await client.invokePluginRpc('orchiva-plugin','desktop.'+name,input);}
    catch(error){if(!/GLOBAL_EXECUTION_BUSY|UNITY_EDITOR_BUSY/.test(String(error)) || attempt>=300)throw error;}
    await new Promise(ok=>setTimeout(ok,2000));
  }
}
const stateFile=join(dir,gameKey+'-trial.json'),target='orchiva/integration/'+gameKey;
const phase1={phase:'Play',first:'Prototype',last:'Prototype'},phase2={phase:'Polish',first:'Tune',last:'Tune'};
const p='design.json',l='Assets/Resources/Route.json',c='Assets/Game/GoalRule.cs',q='qa.json',t='tuning.json';
const rule={game:game.title,required:game.required};
const qa={route:game.solution,moves:game.solution.length,stars:game.required};
const method=game.required?'picked >= required':'true';
const out=[p,l,c,q,t],featureIds=['Rules','Level','Code','QA','TunePass'],roles=['designer','builder','programmer','tester','tuner'];
const goals=[
  '규칙표 JSON '+JSON.stringify(rule),
  '승인된 규칙표에 맞는 Unity Resources 레벨 JSON '+JSON.stringify(game),
  'public static class GoalRule 안에 public static bool Open(int picked, int required) 메서드가 '+method+' 값을 반환하게 구현한다.',
  '승인된 레벨과 코드의 클리어 경로 QA 결과를 JSON으로 기록한다. '+JSON.stringify(qa),
  '다음 Phase의 첫 조정 항목을 JSON으로 기록한다. {"tuning":"playtest"}'
];
const checks=[p,l,c,q,t].map((_,i)=>'checks/'+featureIds[i]+'.test.cjs');
async function seed(){
  await mkdir(source);await mkdir(output);
  await cp(resolve('server/adapters/unity/hud-profile'),source,{recursive:true});
  const write=(path,text)=>writeFile(join(source,path),text);
  await mkdir(join(source,'Assets/Resources'));await mkdir(join(source,'checks'));
  await cp(resolve('scripts/fixtures/ma6/RouteBoard.cs'),join(source,'Assets/Game/RouteBoard.cs'));
  await write('Assets/Input/Rules.txt','score: 10\nlabel: SCORE\n');await write('Assets/Input/Label.txt','SCORE\n');
  for(const name of ['Assets/Resources',l,'Assets/Game/RouteBoard.cs',c]){
    const template=name==='Assets/Resources'?'Assets/Input.meta':name.endsWith('.cs')?'Assets/Game/ScoreHud.cs.meta':'Assets/Input/Rules.txt.meta';
    const guid=createHash('sha256').update(gameKey+name).digest('hex').slice(0,32);
    await write(name+'.meta',(await readFile(join(source,template),'utf8')).replace(/guid: [a-f0-9]{32}/,'guid: '+guid));
  }
  await write(l,'{}\n');await write(c,'public static class GoalRule { public static bool Open(int picked,int required) { return false; } }\n');
  const read="const fs=require('node:fs'), a=require('node:assert/strict'); const txt=p=>fs.readFileSync(p,'utf8'), json=p=>JSON.parse(txt(p));\n";
  const eq=(path,obj)=>'a.deepEqual(json('+JSON.stringify(path)+'),'+JSON.stringify(obj)+');';
  const ruleCheck=eq(p,rule),levelCheck=eq(l,game), qaCheck=eq(q,qa);
  const codeCheck="a.match(txt("+JSON.stringify(c)+").replace(/\\s/g,''),/"+(game.required?"(?:return|=>)picked>=required;":"(?:return|=>)true;")+"/);";
  for(const [i,body] of [ruleCheck,ruleCheck+levelCheck,levelCheck+codeCheck,levelCheck+codeCheck+qaCheck,eq(t,{tuning:'playtest'})].entries()) await write(checks[i],read+body+'\n');
  await gitText(source,['init','-b','main']);await gitText(source,['config','core.autocrlf','false']);await gitText(source,['add','.']);
  await gitText(source,['-c','user.email=fixture@localhost','-c','user.name=Fixture','commit','-m','Game runtime and frozen acceptance checks']);
  const {projectId}=await rpc('projects.register',{sourceRoot:source,name:game.title});
  const preview=await rpc('projects.preview',{projectId});assert.deepEqual(preview.issues,[]);
  await rpc('projects.initialize',{projectId,fingerprint:preview.fingerprint,commandKey:trial+'-'+gameKey+'-init'});
  await rpc('projects.configure',{projectId,expectedRevision:1,name:game.title,baseRef:'main',outputRoot:output});
  const features=featureIds.map((id,i)=>({id,title:id+' '+game.title,goal:out[i]+' 파일만 작성한다. '+goals[i],role:roles[i],
    discipline:i===0?'planning':'coding',outputs:[out[i]],dependsOn:i>0&&i<4?[featureIds[i-1]]:[]}));
  const acceptance={version:1,pipeline:'unity-level-v1',roles:roles.map((role,i)=>({role,tool:['planning','level','coding','qa','qa'][i],outputs:[out[i]],checks:[checks[i]]}))};
  await rpc('roadmap.save',{projectId,expectedRevision:null,roadmap:{version:1,engine:'unity',acceptance,phases:[
    {id:'Play',milestones:[{id:'Prototype',features:features.slice(0,4)}]},{id:'Polish',milestones:[{id:'Tune',features:features.slice(4)}]}]}});
  const {models}=await rpc('models',{projectId}), model=models.find(m=>m.provider==='codex/gpt-6.1-sol')??models[0];
  const state={projectId,runId:trial+'-'+gameKey,provider:model.provider,thinkingOptionId:model.levels.find(l=>l.id==='low')?.id??null,target};
  await writeFile(stateFile,JSON.stringify(state,null,2));return state;
}
async function shadowSeed(original){
  assert.ok(trial.includes('recovery') && gameKey==='orchard');assert.match(original,/^d1-ma-accept-[a-z0-9-]+$/);assert.notEqual(original,trial);
  const prior=resolve('.desktop-local',original), s=JSON.parse(await readFile(join(prior,gameKey+'-trial.json'),'utf8'));
  const record=JSON.parse(await readFile(join(prior,gameKey,'docs/.orchiva/runs',s.runId+'.json'),'utf8'));
  assert.equal(record.state,'completed');
  assert.deepEqual(await readFile(join(prior,'data/desktop/acceptance',s.projectId,'decisions.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return [];}),[]);
  const from=join(prior,'data/desktop'), to=join(dir,'data/desktop');
  const incoming=await rpc('projects.list',{});assert.ok(!incoming.some(p=>p.projectId===s.projectId));
  await cp(join(prior,gameKey),source,{recursive:true,filter:path=>!path.endsWith('.lock')});
  await cp(join(from,'integrations',s.projectId),join(to,'integrations',s.projectId),{recursive:true});
  await cp(join(from,'acceptance',s.projectId,'profile.json'),join(to,'acceptance',s.projectId,'profile.json'));
  await cp(join(from,'unity-validation/runs',s.projectId),join(to,'unity-validation/runs',s.projectId),{recursive:true});
  // Successful attempt directories are shared read-only. Decisions go to this trial's own desktop registry.
  const reg=await rpc('projects.register',{sourceRoot:source,name:'Star Orchard review replay'});assert.equal(reg.projectId,s.projectId);
  const preview=await rpc('runs.phase',{projectId:s.projectId,runId:s.runId});assert.ok(preview.eligible,preview.reason);
  await writeFile(stateFile,JSON.stringify(s,null,2));await writeFile(join(dir,'shadow.json'),JSON.stringify(preview,null,2));return s;
}
async function recoverySeed(original){
  assert.ok(trial.includes('recovery'));assert.match(original,/^d1-ma-accept-[a-z0-9-]+$/);assert.notEqual(original,trial);
  const prior=resolve('.desktop-local',original),s=JSON.parse(await readFile(join(prior,gameKey+'-trial.json'),'utf8'));
  const history=JSON.parse(await readFile(join(prior,gameKey,'docs/.orchiva/runs',s.runId+'.json'),'utf8'));
  const level=history.nodes.find(n=>n.id==='Level');assert.ok(level.integrationSha);
  await gitText(dir,['clone','--no-checkout',join(prior,'data/desktop/integrations',s.projectId,'repository.git'),source]);
  await gitText(source,['checkout','-B','main',level.integrationSha]);await gitText(source,['config','core.autocrlf','false']);
  await mkdir(output);
  for(const path of ['AGENTS.md','docs/agents','docs/decisions/decisions.md','docs/plans/plans.md','docs/plans/README.md','docs/evidence/evidence.md','docs/roadmap','docs/.orchiva/project.json']){
    await cp(join(prior,gameKey,path),join(source,path),{recursive:true});
  }
  await mkdir(join(source,'docs/.orchiva/runs'),{recursive:true});
  await writeFile(join(source,'docs/.orchiva/runs',s.runId+'.json'),JSON.stringify(history));
  const registered=await rpc('projects.register',{sourceRoot:source,name:game.title});
  assert.equal(registered.projectId,s.projectId);
  const id={projectId:s.projectId,runId:s.runId};
  const review=await rpc('runs.phase',id);assert.equal(review.reason,'PHASE_LOCAL_EVIDENCE_REQUIRED');
  const observed=await rpc('runs.get',id);
  if(observed.state==='active')await rpc('runs.control',{...id,action:'pause',expectedRevision:observed.revision,commandKey:trial+'-foreign-pause'});
  assert.equal((await rpc('requests.list',{projectId:s.projectId})).records.length,0);
  await rpc('projects.configure',{projectId:s.projectId,name:game.title,baseRef:'main',outputRoot:output,expectedRevision:registered.config.revision});
  await writeFile(join(source,'checks/Broken.test.cjs'),"const a=require('node:assert/strict');a.match(require('node:fs').readFileSync('Assets/Input/Rules.txt','utf8'),/^label: TEST-DRAFT$/m);\n");
  const previous=await rpc('roadmap.read',{projectId:s.projectId});
  const mapped=previous.roadmap;
  mapped.acceptance.roles.push({role:'fault',tool:'coding',outputs:['Assets/Input/Rules.txt'],checks:['checks/Broken.test.cjs']});
  mapped.phases=[{id:'Recovery',milestones:[{id:'Broken',features:[{id:'Mismatch',title:'격리 빌드 실패 시험',role:'fault',
    goal:'격리 복구 시험의 Assets/Input/Rules.txt에 score: 10 과 label: TEST-DRAFT 두 줄을 저장한다. 플레이 빌드 차단을 관측하기 위한 의도적인 입력이다.',
    outputs:['Assets/Input/Rules.txt']}]},{id:'Dependent',features:[{id:'Later',role:'tuner',title:'선행 수용 필요',goal:'수용한 결과에 후속 작업',outputs:['tuning.json'],dependsOn:['Mismatch']}]}]}];
  await rpc('roadmap.save',{projectId:s.projectId,expectedRevision:previous.revision,roadmap:mapped});
  const blocked=await rpc('roadmap.preview',{projectId:s.projectId,selection:{phase:'Recovery',first:'Dependent',last:'Dependent'}});
  assert.ok(blocked.issues.some(i=>i.includes('범위 밖 선행')));
  const next={...s,runId:trial+'-'+gameKey,target,parent:s.runId};
  await writeFile(stateFile,JSON.stringify(next,null,2));
  await writeFile(join(dir,'foreign.json'),JSON.stringify({registered:s.projectId,old:s.runId,observed:observed.state,review,dispatches:0,blocked:blocked.issues},null,2));
  return next;
}
async function create(s,selection,runId,parent=null){
  const scope=await rpc('roadmap.preview',{projectId:s.projectId,selection});assert.deepEqual(scope.issues,[]);
  return rpc('runs.create',{projectId:s.projectId,runId,selection,scopeHash:scope.hash,integration:{mode:'local',target,headPrefix:'feature'},
    provider:s.provider,thinkingOptionId:s.thinkingOptionId,parent});
}
await client.connect();
try{
  const s=action==='shadow-seed'?await shadowSeed(args[0]):action==='recovery-seed'?await recoverySeed(args[0]):action==='seed'?await seed():JSON.parse(await readFile(stateFile,'utf8'));
  if(s.parent && action!=='recovery-seed'){
    const replay=JSON.parse(await readFile(join(dir,'ui-rerun/rerun.json'),'utf8'));assert.equal(replay.parent,s.parent);
    s.runId=replay.runId;
    const repair=await readFile(join(dir,'repair.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(repair){assert.equal(repair.parent,replay.runId);s.runId=repair.runId;}
  }
  let tune;
  if(action==='run-tune'){
    const prior=JSON.parse(await readFile(resolve('docs/evidence/milestone-automation/MA6',trial,'acceptance.json'),'utf8'));
    tune=prior.find(game=>game.game===gameKey && game.projectId===s.projectId);
    assert.ok(tune?.entryPlan && tune.next.phase==='Polish');
    s.runId=tune.next.id;
  }
  const identity={projectId:s.projectId,runId:s.runId};
  if(action==='release-failed-replay'){
    assert.ok(trial.includes('recovery') && s.parent);
    const replay=JSON.parse(await readFile(join(dir,'ui-rerun/rerun.json'),'utf8'));
    const old={projectId:s.projectId,runId:replay.runId},r=await rpc('runs.get',old);
    assert.equal(r.state,'paused');assert.ok(r.nodes.some(n=>n.status==='failed'));
    await rpc('runs.control',{...old,action:'cancel',expectedRevision:r.revision,commandKey:trial+'-release-failed'});
    console.log('Released failed replay reservation');
  } else if(action==='repair-fixture'){
    assert.ok(s.parent && trial.includes('recovery'));
    const prior=await rpc('runs.get',identity);assert.equal(prior.nodes[0].status,'failed');
    await rpc('runs.control',{...identity,action:'pause',expectedRevision:prior.revision,commandKey:trial+'-test-fix-pause'});
    const check=join(source,'checks/Broken.test.cjs'),invalid=await readFile(check,'utf8');
    assert.ok(invalid.endsWith('\\n'));await writeFile(check,invalid.slice(0,-2)+'\n');
    const paused=await rpc('runs.get',identity);
    await assert.rejects(rpc('runs.control',{...identity,action:'resume',expectedRevision:paused.revision,commandKey:trial+'-stale-resume'}),/MILESTONE_INPUT_CHANGED/);
    const retry=await create(s,{phase:'Recovery',first:'Broken',last:'Broken'},trial+'-build-fault',s.runId);
    await writeFile(join(dir,'repair.json'),JSON.stringify({parent:s.runId,runId:retry.runId,oldScope:prior.scopeHash,newScope:retry.scopeHash}));
    console.log('PASS stale scope refused and new retry started');
  } else if(action==='shadow-seed' || action==='recovery-seed'){console.log(JSON.stringify(s));}
  else if(action==='seed') {
    await assert.rejects(create(s,phase2,s.runId+'-next'),/PHASE_APPROVAL_REQUIRED/);
    console.log('PASS gated before production',s.projectId);
  } else if(action==='create') {console.log((await create(s,s.parent?{phase:'Recovery',first:'Broken',last:'Broken'}:phase1,s.runId,s.parent)).state);}
  else if(action==='run' || tune){
    let last='';
    for(;;){
      const r=await rpc('runs.get',identity), summary=JSON.stringify([r.state,r.reason,r.advisors.map(a=>a.status),r.nodes.map(n=>[n.id,n.status])]);
      if(tune){
        assert.deepEqual(r.selection,phase2);assert.equal(r.integrationInitial,tune.tip);
        assert.deepEqual(r.nodes.map(n=>[n.id,n.token]),[['TunePass',tune.entryPlan.token]]);
        const gate=r.unityEvidence?.filter(g=>g.kind==='integration' && g.sha===r.nodes[0].integrationSha).at(-1);
        if(gate && ['failed','blocked'].includes(gate.status))throw Error(gate.reason+' '+gate.directory);
      }
      if(summary!==last){console.log(summary);last=summary;}
      if(s.parent && r.unityEvidence?.some(g=>g.status==='failed')){
        const failed=r.unityEvidence.find(g=>g.status==='failed');
        const build=JSON.parse(await readFile(join(failed.directory,'build.json'),'utf8'));
        assert.equal(build.result,'Failed');
        const phase=await rpc('runs.phase',identity);assert.equal(phase.eligible,false);assert.equal(phase.reason,'PHASE_PARTIAL_RANGE');
        await rpc('runs.control',{...identity,action:'pause',expectedRevision:r.revision,commandKey:trial+'-failed-replay-pause'});
        await writeFile(join(dir,'fault.json'),JSON.stringify({runId:s.runId,parent:r.parent,feature:failed.feature,sha:failed.sha,attempt:failed.attempt,reason:failed.reason,build:build.result,errors:build.errors,phase},null,2));
        console.log('PASS actual failed Unity build and partial Phase');break;
      }
      if(r.state==='completed'){const report=await rpc('runs.phase',identity);assert.ok(report.eligible,report.reason);console.log(JSON.stringify(report));break;}
      if(r.state!=='active'||/BLOCKED|VIOLATION|CHANGED|INVALID|FAILED|MISSING/.test(r.reason))throw Error(summary);
      for(const n of r.nodes.filter(n=>!['accepted','waiting'].includes(n.status))){
        const d=await rpc('requests.get',{projectId:s.projectId,token:n.token}), result=d.engine.result;
        if(tune){
          assert.equal(d.planVersions.at(-1).hash,tune.entryPlan.hash);
          assert.equal(d.milestone.integrationBase,tune.tip);
          assert.deepEqual(d.milestone.outputs,['tuning.json']);
        }
        const cmd=k=>({projectId:s.projectId,token:n.token,commandKey:n.token+'-'+k,expectedRevision:d.revision});
        if(d.engine.status==='ready')await rpc('requests.start',{...cmd('start'),planHash:d.planVersions.at(-1).hash});
        if(d.engine.status==='awaiting-review'){
          assert.ok(result.checks.length>0 && result.checks.every(c=>c.passed) && !result.failure);
          if(tune){
            assert.ok(result.changedFiles.includes('tuning.json'));
            assert.deepEqual(JSON.parse(await readFile(join(d.engine.worktreePath,'tuning.json'),'utf8')),{tuning:'playtest'});
          }
          await rpc('requests.review',{...cmd('review'),resultId:result.id,approved:true,qualityConfirmed:true,checksAcknowledged:true,note:'격리 PoC의 고정 산출물 검사 통과. Phase 사람 판정은 별도로 받는다.'});
        }
        if(d.engine.status==='completed'&&!d.exports.length)await rpc('requests.export',{...cmd('export'),resultId:result.id});
        if(d.engine.status==='failed'||d.planning?.state==='failed')throw Error(JSON.stringify([n.id,result?.failure,d.planning?.error]));
      }
      await new Promise(ok=>setTimeout(ok,1800));
    }
  } else if(['inspect-worker','recover-worker','interrupt-resume'].includes(action)){
    const r=await rpc('runs.get',identity), node=r.nodes.find(n=>n.id===args[0]);assert.ok(node);
    const get=()=>rpc('requests.get',{projectId:s.projectId,token:node.token});
    let doc=await get();
    assert.ok(doc.engine.worktreePath && (await realpath(doc.engine.worktreePath)).toLowerCase().startsWith(config.paseoHome.toLowerCase()+'\\'));
    const agent=createPaseoApi(client).agents.ref(doc.engine.agentId);await agent.refresh();
    const page=await agent.timeline.refetch({direction:'tail',limit:8});
    console.log(JSON.stringify({state:doc.engine.status,status:agent.status,active:!!agent.activeTurn,tail:page.entries.map(e=>({type:e.item.type,name:e.item.name,status:e.item.status,detail:e.item.detail?.type,text:String(e.item.text??'').slice(-240)}))}));
    if(action!=='inspect-worker'){
      if(action==='recover-worker')assert.ok(!agent.activeTurn && agent.status!=='running','Worker still active');
      assert.equal(doc.milestone.runId,s.runId);assert.equal(doc.milestone.item,node.id);
      if(doc.engine.status==='running'){
        await rpc('requests.stop',{projectId:s.projectId,token:node.token,expectedRevision:doc.revision,commandKey:node.token+'-idle-stop'});
        for(let i=0;i<60;i++){doc=await get();if(doc.engine.status==='failed')break;await new Promise(ok=>setTimeout(ok,1000));}
      }
      assert.equal(doc.engine.status,'failed');assert.ok(doc.engine.result);
      await rpc('requests.resume',{projectId:s.projectId,token:node.token,expectedRevision:doc.revision,resultId:doc.engine.result.id,commandKey:node.token+'-idle-resume',
        instruction:'동일 세션에서 승인된 PLAN과 고정 검사를 확인하고 지시된 산출물만 구현하세요. '+goals[featureIds.indexOf(node.id)]});
    }
  } else if(action==='review')console.log(JSON.stringify(await rpc('runs.phase',identity)));
  else if(action==='decide'){
    const [verdict,basis,note]=args;
    assert.ok(note && basis && ['approve','reject'].includes(verdict));
    console.log(JSON.stringify(await rpc('runs.decide',{...identity,basis,verdict,note,commandKey:s.runId+'-'+verdict+'-'+basis.slice(0,8)})));
  } else if(action==='shadow-check'){
    assert.ok(trial.includes('recovery') && gameKey==='orchard');
    const review=await rpc('runs.phase',identity);assert.equal(review.decisions.at(-1)?.verdict,'reject');
    await assert.rejects(create(s,phase2,s.runId+'-deny'),/PHASE_APPROVAL_REQUIRED/);
    const decision={...identity,basis:review.basis,verdict:'approve',note:'격리 회귀 전용 모의 판정',commandKey:'shadow-policy-test'};
    const accepted=await rpc('runs.decide',decision);assert.equal(accepted.decisions.length,2);
    assert.equal((await rpc('runs.decide',decision)).decisions.length,2);
    await assert.rejects(rpc('runs.decide',{...decision,note:'other'}),/IDEMPOTENCY_CONFLICT/);
    const loaded=await rpc('roadmap.read',{projectId:s.projectId});loaded.roadmap.acceptance.roles[0].outputs.push('design-v2.json');
    await rpc('roadmap.save',{projectId:s.projectId,expectedRevision:loaded.revision,roadmap:loaded.roadmap});
    await assert.rejects(create(s,phase2,s.runId+'-stale'),/PHASE_APPROVAL_STALE/);
    const stale=await rpc('runs.phase',identity);
    await writeFile(join(dir,'shadow-check.json'),JSON.stringify({isolatedOperator:true,basis:review.basis,history:accepted.decisions.map(d=>d.verdict),replayed:2,stale:stale.reason},null,2));
    console.log('PASS rejection, idempotence, changed policy invalidation');
  } else if(action==='next'){
    const run=await create(s,phase2,s.runId+'-next');
    assert.equal(run.state,'active');console.log(JSON.stringify({runId:run.runId,selection:run.selection,initial:run.integrationInitial}));
  } else throw Error('Unknown action');
}finally{await client.close();}
