import assert from 'node:assert/strict';
import {readdir,stat,readFile,writeFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHostClient} from '@getpaseo/client/node';
import {createPaseoApi} from '@getpaseo/client';

const [action,id]=process.argv.slice(2);
assert.match(id??'',/^d1-ma-parallel-[a-z0-9-]+$/);
const dir=resolve(import.meta.dirname,'../.desktop-local',id), game=join(dir,'game');
const config=JSON.parse(await readFile(join(dir,'desktop.json'),'utf8'));
assert.equal(config.isolationRoot,await realpath(dir));assert.equal(config.paseoHome,join(dir,'paseo'));
const setup=JSON.parse(await readFile(join(dir,'milestone-poc.json'),'utf8'));
const projectId=setup.projectId, runId=id+'-parallel', target='orchiva/integration/'+runId;
const client=createHostClient(config.endpoint,{clientId:id+'-ma4',clientType:'cli',appVersion:'0.15.4',reconnect:{enabled:false},localCredential:async()=>(await readFile(join(config.paseoHome,'local-credential'),'utf8')).trim()});
const api=createPaseoApi(client), rpc=(method,args={})=>client.invokePluginRpc('orchiva-plugin','desktop.'+method,{projectId,...args});
const exec=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const git=async(cwd,...args)=>(await exec('git',['-C',cwd,...args],{windowsHide:true})).stdout.trim();
const scene='Shared.unity', selection={phase:'P',first:'HUD',last:'HUD'};
const get=()=>rpc('runs.get',{runId}), reportPath=join(dir,'parallel-report.json');
const getRecord=async()=>JSON.parse(await readFile(join(game,'docs/.orchiva/runs',runId+'.json'),'utf8'));
await client.connect();
try {
  if(action==='create') {
    const runs=await rpc('runs.list');
    assert.ok(!runs.some(r=>r.state==='active' || r.runId===runId),'Use a fresh fixture for creation');
    await writeFile(join(game,'label.txt'),'UNSET\n');
    await writeFile(join(game,scene),'score: 0\nlabel: unset\n');
    const assertions={A:"assert.match(read('Shared.unity'),/^score: 10$/m)",B:"assert.equal(read('label.txt').trim(),'SCORE')",C:"assert.match(read('Shared.unity'),/^label: SCORE$/m)"};
    for(const [f,body] of Object.entries(assertions)) await writeFile(join(game,'checks',f+'.test.cjs'),"const assert=require('node:assert/strict');const read=p=>require('node:fs').readFileSync(p,'utf8');"+body+";\n");
    await git(game,'add','--',scene,'label.txt','checks');if (await git(game,'diff','--cached','--name-only')) await git(game,'-c','user.name=Fixture','-c','user.email=f@localhost','commit','-m','Add fixed parallel HUD acceptance checks');
    const features=[
      {id:'A',title:'HUD 점수',goal:'Shared.unity 텍스트 fixture의 score 줄만 score: 10 으로 바꾸고 label 줄은 그대로 둔다. 병렬 관측을 위해 실제 제작 세션에서 한 번 25초 기다린 후 수정한다.',outputs:[scene]},
      {id:'B',title:'HUD 표기',goal:'독립 파일 label.txt 한 줄에 SCORE를 기록한다. 병렬 관측을 위해 제작 세션에서 한 번 12초 기다린 후 수정한다.',outputs:['label.txt']},
      {id:'C',title:'HUD Scene 라벨',goal:'Shared.unity 텍스트 fixture의 label 줄만 label: SCORE 로 수정하고 score 줄은 그대로 둔다. A와 공용 파일의 서로 다른 줄을 갱신한다. 두 결과는 서비스의 공용 Scene 예약으로 순차 반영한다.',outputs:[scene]}
    ].map(f=>({...f,checks:['checks/'+f.id+'.test.cjs']}));
    const old=await rpc('roadmap.read');await rpc('roadmap.save',{expectedRevision:old.revision,roadmap:{version:1,phases:[{id:'P',milestones:[{id:'HUD',features}]}]}});
    const preview=await rpc('roadmap.preview',{selection});assert.deepEqual(preview.issues,[]);
    await rpc('runs.create',{runId,workers:2,integration:{mode:'local',target,headPrefix:'feature'},scopeHash:preview.hash,selection,provider:setup.provider,thinkingOptionId:setup.thinkingOptionId});
    console.log('created '+runId);
  } else if(action==='resume-scene') {
    const r=await get(), [a,b,c]=r.nodes;
    assert.equal(a.status,'accepted');assert.equal(b.status,'accepted');assert.equal(c.status,'failed');
    assert.ok(c.lease.resources.includes('lock:unity-editor'));
    const d=await rpc('requests.get',{token:c.token});
    assert.equal(d.milestone.integrationBase,c.lease.base);assert.equal(d.milestone.generation,c.lease.generation);
    assert.equal(d.engine.result.failure,'MILESTONE_CHECK_FAILED');
    assert.match(d.engine.result.finalResponse,/예약/);
    await rpc('requests.resume',{token:c.token,commandKey:c.token+'-scene-receipt',expectedRevision:d.revision,resultId:d.engine.result.id,
      instruction:'서비스가 공용 Scene 예약을 확인했다. '+JSON.stringify({generation:c.lease.generation,base:c.lease.base,resources:c.lease.resources})+
        ' 선행 A와 B가 이미 통합되었다. 기존 세션에서 Shared.unity의 label 줄만 수정하고 고정 검사를 실행한다.'});
    console.log('Resumed same worker with verified reservation');
  } else if(action==='status') {
    const r=await get();console.log(JSON.stringify([r.state,r.reason,r.nodes.map(n=>[n.id,n.status,n.waitReason]),r.advisors.map(a=>a.status)]));
  } else {
    const evidence=await readFile(reportPath,'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;return {runId,projectId,target};});
    const save=()=>writeFile(reportPath,JSON.stringify(evidence,null,2));
    if(action==='manual'){
      assert.equal((await get()).state,'completed');
      assert.ok(evidence.blockedManual);
      const token=id+'-manual', commandKey=id+'-manual-plan';
      let doc=await rpc('requests.get',{token});
      if (!doc.journals.some(j=>j.key===commandKey))
        await rpc('requests.plan',{token,commandKey,expectedRevision:doc.revision});
      const deadline=Date.now()+180000;
      do {
        doc=await rpc('requests.get',{token});
        if (doc.planning?.state==='complete') break;
        if(doc.planning?.state==='failed' || Date.now()>deadline)throw Error('Manual planning: '+JSON.stringify(doc.planning));
        await sleep(1500);
      } while(true);
      assert.equal(doc.journals.filter(j=>j.key===commandKey).length,1);
      assert.equal(doc.engine.agentId,null);
      evidence.manualAfter={token,status:doc.engine.status,planHash:doc.planVersions.at(-1).hash};
      const {history}=await getRecord();
      const log=await readFile(join(config.paseoHome,'daemon.log'),'utf8');
      const events=log.split(/\r?\n/).flatMap(line=>{
        try { const row=JSON.parse(line);return row.module==='bootstrap' && row.pid ? [row] : []; }
        catch { return []; }
      });
      const at=event=>Date.parse(history.find(h=>h.event===event).at);
      const pidAt=time=>events.filter(row=>row.time<=time).at(-1)?.pid;
      evidence.daemon={before:pidAt(at('pause')),after:pidAt(at('resume'))};
      assert.ok(evidence.daemon.before && evidence.daemon.after && evidence.daemon.before!==evidence.daemon.after);
      await save();console.log('PASS manual admission and daemon restart');
    } else {
      assert.ok(['checkpoint','verify'].includes(action));
      if(action==='verify'){
        const restored=await get();assert.ok(evidence.beforeRestart);
        assert.deepEqual(restored.nodes.slice(0,2).map(n=>n.token),evidence.beforeRestart.tokens);
        assert.deepEqual(restored.nodes.slice(0,2).map(n=>n.lease.generation),evidence.beforeRestart.generations);
        if(restored.state==='paused')await rpc('runs.control',{runId,action:'resume',expectedRevision:restored.revision,commandKey:id+'-resume-workers'});
      }
      const start=Date.now();let last='';
      for(;;) {
        const run=await get();
        const summary=JSON.stringify([run.state,run.reason,run.nodes.map(n=>[n.id,n.status,n.waitReason]),run.advisors.map(a=>a.status)]);
        if(summary!==last){console.log(summary);last=summary;}
        if(Date.now()-start>12*60*1000)throw Error('Fixture timeout: '+summary);
        if(run.state==='completed') {
          const record=await getRecord();
          const integration=await rpc('integration.get',{runId}),entries=integration.entries;
          assert.deepEqual(entries.map(e=>e.feature),['A','B','C']);
          const repo=join(config.dataHome,'desktop','integrations',projectId,'repository.git');
          let base=integration.initial;
          for(const e of entries){assert.equal(e.base,base);assert.equal(await git(repo,'rev-parse',e.integrated+'^'),base);base=e.integrated;}
          assert.equal(await git(repo,'rev-parse',target),base);
          const checkout=join(dir,'integrated-checkout');if(!await stat(checkout).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))await exec('git',['clone','-b',target,repo,checkout],{windowsHide:true});
          await exec(process.execPath,['--test','checks/A.test.cjs','checks/B.test.cjs','checks/C.test.cjs'],{cwd:checkout,windowsHide:true});
          assert.equal(await git(game,'show','HEAD:'+scene),'score: 0\nlabel: unset');
          const docs=await Promise.all(run.nodes.map(n=>rpc('requests.get',{token:n.token})));
          const workers=docs.map(d=>({id:d.milestone.item,token:d.token,base:d.milestone.integrationBase,generation:d.milestone.generation,session:d.engine.agentId,worktree:d.engine.workspaceId,start:d.engine.commands.find(j=>j.kind==='start').resolvedAt,end:d.engine.result.collectedAt,result:d.engine.result.id,checks:d.engine.result.checks.map(c=>c.status)}));
          assert.equal(new Set(workers.map(w=>w.session)).size,3);assert.equal(new Set(workers.map(w=>w.worktree)).size,3);
          const agentFiles=await readdir(join(config.paseoHome,'agents'),{recursive:true});
          const sessions=agentFiles.filter(p=>p.endsWith('.json')).map(p=>p.split(/[\\/]/).at(-1).slice(0,-5)).sort();
          assert.deepEqual(sessions,workers.map(w=>w.session).sort());
          for (const w of workers) {
            const agent=api.agents.ref(w.session);await agent.refresh();assert.equal(agent.workspaceId,w.worktree);
            let page=await agent.timeline.refetch({direction:'tail',limit:100}), messages=[];
            for (;;) {
              messages.push(...page.entries.filter(e=>e.item.type==='user_message').map(e=>e.item.text));
              if (!page.hasOlder) break;
              page=await agent.timeline.refetch({direction:'before',cursor:page.startCursor,limit:100});
            }
            w.messages=messages.length;
            const d=docs.find(d=>d.token===w.token);
            const resumes=d.journals.filter(j=>j.kind==='resume' && j.state==='applied').length;
            assert.equal(w.messages,1+resumes);
            w.results=d.engine.results.map(r=>({id:r.id,failure:r.failure}));
          }
          assert.equal(run.advisors[0].handoff?.verdict,'accepted');
          assert.equal(workers[0].base,workers[1].base);
          assert.ok(Date.parse(workers[2].start)>Date.parse(workers[0].end));
          assert.ok(evidence.concurrent?.length===2 && evidence.blockedManual && evidence.beforeRestart);
          assert.deepEqual(run.nodes.slice(0,2).map(n=>n.lease.generation),evidence.beforeRestart.generations);
          const buffered=record.history.findIndex(h=>h.event==='B awaiting-integration');
          assert.ok(buffered>=0 && buffered<record.history.findIndex(h=>h.event==='accepted A'));
          assert.equal(workers[2].base,entries[1].integrated);
          assert.equal(await git(checkout,'rev-parse','HEAD'),base);
          Object.assign(evidence,{workers,initial:integration.initial,tip:base,entries:entries.map(e=>({feature:e.feature,base:e.base,head:e.head,integrated:e.integrated})),history:record.history,finalChecks:3});await save();console.log('PASS '+base);break;
        }
        if(run.advisors.some(a=>a.status==='blocked') || /INVALID|VIOLATION|CHANGED/.test(run.reason))throw Error(summary);
        const [a,b,c]=run.nodes;
        if(action==='checkpoint' && a.lease && b.lease){
          assert.match(c.waitReason,/자원 대기 A/);
          if(run.state==='active')await rpc('runs.control',{runId,action:'pause',expectedRevision:run.revision,commandKey:id+'-pause-workers'});
          const manual=await rpc('requests.save',{token:id+'-manual',commandKey:id+'-manual-draft',expectedRevision:0,input:{title:'manual',goal:'manual fixture',scope:'manual.txt',constraints:'격리 시험',discipline:'coding',mode:'new',parentToken:null,parentResultId:null,provider:setup.provider,thinkingOptionId:setup.thinkingOptionId,outputPath:'',validationProfile:'files'}});
          await assert.rejects(rpc('requests.plan',{token:manual.token,commandKey:id+'-manual-plan',expectedRevision:manual.revision}),/GLOBAL_EXECUTION_BUSY/);
          evidence.blockedManual=true;evidence.beforeRestart={tokens:[a.token,b.token],generations:[a.lease.generation,b.lease.generation],resourceWait:c.waitReason};await save();console.log('RESTART_CHECKPOINT');break;
        }
        if(action==='verify'){
          const docs=[];
          for(const n of run.nodes.filter(n=>n.lease && n.status!=='accepted')) {
            const doc=await rpc('requests.get',{token:n.token}).catch(e=>{if(String(e).includes('NOT_FOUND'))return null;throw e;});if(doc)docs.push(doc);
          }
          const first=docs.filter(d=>['A','B'].includes(d.milestone.item));
          const together=first.length===2 && first.every(d=>d.engine.status==='ready');
          if(together)await Promise.all(first.map(d=>rpc('requests.start',{token:d.token,expectedRevision:d.revision,commandKey:d.token+'-start',planHash:d.planVersions.at(-1).hash})));
          const live=await Promise.all(first.filter(d=>d.engine.agentId).map(async d=>{const a=api.agents.ref(d.engine.agentId);await a.refresh();return {id:d.milestone.item,session:d.engine.agentId,workspace:d.engine.workspaceId,status:a.status,active:!!a.activeTurn,at:new Date().toISOString()};}));
          if(live.length===2 && live.every(a=>a.active || a.status==='running') && !evidence.concurrent){evidence.concurrent=live;await save();}
          for(const d of docs){
            const n=run.nodes.find(n=>n.token===d.token),result=d.engine.result;
            const cmd=kind=>({token:d.token,expectedRevision:d.revision,commandKey:d.token+'-'+kind});
            if(d.engine.status==='ready' && n.id==='C')await rpc('requests.start',{...cmd('start'),planHash:d.planVersions.at(-1).hash});
            if(d.engine.status==='awaiting-review' && (n.id!=='A'||b.status==='awaiting-integration')){
              assert.ok(result.checks.length && result.checks.every(c=>c.passed) && !result.failure);
              await rpc('requests.review',{...cmd('review'),resultId:result.id,approved:true,qualityConfirmed:true,checksAcknowledged:true,note:'Fixture 고정 검사와 허용 출력 확인'});
            }
            if(d.engine.status==='completed'&&!d.exports.length)await rpc('requests.export',{...cmd('export'),resultId:result.id});
            if((d.engine.status==='failed'&&!d.engine.recovery?.pending)||d.planning?.state==='failed')throw Error(JSON.stringify([n.id,d.engine.error,result?.failure,d.planning?.error]));
          }
        }
        await sleep(1300);
      }
    }
  }
} finally {await client.close();}
