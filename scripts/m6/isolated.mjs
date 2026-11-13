import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { JsonRequestStore } from '../../server/adapters/storage/json-request-store.ts';
import { DraftRequest } from '../../server/application/draft-request.ts';
import { StartFeatureRequest } from '../../server/application/start-feature-request.ts';
import { TrackExecution } from '../../server/application/track-execution.ts';
import { RecoverRequest } from '../../server/application/recover-request.ts';
import { RequestLocks } from '../../server/application/request-locks.ts';
import { assertSlot } from '../../server/application/execution-slot.ts';
import { createRequest } from '../../server/domain/request.ts';
import { legacyRecordSchema } from '../../shared/contracts/feature-request.ts';
import { collectFiles } from '../../server/adapters/storage/evidence.ts';
import { project, commit } from '../../server/tests/helpers/prepared.ts';

const args = process.argv.slice(2), worker = args[0] === '--worker';
const sha = x => createHash('sha256').update(x).digest('hex');
const readJson = async p => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
const feature = { title: 'M6 isolated fault', goal: 'Preserve durable identities across owned writer termination.', scope: 'Only this isolated fixture.', constraints: 'No real model or remote effects.', validation: 'Effect ledger and request identity.', completionCriteria: 'No duplicate effect or lost result.' };
const result = (id, attempt) => ({ id, sourceKey: `turn-${attempt}`, collectedAt: new Date().toISOString(), finalResponse: 'Fixture result.', agentStatus: 'idle', changedFiles: [], diffStat: '', fingerprint: 'fp', checks: [], failure: null, executionFailure: null });
const stopAt = async (stage, boundary) => { if (stage !== boundary) return; setInterval(() => {}, 1000); process.send?.({ boundary }); await new Promise(() => {}); };
function runtimeFor(dir, boundary = '') {
  const ledgerPath = join(dir, 'effects.json');
  const effects = async () => readJson(ledgerPath).catch(() => ({ workspace: 0, agent: 0, message: 0 }));
  const effect = async kind => { await stopAt(`${kind}-before`, boundary); const x = await effects(); x[kind]++; await writeFile(ledgerPath, JSON.stringify(x)); return x[kind]; };
  return {
    projectSnapshot: project, validate: async () => {}, preflight: async () => ({ projectSnapshot: project, baseCommit: commit }),
    createWorkspace: async () => { await effect('workspace'); return { id: 'fixture-workspace', directory: dir }; }, writePlans: async () => {}, startAgent: async () => { await effect('agent'); return 'fixture-agent'; }, verifyResources: async () => {},
    observe: async r => ({ status: 'ended', agentStatus: 'idle', sourceKey: `turn-${r.attempt}`, finalResponse: 'Fixture result.', failure: null, seenRecovery: (await effects()).message > 0 }),
    collect: async r => result(`result-${r.attempt}`, r.attempt), fingerprint: async () => 'fp', resume: async () => { await effect('message'); },
    lookupDelivery: async (r, command) => {
      const x = await effects(), kind = command.kind === 'resume' ? 'message' : command.phase === 'workspace' ? 'workspace' : 'agent';
      if (!x[kind]) return { kind: 'absent' };
      return { kind: 'found', value: { id: kind === 'message' ? command.messageId : `fixture-${kind}`, ...(kind === 'workspace' ? { directory: dir } : {}) } };
    }
  };
}

if (worker) {
  const [, mode, dir, boundary] = args;
  const store = new JsonRequestStore(join(dir, 'requests'), mode === 'migration' ? { [boundary]: async () => { process.send?.({ boundary }); await new Promise(() => {}); } } : {});
  try { await store.open(); } catch (error) { process.send?.({ error: String(error) }); process.exit(7); }
  if (mode === 'owner') { setInterval(() => {}, 1000); process.send?.({ boundary: 'owner-ready' }); await new Promise(() => {}); }
  if (mode === 'migration') { await store.list(); throw Error('Migration boundary not reached.'); }
  const baseSave = store.save.bind(store);
  store.save = async r => {
    const command = r.commands.at(-1);
    if (r.status === 'planned') await stopAt('accept-before', boundary);
    if (command?.phase === 'plans' && r.workspaceId) await stopAt('workspace-checkpoint', boundary);
    if (r.status === 'started' && r.agentId) await stopAt('agent-checkpoint', boundary);
    if (command?.kind === 'resume' && command.status === 'applied') await stopAt('message-checkpoint', boundary);
    await baseSave(r);
    if (r.status === 'planned') await stopAt('accept-after', boundary);
    if (command?.phase === 'plans' && r.workspaceId) await stopAt('plans-after', boundary);
    if (r.status === 'started') await stopAt('applied-after', boundary);
  };
  const starter = new StartFeatureRequest(store), runtime = runtimeFor(dir, boundary);
  const input = await readJson(join(dir, 'input.json'));
  if (mode === 'resume') await new TrackExecution(store, starter.locks).resume(input, runtime); else await starter.start(input, runtime);
  throw Error('Expected child fault boundary was not reached.');
}

