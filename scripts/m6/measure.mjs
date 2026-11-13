import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { JsonRequestStore } from '../../server/adapters/storage/json-request-store.ts';
import { DraftRequest } from '../../server/application/draft-request.ts';
import { createRequest } from '../../server/domain/request.ts';
import { allowedActions, requestPage } from '../../server/domain/request-view.ts';
import { failureView } from '../../server/domain/failure.ts';
import { project } from '../../server/tests/helpers/prepared.ts';

const [runId] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use a unique M6 run ID.');
const root = join(homedir(), '.orchiva', 'm6', runId), baselinePath = join(root, 'baseline-manifest.json'), output = join(root, 'p01');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const now = () => new Date().toISOString();

async function verifyBaseline() {
  const manifest = await readJson(baselinePath), current = join(homedir(), '.orchiva', 'requests'), checked = [];
  for (const item of manifest.requests) {
    const file = join(current, item.file), bytes = await readFile(file), digest = sha(bytes);
    assert.equal(digest, item.sha256, `Existing request changed: ${item.file}`); checked.push({ file: item.file, sha256: digest });
  }
  return { count: checked.length, checked };
}

const text = (size, value) => value.repeat(Math.ceil(size / value.length)).slice(0, size);
const feature = index => ({ title: `M6 SYNTHETIC ${String(index).padStart(3, '0')}`, goal: 'Synthetic performance fixture only.', scope: 'Isolated JSON request store.', constraints: 'No real agent, workspace, or model use.', validation: 'Schema and reference checks.', completionCriteria: 'Synthetic record is retained.' });
const checkResult = (recordIndex, attempt, failed) => {
  const files = Array.from({ length: 10 }, (_, i) => ({ path: `synthetic/${i}.txt`, changeType: 'modified', sha256: createHash('sha256').update(`${recordIndex}/${attempt}/${i}`).digest('hex'), size: 256 + i, deleted: false, isCheckInput: false }));
  return {
    id: `synthetic-result-${recordIndex}-${attempt}`, sourceKey: `synthetic:${recordIndex}:${attempt}`, collectedAt: now(), finalResponse: text(8192, `synthetic response ${recordIndex} `), agentStatus: 'idle', files, changedFiles: files.map(x => x.path), diffStat: '10 synthetic files changed', fingerprint: `${recordIndex}-${attempt}`.padEnd(64, '0'),
    checks: [0, 1].map(i => ({ checkId: `synthetic-check-${i}`, status: failed ? 'failed' : 'passed', failureKind: failed ? 'assertion' : null, inputFingerprint: 'c'.repeat(64), truncated: false, label: `Synthetic check ${i}`, command: 'node --test synthetic.test.mjs', passed: !failed, exitCode: failed ? 1 : 0, output: text(8192, `synthetic check log ${recordIndex}/${attempt}/${i} `), durationMs: 10 + i })),
    failure: failed ? 'Synthetic validation failure.' : null, executionFailure: null,
  };
};

function withHistory(index, status) {
  const record = createRequest(`m6-p01-${String(index).padStart(3, '0')}`, feature(index));
  record.criteria = [{ id: 'synthetic-criterion', text: record.feature.completionCriteria, checkIds: ['synthetic-check-0'], manualMethod: 'Synthetic data only.', legacy: false }];
  if (status === 'draft') { record.status = 'draft'; return record; }
  record.status = status; record.attempt = 3; record.workspaceId = `synthetic-workspace-${index}`; record.agentId = `synthetic-agent-${index}`; record.worktreePath = `C:/synthetic/${index}`;
  const first = checkResult(index, 1, true), second = checkResult(index, 2, true), third = checkResult(index, 3, status === 'failed');
  record.attempts = [{ attempt: 1, result: first, error: 'Synthetic failed result.' }, { attempt: 2, result: second, error: 'Synthetic failed result.' }];
  record.result = third; record.error = status === 'failed' ? third.failure : null;
  if (status === 'completed') record.decision = { resultId: third.id, approved: true, note: 'Synthetic performance fixture approved for payload sizing only.', at: now(), criteriaReviews: [{ criterionId: 'synthetic-criterion', satisfied: true, evidenceRefs: [{ kind: 'check', id: 'synthetic-check-0' }], note: '' }], testChangesAcknowledged: false };
  return record;
}

const summarize = samples => {
  const ordered = samples.map(x => x.ms).sort((a, b) => a - b);
  const at = quantile => ordered[Math.max(0, Math.ceil(quantile * ordered.length) - 1)];
  return { n: samples.length, failures: samples.filter(x => x.error).length, minMs: Number(ordered[0]?.toFixed(3) ?? 0), p50Ms: Number(at(.5)?.toFixed(3) ?? 0), p95Ms: Number(at(.95)?.toFixed(3) ?? 0), maxMs: Number(ordered.at(-1)?.toFixed(3) ?? 0), p95TargetMs: 1000, pass: samples.length === 30 && samples.every(x => !x.error) && at(.95) <= 1000 };
};

async function sample(operation) {
  const started = performance.now();
  try { const value = await operation(); return { ms: performance.now() - started, bytes: Buffer.byteLength(JSON.stringify(value)), error: null }; }
  catch (error) { return { ms: performance.now() - started, bytes: 0, error: error instanceof Error ? error.message : String(error) }; }
}

