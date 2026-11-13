import assert from 'node:assert/strict';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir, cpus, release } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { getRpc, diagnosticsRpc } from '../../shared/contracts/feature-request.ts';

const [runId, tokenArg, outputName = 'p05'] = process.argv.slice(2);
const token = tokenArg || `${runId}-d03`;
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use a unique M6 run ID.');
assert.ok(token.startsWith(`${runId}-`), 'P05 can only observe a request owned by this M6 run.');
assert.match(outputName, /^p05(?:-[a-z0-9-]{1,20})?$/, 'Use a unique P05 evidence directory, e.g. p05-002.');
const durationMs = 30 * 60 * 1000, intervalMs = 10_000;
const home = homedir(), root = join(home, '.orchiva'), runRoot = join(root, 'm6', runId), output = join(runRoot, outputName), manifestPath = join(output, 'p05-soak.json');
const requestPath = join(root, 'requests', `${token}.json`), runtimePath = join(root, 'runtime-status.json'), paseoHome = join(home, '.paseo-orchiva');
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const persist = async manifest => { const temp = `${manifestPath}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(manifest, null, 2)); await rename(temp, manifestPath); };
const credential = async () => (await readFile(join(paseoHome, 'local-credential'), 'utf8')).trim();
const resourcesBeforeConnect = process.getActiveResourcesInfo().sort();
const client = createHostClient('127.0.0.1:6767', { clientId: `${runId}-p05`, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
const api = createPaseoApi(client);

function daemonProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const script = `$ErrorActionPreference = 'Stop'; $orchivaProcess = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $orchivaProcess) { 'null' } else { $orchivaProcess | Select-Object Id, WorkingSet64, PrivateMemorySize64, CPU | ConvertTo-Json -Compress }`;
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return output === 'null' ? null : JSON.parse(output);
  } catch { return null; }
}

const manifest = { runId, evidenceDirectory: outputName, token, startedAt: now(), durationTargetMs: durationMs, sampleIntervalMs: intervalMs, status: 'running', environment: { platform: process.platform, osRelease: release(), arch: process.arch, node: process.version, logicalCpuCount: cpus().length, cpuModel: cpus()[0]?.model ?? null }, resourcesBeforeConnect, samples: [], violations: [], writeEvents: { requestBytesChanged: 0, requestMtimeChanged: 0, runtimeStatusContentChanged: 0 }, assumptions: ['P05 observes one stable request without edits or reload/disconnect. Other owned acceptance requests may execute sequentially; they never modify the target. Reconciler reports activeCycles and maxConcurrentCycles.'] };
await mkdir(output, { recursive: false });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });

let stableDigest, originalRequestSha, originalRuntimePid, previousRuntimeCycles = null, previousRuntimeSha = null, previousRequestMtime = null, previousClientCpu = process.cpuUsage();
let agentRef, initialRecord;
try {
  await client.connect();
  const diagnostics = await client.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
  assert.equal(diagnostics.issues.length, 0); assert.equal(diagnostics.activeTokens.length, 0, 'A task already occupies the single-work slot.');
  const agents = await api.agents.list(); assert.equal(agents.pageInfo.hasMore, false, 'Need complete Agent inventory before the soak.');
  assert.ok(agents.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(agent.status)), 'An unrelated active Agent or permission exists.');
  initialRecord = await client.invokePluginRpc('orchiva-plugin', getRpc.name, { token });
  assert.ok(initialRecord.result?.id); assert.ok(['awaiting-review', 'completed'].includes(initialRecord.status));
  assert.equal(initialRecord.commands.some(item => ['pending', 'unknown'].includes(item.status)), false);
  const targetAgent = agents.entries.find(({ agent }) => agent.id === initialRecord.agentId)?.agent;
  assert.ok(targetAgent && !targetAgent.activeTurn && !targetAgent.pendingPermissions?.length);
  agentRef = api.agents.ref(initialRecord.agentId); await agentRef.refresh();
  const raw = await readFile(requestPath), requestStat = await stat(requestPath), runtime = await readJson(runtimePath);
  originalRequestSha = sha(raw); previousRequestMtime = requestStat.mtimeMs;
  stableDigest = sha(JSON.stringify({ token: initialRecord.token, status: initialRecord.status, attempt: initialRecord.attempt, results: initialRecord.results.map(item => item.id), decisions: initialRecord.decisions.map(item => [item.resultId, item.approved]), commands: initialRecord.commands.map(item => [item.key, item.status, item.phase, item.messageId]), attemptHistory: initialRecord.attemptHistory.map(item => [item.number, item.resultIds]) }));
  originalRuntimePid = runtime.pid;
  manifest.preflight = { status: initialRecord.status, attempt: initialRecord.attempt, resultId: initialRecord.result.id, resultCount: initialRecord.results.length, decisionCount: initialRecord.decisions.length, agentId: initialRecord.agentId, workspaceId: initialRecord.workspaceId, agentStatus: agentRef.status, runtimeState: runtime.state, runtimeCycles: runtime.cycles, pluginPid: runtime.pid, diagnostics, inventory: { agents: agents.entries.length, complete: true } };
  await persist(manifest);

  const started = performance.now(), deadline = started + durationMs;
  let due = started, sampleIndex = 0;
  while (true) {
    const elapsedMs = performance.now() - started;
    const rawRequest = await readFile(requestPath), request = JSON.parse(rawRequest.toString('utf8')), requestStatNow = await stat(requestPath);
    const runtimeRaw = await readFile(runtimePath).catch(() => null), runtime = runtimeRaw ? JSON.parse(runtimeRaw.toString('utf8')) : null;
    const currentStable = sha(JSON.stringify({ token: request.token, status: request.status, attempt: request.attempt, results: request.results.map(item => item.id), decisions: request.decisions.map(item => [item.resultId, item.approved]), commands: request.commands.map(item => [item.key, item.status, item.phase, item.messageId]), attemptHistory: request.attemptHistory.map(item => [item.number, item.resultIds]) }));
    const currentRequestSha = sha(rawRequest);
    await agentRef.refresh();
    const agentStatus = { status: agentRef.status, workspaceId: agentRef.workspaceId, activeTurn: Boolean(agentRef.activeTurn), pendingPermissions: agentRef.pendingPermissions?.length ?? 0 };
    const processMemory = process.memoryUsage(), cpu = process.cpuUsage(previousClientCpu); previousClientCpu = process.cpuUsage();
    const hostProcess = daemonProcess(runtime?.pid ?? originalRuntimePid);
    const runtimeSha = runtimeRaw ? sha(runtimeRaw) : null;
    const cycleDelta = runtime && previousRuntimeCycles !== null ? runtime.cycles - previousRuntimeCycles : null;
    const sample = { index: sampleIndex, observedAt: now(), elapsedMs: Number(elapsedMs.toFixed(1)), jitterMs: Number((performance.now() - due).toFixed(1)), request: { sha256: currentRequestSha, mtimeMs: requestStatNow.mtimeMs, status: request.status, revision: request.revision, attempt: request.attempt, resultId: request.result?.id ?? null, results: request.results.length, decisions: request.decisions.length, attemptHistory: request.attemptHistory.length, commandCount: request.commands.length, pendingCommands: request.commands.filter(item => ['pending', 'unknown'].includes(item.status)).length, stableDigest: currentStable }, agent: agentStatus, runtime: runtime && { state: runtime.state, cycles: runtime.cycles, cycleDelta, failures: runtime.failures, restoring: runtime.restoring, pid: runtime.pid, lastError: runtime.lastError }, process: { pluginWorkingSetBytes: hostProcess?.WorkingSet64 ?? null, pluginPrivateBytes: hostProcess?.PrivateMemorySize64 ?? null, pluginCpuSeconds: hostProcess?.CPU ?? null, clientRssBytes: processMemory.rss, clientHeapUsedBytes: processMemory.heapUsed, clientCpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 } } };
    if (sample.runtime) Object.assign(sample.runtime, { activeCycles: runtime.activeCycles, maxConcurrentCycles: runtime.maxConcurrentCycles });
    manifest.samples.push(sample);
    if ((runtime?.maxConcurrentCycles ?? 0) > 1) manifest.violations.push({ at: sample.observedAt, kind: 'overlapping-runtime-cycle', maxConcurrentCycles: runtime.maxConcurrentCycles });
    if (currentRequestSha !== originalRequestSha) manifest.writeEvents.requestBytesChanged++;
    if (requestStatNow.mtimeMs !== previousRequestMtime) manifest.writeEvents.requestMtimeChanged++;
    if (runtimeSha && runtimeSha !== previousRuntimeSha) manifest.writeEvents.runtimeStatusContentChanged++;
    if (currentStable !== stableDigest) manifest.violations.push({ at: sample.observedAt, kind: 'stable-request-changed', status: request.status, attempt: request.attempt, results: request.results.length, decisions: request.decisions.length });
    if (agentStatus.activeTurn || agentStatus.pendingPermissions || !['idle', 'ended', 'completed', 'closed'].includes(String(agentStatus.status).toLowerCase())) manifest.violations.push({ at: sample.observedAt, kind: 'agent-not-stable', ...agentStatus });
    if (runtime && (runtime.state !== 'connected' || runtime.failures !== 0 || runtime.restoring || runtime.pid !== originalRuntimePid)) manifest.violations.push({ at: sample.observedAt, kind: 'runtime-not-stable', state: runtime.state, failures: runtime.failures, restoring: runtime.restoring, pid: runtime.pid });
    previousRequestMtime = requestStatNow.mtimeMs; previousRuntimeSha = runtimeSha; if (runtime) previousRuntimeCycles = runtime.cycles;
    await persist(manifest);
    if (sampleIndex % 6 === 0) console.log(JSON.stringify({ p05: 'sample', index: sampleIndex, elapsedMs: Math.round(elapsedMs), runtimeCycles: runtime?.cycles ?? null, runtimeState: runtime?.state ?? null, requestShaStable: currentRequestSha === originalRequestSha, agentStatus: agentStatus.status }));
    if (performance.now() >= deadline) break;
    sampleIndex++;
    due = started + sampleIndex * intervalMs;
    await delay(Math.max(0, due - performance.now()));
  }
  manifest.endedAt = now(); manifest.elapsedMs = Number((performance.now() - started).toFixed(1));
} catch (error) {
  manifest.status = 'failed'; manifest.error = error instanceof Error ? error.message : String(error); manifest.endedAt = now(); await persist(manifest).catch(() => undefined); throw error;
} finally {
  try { await api.dispose(); } finally { await client.close(); }
}

manifest.status = 'completed';
const finalRequestBytes = await readFile(requestPath), finalRequest = JSON.parse(finalRequestBytes.toString('utf8'));
const finalDiagnosticsClient = createHostClient('127.0.0.1:6767', { clientId: `${runId}-p05-final`, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
await finalDiagnosticsClient.connect();
try {
  manifest.finalDiagnostics = await finalDiagnosticsClient.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
} finally { await finalDiagnosticsClient.close(); }
await delay(50);
manifest.postCloseActiveResources = process.getActiveResourcesInfo();
const resourceCounts = resources => resources.reduce((counts, resource) => counts.set(resource, (counts.get(resource) ?? 0) + 1), new Map());
const baselineResources = resourceCounts(resourcesBeforeConnect), finalResources = resourceCounts(manifest.postCloseActiveResources);
manifest.resourceDeltaAfterClose = Object.fromEntries([...new Set([...baselineResources.keys(), ...finalResources.keys()])].map(name => [name, (finalResources.get(name) ?? 0) - (baselineResources.get(name) ?? 0)]).filter(([, count]) => count !== 0));
manifest.postCloseTransientResources = manifest.postCloseActiveResources.filter(resource => ['ConnectWrap', 'TCPSocketWrap', 'Timeout'].includes(resource));
const rss = manifest.samples.map(item => item.process.pluginWorkingSetBytes).filter(Number.isFinite), cycleDeltas = manifest.samples.map(item => item.runtime?.cycleDelta).filter(Number.isFinite);
const firstWindow = manifest.samples.filter(item => item.elapsedMs <= 300_000).map(item => item.process.pluginWorkingSetBytes).filter(Number.isFinite);
const lastWindow = manifest.samples.filter(item => item.elapsedMs >= durationMs - 300_000).map(item => item.process.pluginWorkingSetBytes).filter(Number.isFinite);
const avg = values => values.length ? Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(1)) : null;
manifest.stats = { sampleCount: manifest.samples.length, minIntervalMs: Number(Math.min(...manifest.samples.slice(1).map((item, i) => item.elapsedMs - manifest.samples[i].elapsedMs)).toFixed(1)), maxIntervalMs: Number(Math.max(...manifest.samples.slice(1).map((item, i) => item.elapsedMs - manifest.samples[i].elapsedMs)).toFixed(1)), pluginRssBytes: { firstWindowMean: avg(firstWindow), lastWindowMean: avg(lastWindow), min: Math.min(...rss), max: Math.max(...rss), deltaMeanBytes: avg(lastWindow) !== null && avg(firstWindow) !== null ? Number((avg(lastWindow) - avg(firstWindow)).toFixed(1)) : null }, maxRuntimeCycleDeltaPerSample: cycleDeltas.length ? Math.max(...cycleDeltas) : null, requestContentChanges: manifest.writeEvents.requestBytesChanged, requestMtimeChanges: manifest.writeEvents.requestMtimeChanged, runtimeStatusContentChanges: manifest.writeEvents.runtimeStatusContentChanged, violations: manifest.violations.length, finalRequestSha256: sha(finalRequestBytes), originalRequestSha256: originalRequestSha, finalAttempt: finalRequest.attempt, finalResults: finalRequest.results.length, finalDecisions: finalRequest.decisions.length, connectedResourcesAfterClose: manifest.postCloseActiveResources };
manifest.stats.concurrentCyclesMeasured = manifest.samples.every(item => Number.isInteger(item.runtime?.maxConcurrentCycles));
manifest.stats.maxConcurrentCycles = Math.max(...manifest.samples.map(item => item.runtime?.maxConcurrentCycles ?? 0));
manifest.noLeakedResources = Object.values(manifest.resourceDeltaAfterClose).every(count => count <= 0) && manifest.postCloseTransientResources.length === 0;
manifest.pass = manifest.elapsedMs >= durationMs && manifest.samples.length >= 181 && manifest.violations.length === 0 && manifest.stats.requestContentChanges === 0 && manifest.stats.requestMtimeChanges === 0 && manifest.stats.finalRequestSha256 === originalRequestSha && manifest.finalDiagnostics?.issues?.length === 0 && manifest.finalDiagnostics?.activeTokens?.length === 0 && manifest.noLeakedResources;
manifest.pass = manifest.pass && manifest.stats.concurrentCyclesMeasured && manifest.stats.maxConcurrentCycles === 1;
await persist(manifest);
console.log(JSON.stringify({ file: manifestPath, status: manifest.status, pass: manifest.pass, elapsedMs: manifest.elapsedMs, stats: manifest.stats }, null, 2));
if (!manifest.pass) process.exitCode = 1;