const [runId, evidenceDirectory = 'isolated'] = args; assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/); assert.match(evidenceDirectory, /^isolated(?:-[0-9]+)?$/);
const root = join(homedir(), '.orchiva/m6', runId, evidenceDirectory); await mkdir(root, { recursive: false });
const manifest = { runId, startedAt: new Date().toISOString(), status: 'running', simulatedEffects: true, boundaries: [], migrations: [], ownership: null, evidenceCases: [] };
const persist = () => writeFile(join(root, 'isolated.json'), JSON.stringify(manifest, null, 2)); await persist();
async function killedWorker(mode, dir, boundary) {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve(import.meta.filename), '--worker', mode, dir, boundary], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', x => { stderr += x; }); const exited = once(child, 'exit');
  const message = await Promise.race([once(child, 'message').then(x => x[0]), exited.then(() => { throw Error(`Owned child exited early: ${stderr}`); }), delay(15000).then(() => { throw Error('Owned boundary timeout.'); })]);
  assert.equal(message.boundary, boundary, JSON.stringify(message)); const pid = child.pid; child.kill(); const exit = await exited; return { pid, boundary, exit };
}
async function setup(dir, resume) {
  await mkdir(dir); const store = new JsonRequestStore(join(dir, 'requests')); await store.open(); const runtime = runtimeFor(dir), token = `m6-${resume ? 'resume' : 'start'}-${dir.split(/[\\/]/).at(-1)}`;
  let r = await new DraftRequest(store).save({ token, commandKey: `${token}-save`, expectedRevision: 0, feature, criteria: [{ id: 'criterion', text: feature.completionCriteria, checkIds: [], manualMethod: 'Inspect fixture ledger.', legacy: false }], checks: [] });
  r = await new DraftRequest(store).prepare({ token, commandKey: `${token}-plan`, expectedRevision: r.revision }, runtime);
  let input = { token, commandKey: `${token}-start`, expectedRevision: r.revision, planRevision: r.plans[0].revision, inputHash: r.plans[0].inputHash };
  if (resume) { r = await new StartFeatureRequest(store).start(input, runtime); r.status = 'awaiting-review'; r.result = result('result-1', 1); await store.save(r); input = { token, key: `${token}-resume`, expectedRevision: r.revision, resultId: r.result.id, instruction: 'Fixture no-op resume.' }; }
  await writeFile(join(dir, 'input.json'), JSON.stringify(input)); await store.close(); return input;
}
try {
  for (const boundary of ['accept-before', 'accept-after', 'plans-after', 'workspace-before', 'workspace-checkpoint', 'agent-before', 'agent-checkpoint', 'applied-after', 'message-before', 'message-checkpoint']) {
    const dir = join(root, boundary), resume = boundary.startsWith('message'), input = await setup(dir, resume), crash = await killedWorker(resume ? 'resume' : 'start', dir, boundary);
    const store = new JsonRequestStore(join(dir, 'requests')); await store.open(); const runtime = runtimeFor(dir), starter = new StartFeatureRequest(store), tracker = new TrackExecution(store, starter.locks), recovery = new RecoverRequest(store, starter.locks);
    let r = await store.get(input.token); const atCrash = structuredClone(r), ledgerAtCrash = await readJson(join(dir, 'effects.json')).catch(() => ({ workspace: 0, agent: 0, message: 0 }));
    if (boundary === 'accept-before') r = await starter.start(input, runtime);
    else if (['accept-after', 'plans-after'].includes(boundary)) r = await starter.advance(r.token, runtime);
    else if (boundary !== 'applied-after') {
      if (!resume) r = await starter.advance(r.token, runtime); else r = await tracker.refresh(r.token, runtime);
      const command = r.commands.find(x => x.kind === (resume ? 'resume' : 'start'));
      if (command.status === 'unknown') r = await recovery.reconcile({ token: r.token, commandKey: `${r.token}-reconcile`, expectedRevision: r.revision, targetCommandKey: command.key }, runtime);
      if (r.commands.some(x => x.kind === 'start' && x.status === 'pending')) r = await starter.advance(r.token, runtime);
    }
    const absent = boundary.endsWith('-before') && boundary !== 'accept-before';
    if (absent) { assert.equal(r.status, 'needs-input'); await assert.rejects(assertSlot(store, 'm6-unrelated-request'), /BUSY/); }
    else {
      if (resume) r = await tracker.refresh(r.token, runtime);
      assert.ok(['started', 'awaiting-review'].includes(r.status));
      const beforeReplay = await readFile(join(dir, 'requests', `${r.token}.json`));
      if (resume) await tracker.resume(input, runtime); else await starter.start(input, runtime);
      assert.deepEqual(await readFile(join(dir, 'requests', `${r.token}.json`)), beforeReplay);
    }
    const effects = await readJson(join(dir, 'effects.json')).catch(() => ({ workspace: 0, agent: 0, message: 0 }));
    assert.ok(Object.values(effects).every(x => x <= 1)); if (resume) assert.deepEqual(r.results[0], atCrash.results[0]);
    manifest.boundaries.push({ boundary, crash, atCrash: { status: atCrash.status, commands: atCrash.commands }, ledgerAtCrash, final: { status: r.status, attempt: r.attempt, resultIds: r.results.map(x => x.id), commands: r.commands }, effects, pass: true }); await store.close(); await persist();
  }

  const source = join(homedir(), '.orchiva/requests/backups/v1'), originals = (await readdir(source)).filter(x => x.endsWith('.json')).slice(0, 4); assert.equal(originals.length, 4);
  for (const boundary of ['afterBackup', 'beforeRename']) {
    const dir = join(root, `migration-${boundary}`); await mkdir(join(dir, 'requests'), { recursive: true }); const hashes = [];
    for (const f of originals) { const raw = await readFile(join(source, f)), r = JSON.parse(raw); await writeFile(join(dir, 'requests', `${r.token}.json`), raw); hashes.push({ source: f, token: r.token, sha256: sha(raw) }); }
    await writeFile(join(dir, 'requests/m6-corrupt-001.json'), '{broken'); await writeFile(join(dir, 'requests/m6-future-001.json'), '{"schemaVersion":99}');
    const crash = await killedWorker('migration', dir, boundary), store = new JsonRequestStore(join(dir, 'requests')); await store.open(); const records = await store.list(), diagnostics = await store.diagnostics(); assert.equal(records.length, 4); assert.equal(diagnostics.issues.length, 2); await assert.rejects(assertSlot(store, 'm6-new-request-001'), /STORAGE_UNHEALTHY/);
    for (const h of hashes) { assert.equal(sha(await readFile(join(source, h.source))), h.sha256); const backup = (await readdir(join(dir, 'requests/backups/v1'))).find(x => x.startsWith(`${h.token}-`)); assert.equal(sha(await readFile(join(dir, 'requests/backups/v1', backup))), h.sha256); }
    manifest.migrations.push({ boundary, crash, sourceHashes: hashes, validRecords: records.length, diagnostics, pass: true }); await store.close(); await persist();
  }

  const ownerDir = join(root, 'ownership'); await mkdir(ownerDir); const seedStore = new JsonRequestStore(join(ownerDir, 'requests')); await seedStore.open(); const unknown = createRequest('m6-owner-unknown-001', feature); unknown.status = 'needs-input'; unknown.commands.push({ key: 'unknown-command', kind: 'start', payloadHash: 'hash', status: 'unknown', phase: 'agent', messageId: null, resourceIds: {}, outcomeRef: null, createdAt: new Date().toISOString(), resolvedAt: null }); await seedStore.save(unknown); await seedStore.close();
  const owner = spawn(process.execPath, ['--import', 'tsx', resolve(import.meta.filename), '--worker', 'owner', ownerDir, 'owner-ready'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); const ownerExit = once(owner, 'exit'); await once(owner, 'message');
  const second = new JsonRequestStore(join(ownerDir, 'requests')); await assert.rejects(second.open(), /owned|STORE_OWNED|owner|writer/i); owner.kill(); await ownerExit;
  const replacement = new JsonRequestStore(join(ownerDir, 'requests')); await replacement.open(); await assert.rejects(assertSlot(replacement, 'm6-new-slot-001'), /BUSY/); const ownerBytes = await readFile(join(ownerDir, 'requests', `${unknown.token}.json`)); await delay(1200); await assert.rejects(assertSlot(replacement, 'm6-new-slot-001'), /BUSY/); assert.deepEqual(await readFile(join(ownerDir, 'requests', `${unknown.token}.json`)), ownerBytes); await replacement.close(); manifest.ownership = { killedPid: owner.pid, secondWriterRejected: true, replacementAcquired: true, unknownSlotPreserved: true, pass: true }; await persist();

  const fixtureRepo = async name => { const dir = join(root, `validation-${name}`); await mkdir(dir); const git = (...a) => execFileSync('git', ['-C', dir, ...a], { windowsHide: true, stdio: 'pipe' }); git('init'); await writeFile(join(dir, 'base.txt'), 'base'); git('add', '.'); git('-c', 'user.name=Orchiva M6', '-c', 'user.email=m6@localhost', 'commit', '-m', 'isolated M6 fixture'); const r = createRequest(`m6-validation-${name}`, feature, [{ id: 'test', kind: 'node-test', path: 'fixture.test.mjs', label: name }]); r.worktreePath = dir; return { dir, r }; };
  const observation = { status: 'ended', agentStatus: 'idle', sourceKey: 'fixture', finalResponse: 'Validation fixture', failure: null, seenRecovery: false };
  for (const [name, content, options, expected] of [
    ['assertion', "import assert from 'node:assert/strict'; assert.equal(1,2);", {}, 'failed'],
    ['syntax', 'invalid javascript !!!!', {}, 'error'],
    ['missing', null, {}, 'error'],
    ['timeout', 'while(true){}', { checkTimeoutMs: 70 }, 'error'],
    ['budget', 'console.log(1)', { budgetMs: 0 }, 'skipped'],
    ['output', "console.log('x'.repeat(20000));", {}, 'passed']
  ]) { const { dir, r } = await fixtureRepo(name); if (content !== null) await writeFile(join(dir, 'fixture.test.mjs'), content); const found = await collectFiles(r, observation, options); assert.equal(found.checks[0].status, expected); if (name === 'timeout') assert.equal(found.checks[0].failureKind, 'timeout'); if (name === 'output') assert.equal(found.checks[0].truncated, true); await writeFile(join(dir, 'result.json'), JSON.stringify(found, null, 2)); manifest.evidenceCases.push({ name, status: found.checks[0].status, failureKind: found.checks[0].failureKind, durationMs: found.checks[0].durationMs, exitCode: found.checks[0].exitCode, pass: true }); }
  for (const name of ['large', 'count']) { const { dir, r } = await fixtureRepo(name); await writeFile(join(dir, 'fixture.test.mjs'), 'console.log(1)'); if (name === 'large') await writeFile(join(dir, 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 1)); else for (let i = 0; i < 301; i++) await writeFile(join(dir, `file-${i}.txt`), 'x'); await assert.rejects(collectFiles(r, observation), name === 'large' ? /2 MiB/ : /300 files/); manifest.evidenceCases.push({ name, collectionRejected: true, pass: true }); }
  const denyDir = join(root, 'write-denied'); await mkdir(denyDir); const denied = new JsonRequestStore(denyDir); await denied.open(); const deniedRecord = createRequest('m6-write-denied-001', feature); deniedRecord.status = 'draft'; await denied.save(deniedRecord); const target = join(denyDir, `${deniedRecord.token}.json`), old = await readFile(target); execFileSync('attrib.exe', ['+R', target], { windowsHide: true });
  try { deniedRecord.feature.title = 'Denied replacement'; await assert.rejects(denied.save(deniedRecord), /EPERM|EACCES|EBUSY/); assert.deepEqual(await readFile(target), old); manifest.writeDenied = { actualReadOnlyFile: true, oldBytesPreserved: true, tempFiles: (await readdir(denyDir)).filter(x => x.endsWith('.tmp')), pass: true }; } finally { execFileSync('attrib.exe', ['-R', target], { windowsHide: true }); await denied.close(); }
  manifest.status = 'completed'; manifest.pass = true; manifest.endedAt = new Date().toISOString(); await persist(); console.log(JSON.stringify({ file: join(root, 'isolated.json'), boundaries: manifest.boundaries.length, migrations: manifest.migrations.length, validationCases: manifest.evidenceCases.length, pass: true }));
} catch (error) { manifest.status = 'failed'; manifest.error = String(error); await persist(); throw error; }
