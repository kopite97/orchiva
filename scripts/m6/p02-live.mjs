import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir, cpus, release } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { saveDraftRpc, preparePlanRpc, startRpc, getRpc, resumeRpc, diagnosticsRpc } from '../../shared/contracts/feature-request.ts';
import { assertSandbox, loadConfig } from '../../server/config/project-config.ts';

const [runId, mode] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use a unique M6 run ID.');
assert.ok(mode === undefined || mode === 'resume', 'Optional mode must be resume.');
const home = homedir(), root = join(home, '.orchiva'), runRoot = join(root, 'm6', runId), output = join(runRoot, 'p02'), requestsPath = join(root, 'requests');
const manifestPath = join(output, 'p02-measurement.json');
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const readRecord = async token => readJson(join(requestsPath, `${token}.json`));
const now = () => new Date().toISOString();
const persist = async manifest => { const temp = `${manifestPath}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(manifest, null, 2)); await rename(temp, manifestPath); };
const upsertSample = sample => { const index = manifest.samples.findIndex(item => item.index === sample.index); if (index < 0) manifest.samples.push(sample); else manifest.samples[index] = sample; };

const config = await loadConfig(); await assertSandbox(config);
const environment = { platform: process.platform, osRelease: release(), arch: process.arch, node: process.version, logicalCpuCount: cpus().length, cpuModel: cpus()[0]?.model ?? null, monotonicClock: 'performance.now' };
const baseline = await readJson(join(runRoot, 'baseline-manifest.json'));
assert.equal(baseline.runId, runId);
const continuing = mode === 'resume';
let manifest, recovery = null, preparedRetryStartToken = null, preparedRetryResumeToken = null;
if (continuing) {
  manifest = await readJson(manifestPath);
  if (/^blocked-at-\d+$/.test(manifest.finalStatus)) {
    const previous = manifest.samples.at(-1);
    assert.equal(previous?.blocked, 'timeout'); assert.ok(previous?.token && previous.agentId && previous.workspaceId);
    const record = await readRecord(previous.token), start = record.commands.find(item => item.key === `${previous.token}-start`);
    assert.equal(start?.status, 'applied', 'Existing start intent must be confirmed before continuation.');
    assert.equal(record.attempt, 1);
    assert.ok(!record.commands.some(item => item.key === `${previous.token}-resume`), 'A resume command already exists; reconcile it instead of continuing.');
    recovery = { kind: 'result-timeout', index: previous.index, token: previous.token };
    manifest.continuations ??= [];
    manifest.continuations.push({ at: now(), type: recovery.kind, sample: previous.index, requestStatusAtResume: record.status, previousStopReason: manifest.error ?? 'timeout' });
  } else if (manifest.finalStatus === 'failed' && /EPERM.*rename/.test(manifest.error ?? '')) {
    const lastSample = manifest.samples.at(-1), resumeWasCheckpointed = lastSample?.resumeStage === 'pending', index = resumeWasCheckpointed ? lastSample.index : manifest.samples.length + 1;
    const suffix = String(index).padStart(2, '0'), token = `${runId}-p02-${suffix}`, requestPath = join(requestsPath, `${token}.json`), record = await readRecord(token);
    assert.equal(lastSample?.index, resumeWasCheckpointed ? index : index - 1, 'The failed operation must immediately follow the last measured sample.');
    const tempNames = await readdir(requestsPath), matchingTemps = tempNames.filter(name => name.startsWith(`${token}.json.`) && name.endsWith('.tmp'));
    assert.equal(matchingTemps.length, 1, 'Expected exactly one preserved temp file from the failed pre-effect rename.');
    const tempPath = join(requestsPath, matchingTemps[0]), tempBytes = await readFile(tempPath), tempRecord = JSON.parse(tempBytes.toString('utf8'));
    if (record.status === 'ready' && record.attempt === 1 && record.agentId == null && record.workspaceId == null) {
      assert.deepEqual(record.commands.map(item => [item.key, item.status, item.phase]), [[`${token}-save`, 'applied', 'done'], [`${token}-plan`, 'applied', 'done']]);
      const pendingStart = tempRecord.commands.find(item => item.key === `${token}-start`);
      assert.equal(tempRecord.status, 'planned'); assert.equal(pendingStart?.status, 'pending'); assert.equal(pendingStart?.phase, 'accepted');
      assert.ok(tempRecord.agentId == null); assert.ok(tempRecord.workspaceId == null);
      preparedRetryStartToken = token; recovery = { kind: 'pre-effect-start-rename', index, token };
    } else {
      assert.equal(record.status, 'awaiting-review'); assert.equal(record.attempt, 1); assert.ok(record.result?.id); assert.ok(record.agentId && record.workspaceId);
      assert.ok(record.commands.some(item => item.key === `${token}-start` && item.status === 'applied'));
      assert.ok(!record.commands.some(item => item.key === `${token}-resume`));
      const pendingResume = tempRecord.commands.find(item => item.key === `${token}-resume`);
      assert.equal(tempRecord.status, 'running'); assert.equal(tempRecord.attempt, 2); assert.equal(tempRecord.result, null);
      assert.equal(pendingResume?.status, 'pending'); assert.equal(pendingResume?.phase, 'message');
      assert.equal(tempRecord.recovery?.key, `${token}-resume`); assert.equal(tempRecord.recovery?.pending, true);
      assert.equal(pendingResume?.messageId, `orchiva-${token}-2`); assert.equal(pendingResume?.resourceIds?.agentId, record.agentId);
      preparedRetryResumeToken = token; recovery = { kind: 'pre-send-resume-rename', index, token };
    }
    manifest.continuations ??= [];
    const safeRetryEvidence = recovery.kind === 'pre-effect-start-rename'
      ? 'The durable record is still ready with only save/plan applied; the sole pending accepted-start state is confined to the leftover temp file and contains no Agent or Workspace IDs.'
      : 'The durable record is still awaiting review at attempt 1 with no resume command; the pending attempt-2 message checkpoint is confined to the leftover temp file. TrackExecution calls runtime.resume only after this first save succeeds.';
    manifest.continuations.push({ at: now(), type: recovery.kind, sample: index, previousStopReason: manifest.error, durableRequestSha256: createHash('sha256').update(await readFile(requestPath)).digest('hex'), preservedTempFile: matchingTemps[0], preservedTempSha256: createHash('sha256').update(tempBytes).digest('hex'), safeRetryEvidence, startMeasurementAvailable: recovery.kind !== 'pre-send-resume-rename' || Number.isFinite(lastSample?.startRpcMs) });
  } else {
    throw new Error(`P02 continuation is not safe for saved state ${manifest.finalStatus}: ${manifest.error ?? 'no reason saved'}`);
  }
  manifest.finalStatus = 'running'; delete manifest.error;
} else {
  await mkdir(output, { recursive: false });
  manifest = { runId, startedAt: now(), count: 30, model: config.provider, SDK: '0.15.4', environment, executionPolicy: 'sequential; one active request; 30 new agents/workspaces maximum', samples: [], finalStatus: 'running' };
}
manifest.environment ??= environment;
const client = createHostClient('127.0.0.1:6767', { clientId: `${runId}-p02`, clientType: 'cli', appVersion: '0.15.4', localCredential: async () => (await readFile(join(home, '.paseo-orchiva', 'local-credential'), 'utf8')).trim(), reconnect: { enabled: false } });
const api = createPaseoApi(client);
const invoke = async (rpc, input) => client.invokePluginRpc('orchiva-plugin', rpc.name, input);
const waitForIntent = (token, commandKey, expectedPhase) => {
  const started = performance.now(); let value = null, closed = false, checking = false;
  const inspect = async () => {
    if (closed || checking || value) return; checking = true;
    try {
      const record = await readRecord(token), command = record.commands.find(item => item.key === commandKey);
      if (command?.status === 'pending' && command.phase === expectedPhase) value = { ms: performance.now() - started, observedAt: now(), phase: command.phase };
    } catch { /* Atomic rename may be between polls; retry on the next interval. */ }
    finally { checking = false; }
  };
  const interval = setInterval(() => void inspect(), 10); interval.unref?.();
  return { value: () => value, close: () => { closed = true; clearInterval(interval); }, inspect };
};
const awaitResult = async (token, expectedAttempt, previousResultId, timeoutMs = 600000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await invoke(getRpc, { token });
    if (record.commands.some(item => item.status === 'unknown' || item.status === 'pending') && record.status === 'needs-input') return { record, blocked: 'unknown-or-pending-command' };
    if (record.attempt === expectedAttempt && record.result && record.result.id !== previousResultId && ['awaiting-review', 'failed', 'completed'].includes(record.status)) return { record, blocked: null };
    if (record.status === 'failed' && !record.result) return { record, blocked: record.failure?.kind ?? 'failed-without-result' };
    if (record.status === 'needs-input' && !record.result) return { record, blocked: record.failure?.kind ?? 'needs-input' };
    await delay(500);
  }
  return { record: await invoke(getRpc, { token }), blocked: 'timeout' };
};
const resumeSample = async (index, token, record, startup) => {
  const afterStart = { status: record.status, resultId: record.result.id, checkStatus: record.result.checks?.map(item => item.status) };
  const original = { agentId: record.agentId, workspaceId: record.workspaceId, resultId: record.result.id };
  const key = `${token}-resume`, instruction = `Confirm that ${startup.path} still contains ${startup.marker}. Do not change files, checks, or any other worktree content. Report only the confirmation.`;
  const input = { token, key, instruction, expectedRevision: record.revision, resultId: record.result.id };
  const watcher = waitForIntent(token, key, 'message'), resumeAt = performance.now(), resumeWallStart = Date.now();
  let resumed;
  try { resumed = await invoke(resumeRpc, input); }
  catch (error) {
    const saved = await invoke(getRpc, { token }), command = saved.commands.find(item => item.key === key);
    if (command?.status !== 'applied') return { blocked: `resume-response-or-delivery-unknown:${error instanceof Error ? error.message : String(error)}`, sample: { index, token, ...startup, statusAfterStart: afterStart.status, startResult: original.resultId, resumeRpcMs: performance.now() - resumeAt, agentId: original.agentId, workspaceId: original.workspaceId, status: saved.status, blocked: 'delivery-unconfirmed' } };
    resumed = saved;
  }
  const resumeRpcMs = performance.now() - resumeAt;
  await watcher.inspect(); const resumeIntent = watcher.value(); watcher.close();
  const resumeCommand = resumed.commands.find(item => item.key === key), sdkResponseMs = resumeCommand?.resolvedAt ? Date.parse(resumeCommand.resolvedAt) - resumeWallStart : null;
  if (resumeCommand?.status !== 'applied') return { blocked: 'resume-delivery-not-applied', sample: { index, token, ...startup, statusAfterStart: afterStart.status, startResult: original.resultId, resumeRpcMs, resumeIntent, sdkResponseMs, agentId: original.agentId, workspaceId: original.workspaceId, status: resumed.status } };
  const observed = await awaitResult(token, 2, original.resultId, 600000);
  if (observed.blocked) return { blocked: observed.blocked, sample: { index, token, ...startup, statusAfterStart: afterStart.status, startResult: original.resultId, resumeIntent, sdkResponseMs, resumeRpcMs, agentId: original.agentId, workspaceId: original.workspaceId, status: observed.record.status, attempt: observed.record.attempt } };
  const final = observed.record;
  assert.equal(final.agentId, original.agentId); assert.equal(final.workspaceId, original.workspaceId); assert.equal(final.attempt, 2);
  return { blocked: null, sample: { index, token, statusAfterStart: afterStart.status, checkStatusAfterStart: afterStart.checkStatus, preflightMs: startup.preflightMs, startRpcMs: startup.startRpcMs, startIntent: startup.startIntent, startResult: original.resultId, resumeIntent, sdkResponseMs, resumeRpcMs, finalStatus: final.status, attempt: final.attempt, resultId: final.result?.id, agentId: final.agentId, workspaceId: final.workspaceId, checkStatusAfterResume: final.result?.checks?.map(item => item.status) } };
};
const timing = (values, targetMs = 2000, requiredCount = 30) => {
  const sorted = [...values].sort((a, b) => a - b), rank = p => Math.max(0, Math.ceil(p * sorted.length) - 1);
  return { n: values.length, minMs: Number((sorted[0] ?? 0).toFixed(3)), p50Ms: Number((sorted[rank(.5)] ?? 0).toFixed(3)), p95Ms: Number((sorted[rank(.95)] ?? 0).toFixed(3)), maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)), targetMs, pass: requiredCount === null ? null : values.length === requiredCount && (sorted[rank(.95)] ?? Infinity) <= targetMs };
};

await persist(manifest);
try {
  await client.connect();
  const agents = await api.agents.list(), workspaces = await api.workspaces.list();
  assert.equal(agents.pageInfo.hasMore, false, 'Agent inventory must be complete before M6 effects.');
  assert.equal(workspaces.pageInfo.hasMore, false, 'Workspace inventory must be complete before M6 effects.');
  assert.ok(agents.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(agent.status)), 'Unrelated active turn or permission exists.');
const diagnostics = await invoke(diagnosticsRpc, {});
  assert.equal(diagnostics.issues.length, 0); assert.equal(diagnostics.activeTokens.length, 0, 'Another request occupies the single-task slot.');
  manifest.initialInventory = { agents: agents.entries.length, workspaces: workspaces.entries.length, activeTokens: 0, storageIssues: 0 };
  await persist(manifest);

  if (recovery?.kind === 'result-timeout') {
    const previous = manifest.samples.at(-1);
    const record = await invoke(getRpc, { token: previous.token });
    assert.equal(record.token, previous.token);
    assert.equal(record.agentId, previous.agentId, 'Timed-out sample changed Agent identity.');
    assert.equal(record.workspaceId, previous.workspaceId, 'Timed-out sample changed Workspace identity.');
    assert.equal(record.attempt, 1);
    assert.equal(record.status, 'awaiting-review', 'Continue only after the original start has produced a reviewable result.');
    assert.ok(record.result?.id, 'The original start result is not durable yet.');
    const startup = { path: `${runId}-p02-05.txt`, marker: 'ORCHIVA_M6_P02_05_OK', preflightMs: previous.preflightMs, startRpcMs: previous.startRpcMs, startIntent: previous.startIntent };
    const continued = await resumeSample(previous.index, previous.token, record, startup);
    if (continued.blocked) {
      manifest.samples[manifest.samples.length - 1] = { ...previous, ...continued.sample, blocked: continued.blocked };
      manifest.finalStatus = `blocked-after-resume-at-${previous.index}`; manifest.endedAt = now(); await persist(manifest);
      throw new Error(`M6 P02 could not confirm the one resume for sample ${previous.index}; do not resend it.`);
    }
    manifest.samples[manifest.samples.length - 1] = continued.sample;
    await persist(manifest);
    console.log(JSON.stringify({ p02: 'continued-sample', index: previous.index, resumeRpcMs: Number(continued.sample.resumeRpcMs.toFixed(3)), status: continued.sample.finalStatus, attempt: continued.sample.attempt }));
  }
  if (recovery?.kind === 'pre-send-resume-rename') {
    const record = await invoke(getRpc, { token: recovery.token });
    assert.equal(record.status, 'awaiting-review'); assert.equal(record.attempt, 1); assert.ok(record.result?.id);
    assert.ok(record.commands.some(item => item.key === `${recovery.token}-start` && item.status === 'applied'));
    assert.ok(!record.commands.some(item => item.key === `${recovery.token}-resume`));
    if (manifest.samples.at(-1)?.index !== recovery.index) {
      manifest.samples.push({ index: recovery.index, token: recovery.token, statusAfterStart: record.status, checkStatusAfterStart: record.result.checks?.map(item => item.status), preflightMs: null, startRpcMs: null, startIntent: null, startResult: record.result.id, resumeStage: 'pending', resumeUnavailableBeforeRerun: true, agentId: record.agentId, workspaceId: record.workspaceId });
    } else {
      assert.equal(manifest.samples.at(-1)?.token, recovery.token);
      assert.equal(manifest.samples.at(-1)?.startResult, record.result.id);
    }
    await persist(manifest);
  }

  for (let index = continuing ? recovery.index : 1; index <= 30; index++) {
    const suffix = String(index).padStart(2, '0'), token = `${runId}-p02-${suffix}`, title = `M6 P02 sample ${suffix}`, path = `${runId}-p02-${suffix}.txt`, marker = `ORCHIVA_M6_P02_${suffix}_OK`, checkId = `m6-p02-${suffix}`;
    const feature = { title, goal: `Create ${path} containing exactly ${marker}, then report the result.`, scope: `One new marker file named ${path}.`, constraints: 'Only work in the registered PoC sandbox worktree. Do not access other repositories, edit the Plugin source, install dependencies, use network, commit, push, or merge.', validation: `The independent file-contains check reads ${path}.`, completionCriteria: `The file ${path} contains ${marker}.` };
    let record, preflightMs = null, plan;
    if (token === preparedRetryStartToken) {
      record = await invoke(getRpc, { token });
      assert.equal(record.status, 'ready'); assert.equal(record.attempt, 1); assert.ok(record.agentId == null && record.workspaceId == null);
      assert.deepEqual(record.commands.map(item => [item.key, item.status, item.phase]), [[`${token}-save`, 'applied', 'done'], [`${token}-plan`, 'applied', 'done']]);
      plan = record.plans.at(-1);
    } else if (token === preparedRetryResumeToken) {
      record = await invoke(getRpc, { token });
      assert.equal(record.status, 'awaiting-review'); assert.equal(record.attempt, 1); assert.ok(record.result?.id);
      assert.ok(record.commands.some(item => item.key === `${token}-start` && item.status === 'applied'));
      assert.ok(!record.commands.some(item => item.key === `${token}-resume`));
      plan = record.plans.at(-1);
    } else {
      record = await invoke(saveDraftRpc, { token, commandKey: `${token}-save`, expectedRevision: 0, feature, criteria: [{ id: 'marker', text: feature.completionCriteria, checkIds: [checkId], manualMethod: '', legacy: false }], checks: [{ id: checkId, kind: 'file-contains', path, text: marker, label: `M6 P02 marker ${suffix}` }] });
      const prepareAt = performance.now();
      record = await invoke(preparePlanRpc, { token, commandKey: `${token}-plan`, expectedRevision: record.revision });
      preflightMs = performance.now() - prepareAt; plan = record.plans.at(-1);
    }
    let startRpcMs = null, startIntent = null, observed;
    if (token === preparedRetryResumeToken) {
      observed = { record, blocked: null };
    } else {
      const startKey = `${token}-start`, startInput = { token, commandKey: startKey, expectedRevision: record.revision, planRevision: plan.revision, inputHash: plan.inputHash };
      const startWatch = waitForIntent(token, startKey, 'accepted'), startAt = performance.now();
      const accepted = await invoke(startRpc, startInput); startRpcMs = performance.now() - startAt;
      await startWatch.inspect(); startIntent = startWatch.value(); startWatch.close();
      assert.ok(['planned', 'started', 'running', 'awaiting-review', 'failed'].includes(accepted.status), `Unexpected start status: ${accepted.status}`);
      observed = await awaitResult(token, 1, null);
    }
    if (observed.blocked) {
      record = observed.record; upsertSample({ index, token, startRpcMs, preflightMs, startIntent, status: record.status, blocked: observed.blocked, agentId: record.agentId, workspaceId: record.workspaceId });
      manifest.finalStatus = `blocked-at-${index}`; manifest.endedAt = now(); await persist(manifest);
      throw new Error(`M6 P02 stopped at sample ${index}; preserve this token and inspect its status before any new start.`);
    }
    record = observed.record;
    const afterStart = { status: record.status, resultId: record.result.id, checkStatus: record.result.checks?.map(item => item.status) };
    const original = { agentId: record.agentId, workspaceId: record.workspaceId, resultId: record.result.id, attempt: record.attempt };
    const previousPartial = manifest.samples.find(sample => sample.index === index);
    if (token === preparedRetryResumeToken && previousPartial) {
      preflightMs = previousPartial.preflightMs ?? null; startRpcMs = previousPartial.startRpcMs ?? null; startIntent = previousPartial.startIntent ?? null;
    }
    const partial = { index, token, statusAfterStart: afterStart.status, checkStatusAfterStart: afterStart.checkStatus, preflightMs, startRpcMs, startIntent, startResult: original.resultId, resumeStage: 'pending', agentId: original.agentId, workspaceId: original.workspaceId };
    upsertSample({ ...previousPartial, ...partial });
    await persist(manifest);
    const resumeKey = `${token}-resume`, resumeInput = { token, key: resumeKey, instruction: `Confirm that ${path} still contains ${marker}. Do not change files, checks, or any other worktree content. Report only the confirmation.`, expectedRevision: record.revision, resultId: record.result.id };
    const resumeWatch = waitForIntent(token, resumeKey, 'message'), resumeAt = performance.now(), resumeWallStart = Date.now();
    const resumed = await invoke(resumeRpc, resumeInput), resumeRpcMs = performance.now() - resumeAt;
    await resumeWatch.inspect(); const resumeIntent = resumeWatch.value(); resumeWatch.close();
    const resumeCommand = resumed.commands.find(item => item.key === resumeKey);
    const sdkResponseMs = resumeCommand?.resolvedAt ? Date.parse(resumeCommand.resolvedAt) - resumeWallStart : null;
    if (resumeCommand?.status !== 'applied') {
      upsertSample({ ...partial, status: resumed.status, blocked: 'resume-delivery-not-applied', resumeRpcMs, resumeIntent, sdkResponseMs });
      manifest.finalStatus = `blocked-resume-at-${index}`; manifest.endedAt = now(); await persist(manifest);
      throw new Error(`M6 P02 resume for sample ${index} was not confirmed applied; do not resend it.`);
    }
    observed = await awaitResult(token, 2, original.resultId);
    if (observed.blocked) {
      upsertSample({ ...partial, status: observed.record.status, blocked: observed.blocked, resumeRpcMs, resumeIntent, sdkResponseMs });
      manifest.finalStatus = `blocked-after-resume-at-${index}`; manifest.endedAt = now(); await persist(manifest);
      throw new Error(`M6 P02 stopped after resume for sample ${index}; preserve the result before continuing.`);
    }
    record = observed.record;
    assert.equal(record.agentId, original.agentId); assert.equal(record.workspaceId, original.workspaceId); assert.equal(record.attempt, 2);
    const sample = { index, token, statusAfterStart: afterStart.status, checkStatusAfterStart: afterStart.checkStatus, preflightMs, startRpcMs, ...(token === preparedRetryResumeToken && startRpcMs === null ? { startMeasurementUnavailable: 'The earlier P02 process exited during resume before it persisted the start RPC duration.' } : {}), startIntent, startResult: original.resultId, resumeIntent, sdkResponseMs, resumeRpcMs, finalStatus: record.status, attempt: record.attempt, resultId: record.result?.id, agentId: record.agentId, workspaceId: record.workspaceId, checkStatusAfterResume: record.result?.checks?.map(item => item.status) };
    upsertSample(sample); await persist(manifest);
    console.log(JSON.stringify({ p02: 'sample', index, startRpcMs: startRpcMs === null ? null : Number(startRpcMs.toFixed(3)), resumeRpcMs: Number(resumeRpcMs.toFixed(3)), status: record.status, attempt: record.attempt }));
    if (index < 30) {
      const state = await invoke(diagnosticsRpc, {}); assert.equal(state.activeTokens.length, 0, `Request ${token} still holds the single-task slot.`);
    }
  }
  manifest.finalStatus = 'completed'; manifest.endedAt = now();
  manifest.stats = { preflight: timing(manifest.samples.map(x => x.preflightMs).filter(Number.isFinite), null, null), startAcceptanceRpc: timing(manifest.samples.map(x => x.startRpcMs).filter(Number.isFinite)), startDurableIntentObservation: timing(manifest.samples.map(x => x.startIntent?.ms).filter(Number.isFinite)), resumeDurableIntentObservation: timing(manifest.samples.map(x => x.resumeIntent?.ms).filter(Number.isFinite)), resumeSdkResponseProjection: timing(manifest.samples.map(x => x.sdkResponseMs).filter(Number.isFinite)), resumeRpc: timing(manifest.samples.map(x => x.resumeRpcMs).filter(Number.isFinite)) };
  await persist(manifest);
  console.log(JSON.stringify({ file: manifestPath, finalStatus: manifest.finalStatus, samples: manifest.samples.length, stats: manifest.stats, newAgents: new Set(manifest.samples.map(x => x.agentId)).size, newWorkspaces: new Set(manifest.samples.map(x => x.workspaceId)).size }, null, 2));
} catch (error) {
  manifest.finalStatus = manifest.finalStatus === 'running' ? 'failed' : manifest.finalStatus; manifest.endedAt = now(); manifest.error = error instanceof Error ? error.message : String(error); await persist(manifest).catch(() => undefined); throw error;
} finally {
  try { await api.dispose(); } finally { await client.close(); }
}
