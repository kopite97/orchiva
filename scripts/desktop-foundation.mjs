import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { JsonRequestStore } from '../server/adapters/storage/json-request-store.ts';
import { DraftRequest } from '../server/application/draft-request.ts';
import { BridgeSession } from '../bridge/protocol.ts';

const execute = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2], runId = process.argv[3];
if (!['prepare','start','verify','stdio','offline','stop'].includes(mode) || !/^d1-[\p{L}\p{N} -]{8,60}$/u.test(runId ?? '') || runId.trim() !== runId) throw new Error('Usage: node --import tsx scripts/desktop-foundation.mjs prepare|start|verify|stdio|offline|stop d1-<unique-id> [--empty]');
const isolationRoot = join(root, '.desktop-local', runId), dataHome = join(isolationRoot, 'data'), paseoHome = join(isolationRoot, 'paseo');
const manifestPath = join(isolationRoot, 'manifest.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function hashes(directory) { const result = {}; for (const name of await readdir(directory).catch(() => [])) if (name.endsWith('.json')) result[name] = hash(await readFile(join(directory, name))); return result; }
const protectedData = () => hashes(join(homedir(), '.orchiva', 'requests'));
if (mode === 'prepare') {
  await mkdir(isolationRoot, { recursive: true });
  // Never replace another run's manifest or fixture.
  await writeFile(manifestPath, '{}', { flag: 'wx' });
  await mkdir(dataHome); await mkdir(paseoHome);
  const probe = createServer(); await new Promise((ok,fail) => { probe.once('error',fail); probe.listen(0,'127.0.0.1',ok); });
  const port = probe.address().port; await new Promise(ok=>probe.close(ok));
  const settings = { isolationRoot: await realpath(isolationRoot), dataHome: await realpath(dataHome), paseoHome: await realpath(paseoHome), endpoint: `127.0.0.1:${port}` };
  const config = { name: 'PoC Sandbox', repositoryPath: await realpath(resolve(root, '..', 'orchiva-PoC')), baseRef: 'main', provider: 'codex/default' };
  await writeFile(join(dataHome, 'project.json'), JSON.stringify(config, null, 2));
  await writeFile(join(paseoHome, 'config.json'), JSON.stringify({ version: 1, daemon: { listen: settings.endpoint }, pluginsEnabled: true, plugins: { 'orchiva-plugin': { source: 'directory', path: root, enabled: true } } }, null, 2));
  const emptyFixture = process.argv.includes('--empty');
  const store = new JsonRequestStore(join(dataHome, 'requests')); await store.open();
  try {
    const drafts = new DraftRequest(store);
    for (let i = 1; i <= (emptyFixture ? 0 : 3); i++) await drafts.save({ token: `d1-fixture-${String(i).padStart(3, '0')}`, commandKey: `d1-draft-${i}`, expectedRevision: 0, feature: { title: ['인벤토리 정렬 개선', '튜토리얼 흐름 정리', '한글 · 공백 경로 확인'][i - 1], goal: '합성 조회 fixture', scope: '조회만', constraints: '실행 금지', validation: '생성 수 0', completionCriteria: '' }, criteria: [], checks: [] });
    if (!emptyFixture) {
    const completed = await store.get('d1-fixture-003');
    completed.status = 'completed'; completed.feature.completionCriteria = '합성 결과와 판정 이력 조회';
    completed.result = { id: 'synthetic-result-001', sourceKey: 'synthetic-only', collectedAt: new Date().toISOString(), finalResponse: '합성 결과입니다. 모델 실행이나 파일 변경은 없었습니다.', agentStatus: 'idle', changedFiles: [], files: [], diffStat: '', fingerprint: hash('synthetic-only'), checks: [], failure: null, executionFailure: null };
    completed.decision = { approved: true, note: '합성 검토 이력 · 실제 완료 판정 아님', at: new Date().toISOString(), resultId: completed.result.id };
    await store.save(completed);
    }
  } finally { await store.close(); }
  const options = { nodePath: process.execPath, sourceRoot: root, paseoCliPath: join(process.env.APPDATA, 'npm', 'node_modules', '@getpaseo', 'cli', 'bin', 'paseo'), ...settings };
  await writeFile(join(isolationRoot, 'desktop.json'), JSON.stringify(options, null, 2));
  await writeFile(manifestPath, JSON.stringify({ runId, ...settings, sourceRoot: root, fixtureKind: emptyFixture ? 'empty' : 'two-drafts-one-completed', preparedAt: new Date().toISOString(), baseline: await hashes(join(dataHome, 'requests')), protectedBaseline: await protectedData() }, null, 2));
  console.log(JSON.stringify({ runId, desktopConfig: join(isolationRoot, 'desktop.json') }));
} else {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.runId, runId); assert.equal(manifest.sourceRoot, root);
  assert.equal(await realpath(isolationRoot), manifest.isolationRoot);
  const expectedTotal = manifest.fixtureKind === 'empty' ? 0 : 3;
  const env = { ...process.env, ORCHIVA_ISOLATION_ROOT: manifest.isolationRoot, ORCHIVA_DATA_HOME: manifest.dataHome, ORCHIVA_PASEO_HOME: manifest.paseoHome, ORCHIVA_PASEO_ENDPOINT: manifest.endpoint };
  delete env.CODEX_WINDOWS_REGISTERED_CORE; delete env.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY;
  if (mode === 'start' || mode === 'stop') {
    const cli = join(process.env.APPDATA, 'npm', 'node_modules', '@getpaseo', 'cli', 'bin', 'paseo');
    if (mode === 'start') {
      await new Promise((ok, fail) => {
        // No captured handles can be retained by the independently living runtime.
        const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts', 'start-desktop-runtime.ps1'), '-Config', join(isolationRoot, 'desktop.json')], { env, cwd: root, windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { child.kill(); fail(new Error('DESKTOP_START_TIMEOUT')); }, 75000);
        child.once('error', () => { clearTimeout(timer); fail(new Error('DESKTOP_START_FAILED')); });
        child.once('exit', code => { clearTimeout(timer); code === 0 ? ok() : fail(new Error('DESKTOP_START_FAILED')); });
      });
      console.log('PASS: desktop runtime launcher ready');
    }
    else {
      const output = await execute(process.execPath, [cli, 'daemon', 'stop', '--home', paseoHome], { env, cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
      console.log(output.stdout);
      assert.deepEqual(await hashes(join(dataHome, 'requests')), manifest.baseline);
      assert.deepEqual(await protectedData(), manifest.protectedBaseline);
      console.log('PASS: fixture and original request hashes unchanged');
    }
  } else if (mode === 'stdio' || mode === 'offline') {
    const rounds = [];
    for (let round = 0; round < (mode === 'offline' ? 1 : 3); round++) {
      const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'bridge', 'index.ts')], { cwd: root, env, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      const replies = new Map(); let buffer = '', stderrBytes = 0;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', text => { buffer += text; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); const response = JSON.parse(line); replies.get(response.id)?.(response); } });
      child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
      const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
      const call = (id, method, params = {}) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('STDIO_TIMEOUT')), 20000); replies.set(id, result => { clearTimeout(timer); resolve(result); }); child.stdin.write(JSON.stringify({ protocolVersion: 1, id, method, params }) + '\n'); });
      try {
        if (mode === 'offline') {
          assert.equal((await call('hello','handshake')).error.code,'CONNECTION_FAILED');
          assert.equal((await call('read','project.read')).error.code,'HANDSHAKE_REQUIRED');
        } else {
        assert.ok((await call('hello','handshake')).result);
        const [project, page] = await Promise.all([call('project','project.read'), call('page','request.page',{ filter:'all', limit:20 })]);
        assert.equal(project.result.name, 'PoC Sandbox'); assert.equal(page.result.total, expectedTotal);
        assert.equal((await call('deny','request.resume')).error.code, 'METHOD_DENIED');
        }
        child.stdin.end();
        let exitTimer; const code = await Promise.race([exited, new Promise((_,reject)=>{ exitTimer=setTimeout(()=>reject(new Error('STDIO_EXIT_TIMEOUT')),5000); })]).finally(()=>clearTimeout(exitTimer));
        assert.equal(code, 0); rounds.push({ round, pid:child.pid, code, stderrBytes });
      } finally { if (child.exitCode === null) child.kill(); }
    }
    assert.deepEqual(await hashes(join(dataHome, 'requests')), manifest.baseline);
    await writeFile(join(isolationRoot,`${mode}.json`), JSON.stringify({runId,rounds,fixtureUnchanged:true},null,2)); console.log(JSON.stringify({runId,rounds}));
  } else {
    const client = createHostClient(manifest.endpoint, { clientId: `${runId}-verify`, clientType: 'cli', appVersion: '0.15.4', connectTimeoutMs: 5000, reconnect: { enabled: false }, localCredential: async () => (await readFile(join(paseoHome, 'local-credential'), 'utf8')).trim() });
    const api = createPaseoApi(client);
    try {
      await client.connect();
      const agentsBefore = await api.agents.list(); const workspacesBefore = await api.workspaces.list();
      const bridge = new BridgeSession({ invoke: (method, params) => client.invokePluginRpc('orchiva-plugin', method, params), close: () => client.close() }, manifest);
      const call = (id, method, params = {}) => bridge.handle(JSON.stringify({ protocolVersion: 1, id, method, params }));
      const handshake = await call('hello','handshake'); assert.ok(handshake.result, JSON.stringify(handshake));
      const project = await call('project','project.read'); assert.equal(project.result.name, 'PoC Sandbox');
      const page = await call('page','request.page', { filter: 'all', limit: 20 }); assert.equal(page.result.total, expectedTotal);
      if (expectedTotal > 0) {
      const detail = await call('detail','request.detail', { token: 'd1-fixture-001' }); assert.equal(detail.result.record.status, 'draft');
      }
      if (manifest.fixtureKind === 'two-drafts-one-completed') {
        const completed = await call('completed','request.detail',{token:'d1-fixture-003'});
        assert.equal(completed.result.record.status,'completed'); assert.equal(completed.result.record.results.length,1); assert.equal(completed.result.record.decisions.length,1);
        const empty = await call('empty','request.page',{filter:'active',limit:20}); assert.equal(empty.result.total,0);
      }
      const denied = await call('deny','request.start'); assert.equal(denied.error.code, 'METHOD_DENIED');
      const agentsAfter = await api.agents.list(); const workspacesAfter = await api.workspaces.list(); assert.equal(workspacesBefore.entries.length,0); assert.equal(workspacesAfter.entries.length,0); const secondOwner = new JsonRequestStore(join(dataHome,'requests')); await assert.rejects(secondOwner.open(), /STORE_OWNED/); await secondOwner.close(); assert.equal(agentsBefore.pageInfo.hasMore, false); assert.equal(agentsAfter.pageInfo.hasMore, false); assert.equal(agentsBefore.entries.length, 0); assert.equal(agentsAfter.entries.length, 0);
      assert.deepEqual(await hashes(join(dataHome, 'requests')), manifest.baseline); assert.deepEqual(await protectedData(), manifest.protectedBaseline);
      const result = { runId, checkedAt: new Date().toISOString(), info: handshake.result, total: page.result.total, agentsBefore: agentsBefore.entries.length, agentsAfter: agentsAfter.entries.length, workspacesBefore:workspacesBefore.entries.length, workspacesAfter:workspacesAfter.entries.length, secondOwnerRejected:true, fixtureUnchanged: true, originalRequestsUnchanged: true, mutationDenied: true };
      await writeFile(join(isolationRoot, `verify-${Date.now()}.json`), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
    } finally { await api.dispose(); await client.close(); }
  }
}