await verifyBaseline();
await mkdir(join(root), { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error; });
await mkdir(output, { recursive: false });
const requestsDir = join(output, 'requests'); await mkdir(requestsDir, { recursive: false });
const store = new JsonRequestStore(requestsDir); await store.open();
const drafts = new DraftRequest(store), fakeRuntime = { preflight: async () => ({ baseCommit: 'a'.repeat(40), projectSnapshot: { ...project } }) };
try {
  for (let i = 0; i < 100; i++) {
    const status = i < 60 ? 'draft' : i < 80 ? 'failed' : 'completed';
    await store.save(withHistory(i, status));
  }
  const firstPage = () => store.list().then(records => requestPage(records, { filter: 'all', limit: 20 }));
  let nextCursor = (await firstPage()).nextCursor; assert.ok(nextCursor, 'Synthetic list must have a next page.');
  for (let i = 0; i < 5; i++) {
    await sample(async () => { const r = await store.get(`m6-p01-${String(i).padStart(3, '0')}`); assert.ok(r); return drafts.save({ token: r.token, commandKey: `m6-p01-warm-${i}`, expectedRevision: r.revision, feature: { ...r.feature, goal: `${r.feature.goal} warm ${i}` }, criteria: r.criteria, checks: r.checks }); });
    await sample(async () => { const records = await store.list(); return JSON.parse(JSON.stringify(records)); });
    await sample(firstPage);
    await sample(async () => { const records = await store.list(); return requestPage(records, { filter: 'all', cursor: nextCursor, limit: 20 }); });
    await sample(async () => { const record = await store.get('m6-p01-099'); assert.ok(record); return { record, failure: failureView(record), allowedActions: allowedActions(record) }; });
  }
  const saveSamples = [];
  for (let i = 5; i < 35; i++) saveSamples.push(await sample(async () => { const token = `m6-p01-${String(i).padStart(3, '0')}`, r = await store.get(token); assert.ok(r); return drafts.save({ token, commandKey: `m6-p01-save-${i}`, expectedRevision: r.revision, feature: { ...r.feature, goal: `${r.feature.goal} measured ${i}` }, criteria: r.criteria, checks: r.checks }); }));
  const listSamples = [], firstSamples = [], nextSamples = [], detailSamples = [];
  for (let i = 0; i < 30; i++) {
    listSamples.push(await sample(async () => JSON.parse(JSON.stringify(await store.list()))));
    firstSamples.push(await sample(firstPage));
    nextSamples.push(await sample(async () => { const records = await store.list(); return requestPage(records, { filter: 'all', cursor: nextCursor, limit: 20 }); }));
    detailSamples.push(await sample(async () => { const record = await store.get('m6-p01-099'); assert.ok(record); return { record, failure: failureView(record), allowedActions: allowedActions(record) }; }));
  }
  const contention = [];
  for (let pair = 0; pair < 30; pair++) {
    const tokens = [35 + ((pair * 2) % 25), 35 + ((pair * 2 + 1) % 25)], started = performance.now();
    const results = await Promise.all(tokens.map(async (index, side) => {
      const token = `m6-p01-${String(index).padStart(3, '0')}`, r = await store.get(token), one = performance.now(); assert.ok(r);
      try { const saved = await drafts.save({ token, commandKey: `m6-p01-lock-${pair}-${side}`, expectedRevision: r.revision, feature: { ...r.feature, goal: `${r.feature.goal} lock-${pair}-${side}` }, criteria: r.criteria, checks: r.checks }); return { ms: performance.now() - one, error: null, revision: saved.revision }; }
      catch (error) { return { ms: performance.now() - one, error: error instanceof Error ? error.message : String(error) }; }
    }));
    contention.push({ ms: performance.now() - started, errors: results.filter(x => x.error).length });
  }
  const diagnostics = await store.diagnostics(), files = await readdir(requestsDir), bytes = await Promise.all(files.filter(x => x.endsWith('.json')).map(async x => (await stat(join(requestsDir, x))).size));
  const p01 = { runId, synthetic: true, seed: `${runId}-p01-v1`, createdAt: now(), dataset: { records: diagnostics.records, drafts: 60, failed: 20, completed: 20, resultRecords: diagnostics.results, totalJsonBytes: bytes.reduce((a, b) => a + b, 0), meanRecordBytes: Number((bytes.reduce((a, b) => a + b, 0) / bytes.length).toFixed(1)), filesPerResult: 10, resultsPerExecutedRecord: 3, checksPerResult: 2, bytesPerCheckLog: 8192, bytesPerFinalResponse: 8192 }, environment: { platform: process.platform, release: process.release.name, node: process.version, cpus: (await import('node:os')).cpus().length, modelTasks: 0 }, stats: { draftSave: summarize(saveSamples), listAll: summarize(listSamples), firstPage: summarize(firstSamples), nextPage: summarize(nextSamples), detail: summarize(detailSamples), lockContention: { n: contention.length, errors: contention.reduce((sum, x) => sum + x.errors, 0), p95PairMs: Number([...contention].map(x => x.ms).sort((a, b) => a - b)[Math.ceil(.95 * contention.length) - 1].toFixed(3)), maxPairMs: Number(Math.max(...contention.map(x => x.ms)).toFixed(3)), targetMs: 1000 } }, diagnostics: { issues: diagnostics.issues, activeTokens: diagnostics.activeTokens.length }, endedAt: now() };
  await writeFile(join(output, 'p01-measurement.json'), JSON.stringify(p01, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ file: join(output, 'p01-measurement.json'), dataset: p01.dataset, stats: p01.stats, diagnostics: p01.diagnostics }, null, 2));
} finally { await store.close(); }
