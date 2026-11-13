import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { diagnosticsRpc, getRpc } from '../../shared/contracts/feature-request.ts';

const [runId, tokenArg, outputName = 'a11'] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use the registered M6 run ID.');
assert.match(outputName, /^a11(?:-[a-z0-9-]{1,20})?$/, 'Use a unique A11 evidence directory, e.g. a11-002.');
const token = tokenArg || `${runId}-d03`;
assert.ok(token.startsWith(`${runId}-`), 'A11 can only inspect a request owned by this M6 run.');
const home = homedir(), dataRoot = join(home, '.orchiva'), runRoot = join(dataRoot, 'm6', runId), output = join(runRoot, outputName), manifestPath = join(output, 'a11-stop-start.json'), requestPath = join(dataRoot, 'requests', `${token}.json`), runtimePath = join(dataRoot, 'runtime-status.json'), paseoHome = join(home, '.paseo-orchiva'), startScript = resolve('scripts/start-paseo.ps1');
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const cliJson = args => {
  const psArgs = args.map(psQuote).join(', ');
  const script = `$ErrorActionPreference = 'Stop'; $cli = (Get-Command 'paseo.cmd').Source; $a11Args = @(${psArgs}); & $cli @a11Args; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return output ? JSON.parse(output) : null;
};
const startDaemon = () => { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', startScript], { windowsHide: true, stdio: 'ignore', timeout: 45_000 }); return { command: 'scripts/start-paseo.ps1', exitCode: 0, outputCaptured: false }; };
const withTimeout = (promise, label, timeoutMs = 20_000) => Promise.race([promise, delay(timeoutMs).then(() => { throw new Error(`${label} timed out after ${timeoutMs}ms.`); })]);
const credential = async () => (await readFile(join(paseoHome, 'local-credential'), 'utf8')).trim();
const createClient = clientId => createHostClient('127.0.0.1:6767', { clientId, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
const manifest = { runId, evidenceDirectory: outputName, token, startedAt: now(), status: 'preflight', method: 'graceful Paseo daemon stop with --keep-terminals, then scripts/start-paseo.ps1; no forced termination or config changes.' };
await mkdir(output, { recursive: false });
const persist = async () => { const temp = `${manifestPath}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(manifest, null, 2)); await rename(temp, manifestPath); };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });

try {
  const beforeBytes = await readFile(requestPath), beforeRecord = JSON.parse(beforeBytes.toString('utf8'));
  assert.equal(beforeRecord.token, token); assert.ok(['awaiting-review', 'completed'].includes(beforeRecord.status));
  assert.equal(beforeRecord.commands.some(item => ['pending', 'unknown'].includes(item.status)), false);
  const beforeDaemon = cliJson(['daemon', 'status', '--home', paseoHome, '--json']);
  assert.equal(beforeDaemon.localDaemon, 'running'); assert.equal(beforeDaemon.relay?.enabled, false);
  const beforeRuntime = await readJson(runtimePath); assert.equal(beforeRuntime.state, 'connected'); assert.equal(beforeRuntime.restoring, false);
  const beforeClient = createClient(`${runId}-a11-before`), beforeApi = createPaseoApi(beforeClient);
  let diagnostics, record, agents, workspaces;
  try {
    await beforeClient.connect();
    diagnostics = await beforeClient.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
    record = await beforeClient.invokePluginRpc('orchiva-plugin', getRpc.name, { token });
    agents = await beforeApi.agents.list(); workspaces = await beforeApi.workspaces.list();
  } finally { try { await beforeApi.dispose(); } finally { await beforeClient.close(); } }
  assert.equal(diagnostics.issues.length, 0); assert.equal(diagnostics.activeTokens.length, 0);
  assert.equal(agents.pageInfo.hasMore, false); assert.equal(workspaces.pageInfo.hasMore, false);
  assert.ok(agents.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(String(agent.status).toLowerCase())), 'An unrelated active Agent/permission exists.');
  const stable = JSON.stringify({ token: record.token, status: record.status, attempt: record.attempt, agentId: record.agentId, workspaceId: record.workspaceId, results: record.results.map(item => item.id), decisions: record.decisions.map(item => item.id), commands: record.commands.map(item => [item.key, item.status, item.phase, item.messageId]) });
  manifest.preflight = { requestSha256: sha(beforeBytes), requestStatus: record.status, attempt: record.attempt, agentId: record.agentId, workspaceId: record.workspaceId, resultIds: record.results.map(item => item.id), decisionIds: record.decisions.map(item => item.id), runtime: { startedAt: beforeRuntime.startedAt, state: beforeRuntime.state, cycles: beforeRuntime.cycles, pid: beforeRuntime.pid }, daemon: { pid: beforeDaemon.pid, workerPid: beforeDaemon.workerPid, version: beforeDaemon.daemonVersion }, inventory: { agentIds: agents.entries.map(({ agent }) => agent.id).sort(), workspaceIds: workspaces.entries.map(workspace => workspace.id).sort() } };
  await persist();

  const operationStarted = performance.now(), stopStartedAt = now();
  manifest.stopStartedAt = stopStartedAt; await persist();
  manifest.stopOutput = cliJson(['daemon', 'stop', '--home', paseoHome, '--timeout', '15', '--keep-terminals', '--json']);
  manifest.stoppedAt = now();
  const stopped = cliJson(['daemon', 'status', '--home', paseoHome, '--json']);
  assert.equal(stopped.localDaemon, 'stopped', 'Daemon did not reach stopped state before start.');
  manifest.stoppedStatus = stopped; await persist();

  manifest.status = 'starting'; manifest.startCommandStartedAt = now(); await persist(); console.log('a11: daemon stopped; starting it with the local environment script');
  manifest.startOutput = startDaemon(); manifest.startCommandCompletedAt = now(); await persist();
  const deadline = Date.now() + 45_000;
  let runtime = null, observations = 0;
  while (Date.now() < deadline) {
    observations++;
    runtime = await readJson(runtimePath).catch(() => null);
    if (runtime?.state === 'connected' && runtime.restoring === false && runtime.startedAt !== beforeRuntime.startedAt) break;
    await delay(200);
  }
  assert.ok(runtime?.state === 'connected' && runtime.restoring === false && runtime.startedAt !== beforeRuntime.startedAt, 'Plugin did not reconnect and finish restore within 45 seconds.');
  manifest.pluginReadyAt = now(); manifest.runtimeAfter = { startedAt: runtime.startedAt, state: runtime.state, restoring: runtime.restoring, cycles: runtime.cycles, pid: runtime.pid }; await persist(); console.log('a11: plugin connected and restore completed; checking the saved record');
  const afterDaemon = cliJson(['daemon', 'status', '--home', paseoHome, '--json']);
  assert.equal(afterDaemon.localDaemon, 'running'); assert.equal(afterDaemon.relay?.enabled, false);
  const afterClient = createClient(`${runId}-a11-after`), afterApi = createPaseoApi(afterClient);
  let afterDiagnostics, afterRecord, afterAgents, afterWorkspaces;
  try {
    await withTimeout(afterClient.connect(), 'A11 post-start client connection');
    afterDiagnostics = await withTimeout(afterClient.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {}), 'A11 diagnostics RPC');
    afterRecord = await withTimeout(afterClient.invokePluginRpc('orchiva-plugin', getRpc.name, { token }), 'A11 request detail RPC');
    afterAgents = await withTimeout(afterApi.agents.list(), 'A11 Agent inventory'); afterWorkspaces = await withTimeout(afterApi.workspaces.list(), 'A11 Workspace inventory');
  } finally { try { await afterApi.dispose(); } finally { await afterClient.close(); } }
  const afterBytes = await readFile(requestPath);
  const sameAgents = JSON.stringify(afterAgents.entries.map(({ agent }) => agent.id).sort()) === JSON.stringify(manifest.preflight.inventory.agentIds);
  const sameWorkspaces = JSON.stringify(afterWorkspaces.entries.map(workspace => workspace.id).sort()) === JSON.stringify(manifest.preflight.inventory.workspaceIds);
  assert.deepEqual(afterBytes, beforeBytes); assert.equal(afterRecord.status, record.status); assert.equal(afterRecord.attempt, record.attempt);
  assert.equal(afterRecord.agentId, record.agentId); assert.equal(afterRecord.workspaceId, record.workspaceId);
  assert.equal(JSON.stringify({ token: afterRecord.token, status: afterRecord.status, attempt: afterRecord.attempt, agentId: afterRecord.agentId, workspaceId: afterRecord.workspaceId, results: afterRecord.results.map(item => item.id), decisions: afterRecord.decisions.map(item => item.id), commands: afterRecord.commands.map(item => [item.key, item.status, item.phase, item.messageId]) }), stable);
  assert.equal(sameAgents, true); assert.equal(sameWorkspaces, true);
  assert.equal(afterDiagnostics.issues.length, 0); assert.equal(afterDiagnostics.activeTokens.length, 0);
  manifest.result = { completedAt: now(), totalElapsedMs: Number((performance.now() - operationStarted).toFixed(1)), stopStartRuntimeReadyObservations: observations, previousRuntimeStartedAt: beforeRuntime.startedAt, runtimeStartedAt: runtime.startedAt, runtimeState: runtime.state, runtimeRestoring: runtime.restoring, daemonPidBefore: beforeDaemon.pid, daemonPidAfter: afterDaemon.pid, workerPidBefore: beforeDaemon.workerPid, workerPidAfter: afterDaemon.workerPid, requestSha256: sha(afterBytes), requestStatus: afterRecord.status, attempt: afterRecord.attempt, resultIds: afterRecord.results.map(item => item.id), decisionIds: afterRecord.decisions.map(item => item.id), agentId: afterRecord.agentId, workspaceId: afterRecord.workspaceId, sameAgents, sameWorkspaces, agentCount: afterAgents.entries.length, workspaceCount: afterWorkspaces.entries.length, diagnostics: afterDiagnostics };
  manifest.endedAt = now(); manifest.status = 'completed';
  manifest.pass = manifest.result.totalElapsedMs <= 30_000 && manifest.result.runtimeState === 'connected' && manifest.result.runtimeRestoring === false && manifest.result.requestSha256 === manifest.preflight.requestSha256 && sameAgents && sameWorkspaces && afterDiagnostics.issues.length === 0 && afterDiagnostics.activeTokens.length === 0;
  await persist(); console.log(JSON.stringify({ file: manifestPath, status: manifest.status, pass: manifest.pass, totalElapsedMs: manifest.result.totalElapsedMs, daemonPidBefore: beforeDaemon.pid, daemonPidAfter: afterDaemon.pid, requestStatus: afterRecord.status, sameAgents, sameWorkspaces }, null, 2));
  if (!manifest.pass) process.exitCode = 1;
} catch (error) {
  manifest.status = 'failed'; manifest.error = error instanceof Error ? error.message : String(error); manifest.endedAt = now(); await persist().catch(() => undefined);
  try { const status = cliJson(['daemon', 'status', '--home', paseoHome, '--json']); if (status.localDaemon !== 'running') manifest.recoveryStartOutput = startDaemon(); } catch (recoveryError) { manifest.recoveryError = recoveryError instanceof Error ? recoveryError.message : String(recoveryError); }
  await persist().catch(() => undefined); throw error;
}
