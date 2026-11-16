import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), mode = process.argv[2], runId = process.argv[3];
if (!['setup','draft','modify','modify-status','modify-start','modify-stop','modify-verify','plan','start','reconcile','status','revalidate-failure','resume','recover-mode','review','apply','undo','verify'].includes(mode) || !/^d1-[a-zA-Z0-9-]{8,60}$/.test(runId ?? '')) throw new Error('Usage: desktop-production.mjs setup|plan|start|status|revalidate-failure|resume|review|apply|undo|verify <prepared-isolated-run>');
const directory = join(root, '.desktop-local', runId), options = JSON.parse(await readFile(join(directory, 'desktop.json'), 'utf8'));
assert.equal(options.sourceRoot, root); assert.equal(await realpath(directory), options.isolationRoot);
const statePath = join(directory, 'production-verification.json');
let state = mode === 'setup' ? { runId, token: runId + '-request', source: join(directory, '시험 소스'), output: join(directory, '결과물') } : JSON.parse(await readFile(statePath, 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');
const client = createHostClient(options.endpoint, { clientId: runId + '-d3', clientType: 'cli', appVersion: '0.15.4', connectTimeoutMs: 5000, reconnect: { enabled: false }, localCredential: async () => (await readFile(join(options.paseoHome, 'local-credential'), 'utf8')).trim() });
const api = createPaseoApi(client), rpc = (method, input) => client.invokePluginRpc('orchiva-plugin', method, input);
const id = () => ({ projectId: state.projectId, token: state.token });
const get = () => rpc('desktop.requests.get', id());
const command = (doc, key) => ({ ...id(), expectedRevision: doc.revision, commandKey: runId + '-' + key });
const save = () => writeFile(statePath, JSON.stringify(state, null, 2));
try {
  await client.connect();
  assert.equal((await rpc('runtime.info', {})).serverVersion, 'desktop-d3');
  if (mode === 'setup') {
    await writeFile(statePath, JSON.stringify(state), { flag: 'wx' });
    await run('git', ['clone', '--no-hardlinks', resolve(root, '..', 'orchiva-PoC'), state.source], { windowsHide: true });
    await mkdir(state.output); await mkdir(join(state.source, 'checks'));
    await writeFile(join(state.source, 'checks/value.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\ntest('answer is 42', () => assert.equal(readFileSync(new URL('../answer.txt', import.meta.url), 'utf8').trim(), '42'));\n");
    await run('git', ['-C', state.source, 'add', 'checks/value.test.mjs'], { windowsHide: true });
    await run('git', ['-C', state.source, '-c', 'user.name=Orchiva Fixture', '-c', 'user.email=orchiva@test.invalid', 'commit', '-m', 'Isolated D3 verification fixture'], { windowsHide: true });
    const p = await rpc('desktop.projects.register', { name: 'D3 격리 검증', sourceRoot: state.source }); state.projectId = p.projectId; await save();
    const preview = await rpc('desktop.projects.preview', { projectId: p.projectId }); assert.equal(preview.issues.length, 0);
    await rpc('desktop.projects.initialize', { projectId: p.projectId, fingerprint: preview.fingerprint, commandKey: runId + '-init' });
    await rpc('desktop.projects.configure', { projectId: p.projectId, expectedRevision: 1, name: 'D3 격리 검증', baseRef: 'main', outputRoot: state.output });
    const models = await rpc('desktop.models', { projectId: p.projectId }); assert.ok(models.models.some(x => x.provider === 'codex/gpt-6.1-sol'));
  }
  if (mode === 'setup' || mode === 'draft') {
    state.baselineAgents = (await api.agents.list()).entries.map(x => x.agent?.id ?? x.workspace?.id ?? x.id); state.baselineWorkspaces = (await api.workspaces.list()).entries.map(x => x.id);
    const input = { title: 'D3 격리 검증 숫자 파일', goal: '프로젝트 루트 answer.txt에 42와 줄바꿈 하나를 작성한다.', scope: 'answer.txt 파일 하나만 제작한다. 기존 checks/value.test.mjs 테스트가 통과해야 한다.', constraints: '기존 테스트와 지침은 변경하지 않는다. 요청하지 않은 README·보고서·파일·의존성은 생성하지 않는다. 현재 Worktree만 사용하고 commit/push/merge와 하위 에이전트는 금지한다.', discipline: 'coding', mode: 'new', parentToken: null, parentResultId: null, provider: 'codex/gpt-6.1-sol', thinkingOptionId: 'low', outputPath: '', validationProfile: 'node-test' };
    await rpc('desktop.requests.save', { ...id(), expectedRevision: 0, commandKey: runId + '-draft', input }); await save();
  } else if (mode === 'plan') { const doc = await get(); const request = command(doc, 'plan'); await rpc('desktop.requests.plan', request); state.planCommand = request; await save(); }
  else if (mode === 'start') { const doc = await get(); assert.equal(doc.engine.status, 'ready'); const request = { ...command(doc, 'start'), planHash: doc.planVersions.at(-1).hash }; await rpc('desktop.requests.start', request); await rpc('desktop.requests.start', request); state.startCommand = request; await save(); }
  else if (mode === 'reconcile') { const doc = await get(); const target = doc.engine.commands.find(x => x.status === 'unknown'); assert.ok(target); await rpc('desktop.requests.reconcile', { ...command(doc, 'reconcile'), targetCommandKey: target.key }); }
  else if (mode === 'status') { const doc = await get(); console.log(JSON.stringify({ status: doc.engine.status, planning: doc.planning?.state, planError: doc.planning?.error, revision: doc.revision, error: doc.engine.error, observationError: doc.engine.observationError, results: doc.engine.results.length, checks: doc.engine.result?.checks.map(x => ({ passed: x.passed, status: x.status })), workspaceId: doc.engine.workspaceId, agentId: doc.engine.agentId, commands: doc.engine.commands.map(x => ({ kind: x.kind, status: x.status, phase: x.phase })) })); }
  else if (mode === 'revalidate-failure') {
    const doc = await get(); assert.equal(doc.engine.status, 'awaiting-review'); assert.ok(doc.engine.result.checks.every(x => x.passed));
    assert.ok(doc.engine.worktreePath.toLowerCase().startsWith(options.paseoHome.toLowerCase()));
    state.workspaceId = doc.engine.workspaceId; state.agentId = doc.engine.agentId; state.firstResult = doc.engine.result.id; await save();
    await writeFile(join(doc.engine.worktreePath, 'answer.txt'), '41\n');
    const failed = await rpc('desktop.requests.revalidate', { ...command(doc, 'fail-check'), resultId: doc.engine.result.id });
    assert.equal(failed.engine.status, 'failed'); assert.ok(failed.engine.result.checks.some(x => !x.passed)); state.failedResult = failed.engine.result.id; await save();
  } else if (mode === 'recover-mode') { const doc = await get(); assert.equal(doc.engine.status, 'failed'); assert.equal(doc.engine.agentId, '4ee0130e-8d34-458d-94fd-fd8d10039c76'); state.workspaceId = doc.engine.workspaceId; state.agentId = doc.engine.agentId; state.failedResult = doc.engine.result.id; await client.setAgentMode(doc.engine.agentId, 'auto'); await save();
  } else if (mode === 'resume') {
    const doc = await get(); assert.equal(doc.engine.status, 'failed');
    const request = { ...command(doc, 'resume'), resultId: doc.engine.result.id, instruction: '검증을 위해 answer.txt 값이 41로 바뀌었습니다. 이 파일만 42와 줄바꿈 하나로 복구하고 기존 checks/value.test.mjs를 실행하세요. 다른 파일·지침·테스트 변경, commit/push/merge, 외부 프로젝트 접근은 금지합니다.' };
    await rpc('desktop.requests.resume', request); await rpc('desktop.requests.resume', request); state.resumeCommand = request; await save();
  } else if (mode === 'review') {
    const doc = await get(); assert.equal(doc.engine.status, 'awaiting-review'); assert.equal(doc.engine.agentId, state.agentId); assert.equal(doc.engine.workspaceId, state.workspaceId);
    assert.ok(doc.engine.results.some(x => x.id === state.failedResult)); assert.ok(doc.engine.result.checks.every(x => x.passed)); assert.equal(await readFile(join(doc.engine.worktreePath, 'answer.txt'), 'utf8'), '42\n');
    const approved = await rpc('desktop.requests.review', { ...command(doc, 'approve'), resultId: doc.engine.result.id, approved: true, qualityConfirmed: true, checksAcknowledged: true, note: '시험 기대값 42와 줄바꿈, 원래 Node 검사 통과 및 검사 파일 보존을 직접 대조함' });
    await rpc('desktop.requests.export', { ...command(approved, 'export'), resultId: approved.engine.result.id }); await save();
  } else if (mode === 'apply') {
    const doc = await get(), resultId = doc.engine.result.id, diff = await rpc('desktop.requests.diff', { ...id(), resultId }); assert.deepEqual(diff.files.map(x => x.path), ['answer.txt']); assert.equal(diff.files[0].conflict, false);
    const request = { ...command(doc, 'apply'), resultId, paths: ['answer.txt'] }; const applied = await rpc('desktop.requests.apply', request); await rpc('desktop.requests.apply', request); state.transferKey = applied.key;
    assert.equal(await readFile(join(state.source, 'answer.txt'), 'utf8'), '42\n'); await save();
  } else if (mode === 'undo') { const doc = await get(); await rpc('desktop.requests.undo', { ...id(), resultId: doc.engine.result.id, transferKey: state.transferKey }); await assert.rejects(readFile(join(state.source, 'answer.txt')), { code: 'ENOENT' }); state.undone = true; await save(); }
  else if (mode === 'modify') {
    const parent = await get(); state.modifyToken = runId + '-modify'; await save();
    const childId = { projectId: state.projectId, token: state.modifyToken };
    const input = { ...parent.input, title: '별도 수정 PLAN과 중단 검증', goal: 'answer.txt를 43과 줄바꿈으로 변경하는 별도 수정 요청이다.', scope: 'answer.txt 하나만 수정한다. 원래 검사 기대값 42는 변경하지 말고 불일치를 결과에 보고한다.', mode: 'modify', parentToken: parent.token, parentResultId: parent.engine.result.id };
    const draft = await rpc('desktop.requests.save', { ...childId, expectedRevision: 0, commandKey: runId + '-modify-draft', input });
    await rpc('desktop.requests.plan', { ...childId, expectedRevision: draft.revision, commandKey: runId + '-modify-plan' });
  } else if (mode.startsWith('modify-')) {
    const childId = { projectId: state.projectId, token: state.modifyToken }, doc = await rpc('desktop.requests.get', childId);
    if (mode === 'modify-status') console.log(JSON.stringify({ status: doc.engine.status, planning: doc.planning?.state, error: doc.engine.error, agentId: doc.engine.agentId, results: doc.engine.results.length, journals: doc.journals.map(x => ({ kind:x.kind, state:x.state })) }));
    else if (mode === 'modify-start') { assert.equal(doc.engine.status, 'ready'); assert.equal(doc.input.parentToken, state.token); await rpc('desktop.requests.start', { ...childId, expectedRevision: doc.revision, commandKey: runId + '-modify-start', planHash: doc.planVersions.at(-1).hash }); }
    else if (mode === 'modify-stop') { assert.ok(doc.engine.agentId); const request = { ...childId, expectedRevision: doc.revision, commandKey: runId + '-modify-stop' }; await rpc('desktop.requests.stop', request); await rpc('desktop.requests.stop', request); state.stopRequested = true; await save(); }
    else { assert.equal(doc.engine.status, 'failed'); assert.ok(doc.journals.some(x => x.kind === 'stop' && x.state === 'applied' && x.phase === 'stopped')); assert.ok(doc.engine.result.executionFailure); state.modifyVerified = { token: doc.token, agentId:doc.engine.agentId, workspaceId:doc.engine.workspaceId, resultId:doc.engine.result.id, stopped:true }; await save(); }
  }
  else if (mode === 'verify') {
    const doc = await get(); assert.equal(doc.engine.status, 'completed'); assert.ok(state.undone); assert.equal(doc.engine.agentId, state.agentId); assert.equal(doc.engine.workspaceId, state.workspaceId);
    assert.equal((await api.agents.list()).entries.filter(x => !state.baselineAgents.includes(x.agent?.id ?? x.id)).length, state.modifyVerified ? 2 : 1); assert.equal((await api.workspaces.list()).entries.filter(x => !state.baselineWorkspaces.includes(x.workspace?.id ?? x.id)).length, state.modifyVerified ? 2 : 1);
    assert.ok(doc.engine.results.length >= 2); assert.equal(doc.planVersions.length, 1); assert.equal(doc.engine.attempt, 2);
    const output = doc.exports.at(-1).root; assert.deepEqual(await readdir(output), ['answer.txt']); assert.equal(await readFile(join(output, 'answer.txt'), 'utf8'), '42\n');
    state.verifiedAt = new Date().toISOString(); state.resultIds = doc.engine.results.map(x => x.id); state.sourcePlanHash = hash(await readFile(join(state.source, doc.planVersions[0].path))); state.outputs = await readdir(output); await save();
  }
  if (mode !== 'status') console.log(JSON.stringify({ runId, phase: mode, passed: true }));
} finally { await client.close(); }
