// Real, isolated D5 acceptance. Run foundation prepare --empty first; never targets operating projects.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { inspectPng, inspectWav } from '../server/adapters/media/inspect-media.ts';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), runId = process.argv[2];
if (!/^d1-d5-[a-zA-Z0-9-]{8,50}$/.test(runId ?? '')) throw new Error('Usage: node --import tsx scripts/desktop-media.mjs d1-d5-<unique-id>');
const directory = join(root, '.desktop-local', runId), options = JSON.parse(await readFile(join(directory, 'desktop.json'), 'utf8'));
assert.equal(options.sourceRoot, root); assert.equal(options.isolationRoot, await realpath(directory));
const source = join(directory, '미디어 시험 소스'), output = join(directory, '미디어 결과물'), statePath = join(directory, 'media-verification.json');
const state = { runId, source, output, cases: [] }, hash = b => createHash('sha256').update(b).digest('hex');
await writeFile(statePath, JSON.stringify(state), { flag: 'wx' });
const client = createHostClient(options.endpoint, { clientId: runId, clientType: 'cli', appVersion: '0.15.4', connectTimeoutMs: 5000, reconnect: { enabled: false }, localCredential: async () => (await readFile(join(options.paseoHome, 'local-credential'), 'utf8')).trim() });
const api = createPaseoApi(client), rpc = (method, input) => client.invokePluginRpc('orchiva-plugin', method, input);
const save = () => writeFile(statePath, JSON.stringify(state, null, 2));
async function until(id, phase, predicate) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const doc = await rpc('desktop.requests.get', id);
    if (predicate(doc)) return doc;
    if (doc.planning?.state === 'failed' || doc.engine.status === 'failed' || doc.engine.status === 'needs-input') throw new Error(`${phase}: ${doc.planning?.error ?? doc.engine.error ?? doc.engine.status}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('D5_TIMEOUT_' + phase);
}
try {
  await client.connect(); assert.equal((await rpc('runtime.info', {})).serverVersion, 'desktop-d5');
  assert.equal((await api.agents.list()).entries.length, 0); assert.equal((await api.workspaces.list()).entries.length, 0);
  await run('git', ['clone', '--no-hardlinks', resolve(root, '..', 'orchiva-PoC'), source], { windowsHide: true }); await mkdir(output);
  const p = await rpc('desktop.projects.register', { name: 'D5 임시 미디어 검증', sourceRoot: source }); state.projectId = p.projectId; await save();
  const initial = await rpc('desktop.projects.preview', { projectId: p.projectId }); assert.equal(initial.issues.length, 0);
  await rpc('desktop.projects.initialize', { projectId: p.projectId, fingerprint: initial.fingerprint, commandKey: runId + '-init' });
  await rpc('desktop.projects.configure', { projectId: p.projectId, expectedRevision: 1, name: 'D5 임시 미디어 검증', baseRef: 'main', outputRoot: output });
  const specs = [
    { kind:'art',format:'png',width:128,height:96,color:'#55AAFF',shape:'circle',transparent:true },
    { kind:'sound',format:'wav',seconds:1.5,frequency:440,sampleRate:'44100',channels:1,waveform:'sine',fade:true },
    { kind:'effect',format:'png-sheet',width:64,height:64,color:'#FFAA33',frames:8,seconds:1 }
  ];
  for (const media of specs) {
    const token = runId + '-' + media.kind, id = { projectId: p.projectId, token }, item = { token, kind: media.kind }; state.cases.push(item); await save();
    const command = (doc, phase) => ({ ...id, expectedRevision: doc.revision, commandKey: token + '-' + phase });
    const input = { title: 'D5 임시 ' + media.kind, goal: '임시 생성 규격의 시험용 자산을 생성하고 검사한다.', scope: '자동 생성되는 media 폴더의 파일만 검사하고 보고한다. 다른 파일은 만들거나 수정하지 않는다.', constraints: '현재 Worktree만 사용. commit/push/merge, 하위 에이전트, README/보고서 생성 금지. 제공된 자산을 변경하지 않는다.', discipline: media.kind, media, mode: 'new', parentToken: null, parentResultId: null, provider: 'codex/gpt-6.1-sol', thinkingOptionId: 'low', outputPath:'', validationProfile:'files' };
    let doc = await rpc('desktop.requests.save', { ...id, expectedRevision:0,commandKey:token+'-save',input });
    await rpc('desktop.requests.plan',command(doc,'plan')); console.log(media.kind + ': AI PLAN requested');
    doc = await until(id,'plan', d => d.engine.status === 'ready');
    assert.ok(doc.planVersions.at(-1).content.includes('orchiva-procedural-v1'));
    const start = { ...command(doc,'start'),planHash:doc.planVersions.at(-1).hash };
    await rpc('desktop.requests.start',start); await rpc('desktop.requests.start',start);
    doc = await until(id,'execution',d=>d.engine.status==='awaiting-review');
    assert.ok(doc.engine.result.checks.length > 0 && doc.engine.result.checks.every(c=>c.passed));
    assert.ok(doc.engine.worktreePath.toLowerCase().startsWith(options.paseoHome.toLowerCase()));
    item.agentId=doc.engine.agentId; item.workspaceId=doc.engine.workspaceId; item.worktree=doc.engine.worktreePath;
    const paths=doc.engine.result.changedFiles.filter(x=>x.startsWith('media/')), name=media.kind==='art'?'shape.png':media.kind==='sound'?'tone.wav':'effect.png', path=`media/${token}/${name}`;
    assert.equal(paths.length,media.kind==='effect'?2:1);
    const data=await readFile(join(doc.engine.worktreePath,path));
    item.decoded=media.kind==='sound'?inspectWav(data):inspectPng(data); item.sha256=hash(data); item.bytes=data.length;
    let received=Buffer.alloc(0);
    while(received.length<data.length) {const chunk=await rpc('desktop.requests.media-preview',{...id,resultId:doc.engine.result.id,path,offset:received.length}); assert.equal(chunk.sha256,hash(data)); received=Buffer.concat([received,Buffer.from(chunk.content,'base64')]);}
    assert.deepEqual(received,data);
    if(media.kind==='art') {
      item.firstResult=doc.engine.result.id; const broken=Buffer.from(data);broken[45]^=1;await writeFile(join(doc.engine.worktreePath,path),broken);
      await assert.rejects(rpc('desktop.requests.media-preview',{...id,resultId:doc.engine.result.id,path,offset:0}));
      doc=await rpc('desktop.requests.revalidate',{...command(doc,'corrupt'),resultId:doc.engine.result.id}); assert.equal(doc.engine.status,'failed');item.failedResult=doc.engine.result.id;
      await writeFile(join(doc.engine.worktreePath,path),data);
      doc=await rpc('desktop.requests.revalidate',{...command(doc,'repair'),resultId:doc.engine.result.id});assert.equal(doc.engine.status,'awaiting-review');assert.ok(doc.engine.results.some(r=>r.id===item.failedResult));
    }
    const resultId=doc.engine.result.id;
    doc=await rpc('desktop.requests.review',{...command(doc,'review'),resultId,approved:true,qualityConfirmed:true,checksAcknowledged:true,note:'격리 시험: 실제 파일 규격/바이트/해시와 손상 거부 확인. 심미적 품질·청취 평가는 별도 GUI 검증.'});
    doc=await rpc('desktop.requests.export',{...command(doc,'export'),resultId}); item.exportRoot=doc.exports.at(-1).root;
    const diff=await rpc('desktop.requests.diff',{...id,resultId}); assert.deepEqual(diff.files.map(f=>f.path).sort(),paths.sort());
    const apply={...command(doc,'apply'),resultId,paths}; await rpc('desktop.requests.apply',apply);await rpc('desktop.requests.apply',apply);
    assert.deepEqual(await readFile(join(source,path)),data);assert.deepEqual(await readFile(join(item.exportRoot,path)),data);
    await rpc('desktop.requests.undo',{...id,resultId,transferKey:apply.commandKey});await assert.rejects(readFile(join(source,path)),{code:'ENOENT'});
    item.resultId=resultId;item.passed=true;await save();console.log(media.kind+': generation, decode, preview, export/apply/undo PASS');
  }
  assert.equal((await api.agents.list()).entries.length,3); assert.equal((await api.workspaces.list()).entries.length,3);
  state.verifiedAt=new Date().toISOString();await save();console.log('D5 actual acceptance PASS');
} catch(error) {state.failure=String(error);await save();throw error;} finally {await client.close();}
