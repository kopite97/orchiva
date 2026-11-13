import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { diagnosticsRpc, getRpc } from '../../shared/contracts/feature-request.ts';

const [runId, tokenArg] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use the registered M6 run ID.');
const token = tokenArg || `${runId}-d03`;
assert.ok(token.startsWith(`${runId}-`), 'P04 can only observe a request owned by this M6 run.');
const home = homedir(), dataRoot = join(home, '.orchiva'), runRoot = join(dataRoot, 'm6', runId), output = join(runRoot, 'p04'), manifestPath = join(output, 'p04-restarts.json'), requestPath = join(dataRoot, 'requests', `${token}.json`), runtimePath = join(dataRoot, 'runtime-status.json'), paseoHome = join(home, '.paseo-orchiva');
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const stableDigest = record => sha(JSON.stringify({ token: record.token, status: record.status, attempt: record.attempt, results: record.results.map(item => item.id), decisions: record.decisions.map(item => [item.resultId, item.approved]), commands: record.commands.map(item => [item.key, item.status, item.phase, item.messageId]), attemptHistory: record.attemptHistory.map(item => [item.number, item.resultIds]) }));
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const cliJson = args => {
  const psArgs = args.map(psQuote).join(', ');
  const script = `$ErrorActionPreference = 'Stop'; $cli = (Get-Command 'paseo.cmd').Source; $p04Args = @(${psArgs}); & $cli @p04Args; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return output ? JSON.parse(output) : null;
};
const credential = async () => (await readFile(join(paseoHome, 'local-credential'), 'utf8')).trim();
const createClient = suffix => createHostClient('127.0.0.1:6767', { clientId: `${runId}-p04-${suffix}`, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
const manifest = { runId, token, startedAt: now(), status: 'running', requiredRestarts: 3, targetMs: 30_000, restarts: [], assumptions: ['Uses paseo daemon restart for normal worker replacement; does not stop the supervisor, kill terminals, or change daemon configuration.'] };
await mkdir(output, { recursive: false });
const persist = async () => { const temp = `${manifestPath}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(manifest, null, 2)); await rename(temp, manifestPath); };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });

