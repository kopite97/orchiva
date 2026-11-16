// D6 packaged acceptance: only a new, explicitly prepared isolated profile and clone.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { inspectPng, inspectWav } from '../server/adapters/media/inspect-media.ts';

const execute = promisify(execFile), root = resolve(import.meta.dirname, '..'), [mode, runId] = process.argv.slice(2);
if (!['setup','coding','media','conversation','verify'].includes(mode) || !/^d6b-[a-z0-9-]{10,55}$/.test(runId ?? '')) throw Error('Usage: desktop-integrated.mjs setup|coding|media|conversation|verify d6b-<new-id>');
const directory = join(root, '.desktop-local', runId), options = JSON.parse(await readFile(join(directory, 'desktop.json'), 'utf8'));
assert.equal(await realpath(join(directory, 'profile')), options.isolationRoot);
assert.ok(options.sourceRoot.startsWith(join(root, '.desktop-local')) && options.sourceRoot.endsWith(join('runtime','plugin')));
const statePath = join(directory, 'integrated.json');
const state = mode === 'setup' ? { runId, source:join(directory,'시험 소스'), output:join(directory,'결과물'), cases:[], completed:[] } : JSON.parse(await readFile(statePath,'utf8'));
const save = () => writeFile(statePath, JSON.stringify(state,null,2)), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const client = createHostClient(options.endpoint,{clientId:runId+'-'+mode,clientType:'cli',appVersion:'0.15.4',connectTimeoutMs:5000,reconnect:{enabled:false},localCredential:async()=>(await readFile(join(options.paseoHome,'local-credential'),'utf8')).trim()});
const api = createPaseoApi(client), rpc = (method, params) => client.invokePluginRpc('orchiva-plugin',method,params);
async function until(read,predicate,label,timeout=240000) { const end=Date.now()+timeout; let last; while(Date.now()<end){try{last=await read();if(predicate(last))return last;}catch(error){last=String(error);} await new Promise(r=>setTimeout(r,1500));} throw Error(label+' timed out: '+JSON.stringify(last).slice(0,400)); }
const id = token => ({projectId:state.projectId,token});
const get = token => rpc('desktop.requests.get',id(token));
const cmd = (doc,phase) => ({...id(doc.token),expectedRevision:doc.revision,commandKey:doc.token+'-'+phase});
async function executeRequest(kind,media) {
  const token=runId+'-'+kind,item={kind,token};state.cases.push(item);await save();
  const input={title:'D6 배포본 '+kind,goal:media?'지정된 임시 생성 규격의 자산을 생성하고 검사한다.':'answer.txt에 42와 줄바꿈 하나를 쓴다.',scope:media?'자동 생성된 media 폴더의 자산만 검사하고 보고한다.':'answer.txt 파일 하나만 작성하고 기존 checks/value.test.mjs를 실행한다. 창 종료 시험을 위해 작업 시작 후 먼저 node로 30초 대기한다.',constraints:'현재 Worktree만 사용한다. commit/push/merge, 하위 에이전트, 외부 프로젝트 접근, README/보고서/테스트/지침 변경 금지.'+(media?' 자동 생성 자산은 변경하지 않는다.':''),discipline:media?kind:'coding',...(media?{media}:{}),mode:'new',parentToken:null,parentResultId:null,provider:'codex/gpt-6.1-sol',thinkingOptionId:'low',outputPath:'',validationProfile:media?'files':'node-test'};
  let doc=await rpc('desktop.requests.save',{...id(token),expectedRevision:0,commandKey:token+'-save',input});
  await rpc('desktop.requests.plan',cmd(doc,'plan'));console.log(kind+': PLAN requested');
  doc=await until(()=>get(token),d=>d.engine.status==='ready','plan');
  const start={...cmd(doc,'start'),planHash:doc.planVersions.at(-1).hash};item.start=start;await save();
  await rpc('desktop.requests.start',start);await rpc('desktop.requests.start',start);console.log(kind+': execution started');
  doc=await until(()=>get(token),d=>d.engine.status==='awaiting-review','execution');
  assert.ok(doc.engine.result.checks.every(c=>c.passed));item.agentId=doc.engine.agentId;item.workspaceId=doc.engine.workspaceId;
  assert.ok(doc.engine.worktreePath.startsWith(options.paseoHome));
  if(!media){
    await writeFile(join(doc.engine.worktreePath,'answer.txt'),'41\n');
    doc=await rpc('desktop.requests.revalidate',{...cmd(doc,'failure'),resultId:doc.engine.result.id});
    assert.equal(doc.engine.status,'failed');item.failedResult=doc.engine.result.id;await save();
    const resume={...cmd(doc,'resume'),resultId:doc.engine.result.id,instruction:'검증을 위해 answer.txt 값이 41로 바뀌었습니다. 이 파일만 42와 줄바꿈으로 복구하고 기존 테스트를 실행하세요. 다른 파일·테스트·지침 변경 및 commit/push/merge 금지.'};
    await rpc('desktop.requests.resume',resume);await rpc('desktop.requests.resume',resume);
    doc=await until(()=>get(token),d=>d.engine.status==='awaiting-review','recovery');
    assert.equal(doc.engine.agentId,item.agentId);assert.equal(doc.engine.workspaceId,item.workspaceId);assert.ok(doc.engine.results.some(r=>r.id===item.failedResult));
  }
  const resultId=doc.engine.result.id, paths=doc.engine.result.changedFiles.filter(p=>media?p.startsWith('media/') : p==='answer.txt');assert.ok(paths.length);
  if(media){
    const path=`media/${token}/${kind==='art'?'shape.png':kind==='sound'?'tone.wav':'effect.png'}`,chunks=[];let offset=0,total;
    do{const chunk=await rpc('desktop.requests.media-preview',{...id(token),resultId,path,offset});const data=Buffer.from(chunk.content,'base64');chunks.push(data);offset+=data.length;total=chunk.size;assert.ok(data.length);}while(offset<total);
    const data=Buffer.concat(chunks);assert.deepEqual(data,await readFile(join(doc.engine.worktreePath,path)));item.sha256=hash(data);item.media=kind==='sound'?inspectWav(data):inspectPng(data);
  }
  doc=await rpc('desktop.requests.review',{...cmd(doc,'review'),resultId,approved:true,qualityConfirmed:true,checksAcknowledged:true,note:'배포본 통합 시험: 실제 파일 규격/해시와 검사 근거 확인. 심미적 평가는 D5 GUI 근거와 별도.'});
  doc=await rpc('desktop.requests.export',{...cmd(doc,'export'),resultId});item.exportRoot=doc.exports.at(-1).root;
  const diff=await rpc('desktop.requests.diff',{...id(token),resultId});assert.deepEqual(diff.files.map(f=>f.path).sort(),paths.sort());
  const apply={...cmd(doc,'apply'),resultId,paths};await rpc('desktop.requests.apply',apply);await rpc('desktop.requests.apply',apply);
  for(const path of paths)assert.deepEqual(await readFile(join(state.source,path)),await readFile(join(item.exportRoot,path)));
  await rpc('desktop.requests.undo',{...id(token),resultId,transferKey:apply.commandKey});for(const path of paths)await assert.rejects(readFile(join(state.source,path)),{code:'ENOENT'});
  item.resultId=resultId;item.passed=true;await save();console.log(kind+': PASS');
}
try{
  await client.connect();const info=await rpc('runtime.info',{});assert.equal(info.dataHome,options.dataHome);
  if(mode==='setup'){
    await writeFile(statePath,JSON.stringify(state),{flag:'wx'});assert.equal((await api.agents.list()).entries.length,0);assert.equal((await api.workspaces.list()).entries.length,0);
    await execute('git',['clone','--no-hardlinks',resolve(root,'..','orchiva-PoC'),state.source],{windowsHide:true});await mkdir(state.output);await mkdir(join(state.source,'checks'),{recursive:true});
    await writeFile(join(state.source,'checks/value.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';test('answer',()=>assert.equal(readFileSync(new URL('../answer.txt',import.meta.url),'utf8').trim(),'42'));\n");
    await execute('git',['-C',state.source,'add','checks/value.test.mjs'],{windowsHide:true});await execute('git',['-C',state.source,'-c','user.name=Orchiva Fixture','-c','user.email=orchiva@test.invalid','commit','-m','D6 isolated check'],{windowsHide:true});
    const p=await rpc('desktop.projects.register',{sourceRoot:state.source,name:'D6 배포 통합 시험'});state.projectId=p.projectId;await save();const preview=await rpc('desktop.projects.preview',{projectId:p.projectId});assert.equal(preview.issues.length,0);
    await rpc('desktop.projects.initialize',{projectId:p.projectId,fingerprint:preview.fingerprint,commandKey:runId+'-init'});await rpc('desktop.projects.configure',{projectId:p.projectId,expectedRevision:1,name:'D6 배포 통합 시험',baseRef:'main',outputRoot:state.output});
  }else if(mode==='coding'){assert.ok(!state.cases.some(c=>c.kind==='coding'));await executeRequest('coding');}
  else if(mode==='media'){
    assert.ok(!state.cases.some(c=>['art','sound','effect'].includes(c.kind)));
    for(const media of [{kind:'art',format:'png',width:128,height:96,color:'#55AAFF',shape:'circle',transparent:true},{kind:'sound',format:'wav',seconds:1.5,frequency:440,sampleRate:'44100',channels:1,waveform:'sine',fade:true},{kind:'effect',format:'png-sheet',width:64,height:64,color:'#FFAA33',frames:8,seconds:1}])await executeRequest(media.kind,media);
  }else if(mode==='conversation'){
    assert.ok(!state.conversationId);const identity={projectId:state.projectId,conversationId:randomUUID()};state.conversationId=identity.conversationId;await save();
    let doc=await rpc('desktop.conversations.create',{...identity,expectedRevision:0,commandKey:runId+'-conversation',selection:{provider:'codex/gpt-6.1-sol',thinkingOptionId:'low',policy:{access:'read-only',approval:'never'}}});
    for(let n=1;n<=2;n++){
      const command={...identity,expectedRevision:doc.revision,commandKey:runId+'-turn-'+n,text:n===1?'도구를 호출하지 말고 한 문장으로 게임 튜토리얼의 목적을 설명하세요.':'앞선 답변에 이어서 튜토리얼을 짧게 만드는 방법을 한 문장으로 설명하세요. 도구를 호출하지 마세요.'};
      await rpc('desktop.conversations.send',command);await rpc('desktop.conversations.send',command);doc=await until(()=>rpc('desktop.conversations.get',identity),d=>d.turns.at(-1)?.state==='answered','conversation');
      if(n===1){
        state.conversationAgent=doc.agentId;
        const before=await rpc('runtime.info',{});
        assert.equal(before.dataHome,options.dataHome);assert.equal(before.paseoHome,options.paseoHome);assert.ok(before.isolated && Number.isInteger(before.pid) && before.pid!==process.pid);
        state.workerFault={pid:before.pid,startedAt:before.startedAt,firstTurn:doc.turns[0].id,recovery:'explicit public plugin reload'};await save();
        process.kill(before.pid);
        await execute(options.nodePath,[options.paseoCliPath,'plugin','reload','orchiva-plugin','--home',options.paseoHome,'--json'],{windowsHide:true,timeout:45000});
        const after=await until(()=>rpc('runtime.info',{}),v=>v.pid!==before.pid&&!v.restoring,'owned plugin recovery');
        assert.equal(after.dataHome,options.dataHome);
        doc=await rpc('desktop.conversations.get',identity);assert.equal(doc.agentId,state.conversationAgent);assert.equal(doc.turns.length,1);assert.equal(doc.turns[0].id,state.workerFault.firstTurn);
        state.workerFault.recoveredPid=after.pid;await save();
      }else assert.equal(doc.agentId,state.conversationAgent);
    }state.conversationTurns=doc.turns.map(t=>({id:t.id,messageId:t.messageId,state:t.state}));await save();
  }else if(mode==='verify'){
    assert.equal(state.cases.filter(c=>c.passed).length,4);for(const item of state.cases){const doc=await get(item.token);assert.equal(doc.engine.result.id,item.resultId);assert.equal(doc.engine.agentId,item.agentId);assert.equal(doc.engine.workspaceId,item.workspaceId);}
    const conv=await rpc('desktop.conversations.get',{projectId:state.projectId,conversationId:state.conversationId});assert.equal(conv.agentId,state.conversationAgent);assert.equal(conv.turns.length,2);
    const agents=await api.agents.list(),spaces=await api.workspaces.list();assert.equal(agents.entries.length,5);assert.equal(agents.pageInfo.hasMore,false);assert.equal(spaces.pageInfo.hasMore,false);
    // Consultation attaches to the source checkout; it is a workspace but not a new worktree.
    const worktrees=spaces.entries.filter(s=>s.workspaceKind==='worktree'),checkouts=spaces.entries.filter(s=>s.workspaceKind==='local_checkout');
    assert.deepEqual(worktrees.map(s=>s.id).sort(),state.cases.map(c=>c.workspaceId).sort());assert.equal(checkouts.length,1);assert.equal(checkouts[0].workspaceDirectory,state.source);assert.equal(spaces.entries.length,5);
    state.counts={agents:5,workspaces:5,worktrees:4,localCheckouts:1};
    if(state.failure?.mode==='verify')state.failure.resolution='Workspace inventory includes one consultation source checkout; four production worktree IDs match exactly.';
  }
  state.completed.push(mode);await save();console.log(mode+': COMPLETE');
}catch(error){state.failure={mode,message:String(error),at:new Date().toISOString()};await save();throw error;}finally{await api.dispose();await client.close();}