try {
  const baselineBytes = await readFile(requestPath), baselineRecord = JSON.parse(baselineBytes.toString('utf8'));
  assert.equal(baselineRecord.token, token);
  assert.ok(['awaiting-review', 'completed'].includes(baselineRecord.status), 'Target must be a terminal M6-owned request.');
  assert.equal(baselineRecord.commands.some(item => ['pending', 'unknown'].includes(item.status)), false, 'Target has an unresolved command.');
  const baselineRuntime = await readJson(runtimePath);
  assert.equal(baselineRuntime.state, 'connected'); assert.equal(baselineRuntime.restoring, false);
  manifest.preflight = { requestStatus: baselineRecord.status, attempt: baselineRecord.attempt, resultIds: baselineRecord.results.map(item => item.id), decisionIds: baselineRecord.decisions.map(item => item.id), agentId: baselineRecord.agentId, workspaceId: baselineRecord.workspaceId, requestSha256: sha(baselineBytes), stableDigest: stableDigest(baselineRecord), runtime: { startedAt: baselineRuntime.startedAt, state: baselineRuntime.state, cycles: baselineRuntime.cycles, pid: baselineRuntime.pid } };
  await persist();

  for (let index = 1; index <= 3; index++) {
    const beforeBytes = await readFile(requestPath), beforeRecord = JSON.parse(beforeBytes.toString('utf8'));
    assert.equal(sha(beforeBytes), manifest.preflight.requestSha256, 'M6 request changed between restart samples.');
    const preClient = createClient(`pre-${index}`), preApi = createPaseoApi(preClient);
    try {
      await preClient.connect();
      const diagnostics = await preClient.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
      const record = await preClient.invokePluginRpc('orchiva-plugin', getRpc.name, { token });
      const agents = await preApi.agents.list();
      assert.equal(diagnostics.issues.length, 0); assert.equal(diagnostics.activeTokens.length, 0);
      assert.equal(stableDigest(record), manifest.preflight.stableDigest);
      assert.equal(agents.pageInfo.hasMore, false);
      assert.ok(agents.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(String(agent.status).toLowerCase())), 'Unrelated active Agent/permission exists.');
    } finally { try { await preApi.dispose(); } finally { await preClient.close(); } }

    const previousRuntime = await readJson(runtimePath), startedAt = performance.now(), restartStartedAt = now();
    const restartOutput = cliJson(['daemon', 'restart', '--home', paseoHome, '--timeout', '45', '--json']);
    const restartCommandCompletedAt = now(), restartCommandElapsedMs = Number((performance.now() - startedAt).toFixed(1));
    const deadline = Date.now() + 45_000;
    let connectedRuntime = null, observations = 0;
    while (Date.now() < deadline) {
      observations++;
      const current = await readJson(runtimePath).catch(() => null);
      if (current?.state === 'connected' && current.restoring === false && current.startedAt !== previousRuntime.startedAt) { connectedRuntime = current; break; }
      await delay(200);
    }
    assert.ok(connectedRuntime, `Paseo restarted but Plugin reconnection/reconciliation was not observed within 45 seconds (restart ${index}).`);
    const reconnectObservedAt = now(), elapsedToRuntimeReadyMs = Number((performance.now() - startedAt).toFixed(1));
    const postStatus = cliJson(['daemon', 'status', '--home', paseoHome, '--json']);
    assert.equal(postStatus.localDaemon, 'running'); assert.equal(postStatus.relay?.enabled, false);

    const postClient = createClient(`post-${index}`), postApi = createPaseoApi(postClient);
    let diagnostics, record, agents, workspaces;
    try {
      await postClient.connect();
      diagnostics = await postClient.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
      record = await postClient.invokePluginRpc('orchiva-plugin', getRpc.name, { token });
      agents = await postApi.agents.list(); workspaces = await postApi.workspaces.list();
    } finally { try { await postApi.dispose(); } finally { await postClient.close(); } }
    const afterBytes = await readFile(requestPath), afterRecord = JSON.parse(afterBytes.toString('utf8'));
    assert.deepEqual(afterBytes, beforeBytes, 'Request JSON bytes changed across normal daemon restart.');
    assert.equal(stableDigest(record), manifest.preflight.stableDigest);
    assert.equal(record.agentId, manifest.preflight.agentId); assert.equal(record.workspaceId, manifest.preflight.workspaceId);
    assert.equal(record.attempt, manifest.preflight.attempt);
    assert.equal(diagnostics.issues.length, 0); assert.equal(diagnostics.activeTokens.length, 0);
    assert.equal(agents.pageInfo.hasMore, false); assert.equal(workspaces.pageInfo.hasMore, false);
    const stateReconciledAt = now(), elapsedToPluginReadyMs = Number((performance.now() - startedAt).toFixed(1));
    const cycle = { index, restartStartedAt, restartCommandCompletedAt, restartCommandElapsedMs, reconnectObservedAt, elapsedToRuntimeReadyMs, stateReconciledAt, elapsedToPluginReadyMs, readinessObservations: observations, restartOutput, runtimeBefore: { startedAt: previousRuntime.startedAt, state: previousRuntime.state, cycles: previousRuntime.cycles, pid: previousRuntime.pid }, runtimeAfter: { startedAt: connectedRuntime.startedAt, state: connectedRuntime.state, cycles: connectedRuntime.cycles, pid: connectedRuntime.pid, restoring: connectedRuntime.restoring }, daemon: { pid: postStatus.pid, workerPid: postStatus.workerPid, listen: postStatus.configuredListen }, requestSha256: sha(afterBytes), requestStatus: afterRecord.status, attempt: afterRecord.attempt, resultIds: afterRecord.results.map(item => item.id), decisionIds: afterRecord.decisions.map(item => item.id), agentId: record.agentId, workspaceId: record.workspaceId, agentStatus: agents.entries.find(({ agent }) => agent.id === record.agentId)?.agent.status ?? null, inventory: { agents: agents.entries.length, workspaces: workspaces.entries.length }, diagnostics };
    manifest.restarts.push(cycle); await persist();
    console.log(JSON.stringify({ p04: 'restart', index, elapsedToPluginReadyMs, status: cycle.requestStatus, attempt: cycle.attempt, agentStatus: cycle.agentStatus }));
  }
  manifest.endedAt = now();
  manifest.pass = manifest.restarts.length === 3 && manifest.restarts.every(item => item.elapsedToPluginReadyMs <= manifest.targetMs && item.requestSha256 === manifest.preflight.requestSha256 && item.attempt === manifest.preflight.attempt && item.diagnostics.issues.length === 0 && item.diagnostics.activeTokens.length === 0 && item.runtimeAfter.state === 'connected' && item.runtimeAfter.restoring === false);
  manifest.status = 'completed'; await persist();
  console.log(JSON.stringify({ file: manifestPath, status: manifest.status, pass: manifest.pass, restarts: manifest.restarts.map(({ index, elapsedToPluginReadyMs, requestStatus, agentStatus }) => ({ index, elapsedToPluginReadyMs, requestStatus, agentStatus })) }, null, 2));
  if (!manifest.pass) process.exitCode = 1;
} catch (error) {
  manifest.status = 'failed'; manifest.error = error instanceof Error ? error.message : String(error); manifest.endedAt = now(); await persist().catch(() => undefined); throw error;
}
