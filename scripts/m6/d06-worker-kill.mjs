import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { diagnosticsRpc } from '../../shared/contracts/feature-request.ts';

const [runId, outputName = 'd06'] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use the registered M6 run ID.');
assert.match(outputName, /^d06(?:-[a-z0-9-]{1,20})?$/, 'Use a unique D06 evidence directory, e.g. d06-002.');
const token = `${runId}-d06`, home = homedir(), root = join(home, '.orchiva'), runRoot = join(root, 'm6', runId), output = join(runRoot, outputName), manifestPath = join(output, 'd06-worker-kill.json'), requestPath = join(root, 'requests', `${token}.json`), runtimePath = join(root, 'runtime-status.json'), paseoHome = join(home, '.paseo-orchiva'), sandboxPath = join(home, 'lib', 'orchiva-PoC');
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const cliJson = args => {
  const psArgs = args.map(psQuote).join(', ');
  const script = `$ErrorActionPreference = 'Stop'; $cli = (Get-Command 'paseo.cmd').Source; $d06Args = @(${psArgs}); & $cli @d06Args; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return output ? JSON.parse(output) : null;
};
const processInfo = pid => {
  const script = `$ErrorActionPreference = 'Stop'; $target = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if ($null -eq $target) { 'null' } else { [pscustomobject]@{ ProcessId=$target.ProcessId; ParentProcessId=$target.ParentProcessId; Name=$target.Name; ExecutablePath=$target.ExecutablePath } | ConvertTo-Json -Compress }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return output === 'null' ? null : JSON.parse(output);
};
const killExactWorker = (workerPid, supervisorPid) => {
  assert.ok(Number.isInteger(workerPid) && workerPid > 0 && workerPid !== supervisorPid);
  const script = `$ErrorActionPreference = 'Stop'; $workerId=${workerPid}; $supervisorId=${supervisorPid}; $target=Get-CimInstance Win32_Process -Filter "ProcessId = $workerId"; if ($null -eq $target -or $target.ParentProcessId -ne $supervisorId) { throw 'Paseo worker identity or parent changed; refusing to kill.' }; Stop-Process -Id $workerId -Force -ErrorAction Stop; [pscustomobject]@{killedPid=$workerId;parentPid=$target.ParentProcessId} | ConvertTo-Json -Compress`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return JSON.parse(output);
};
const credential = async () => (await readFile(join(paseoHome, 'local-credential'), 'utf8')).trim();
const client = createHostClient('127.0.0.1:6767', { clientId: `${runId}-d06`, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const manifest = { runId, evidenceDirectory: outputName, token, startedAt: now(), status: 'preflight', expectedSandbox: sandboxPath, killPolicy: 'Only the workerPid reported by paseo daemon status is eligible. Before Stop-Process, verify its current parent PID equals the Paseo supervisor PID and it differs from the supervisor. No supervisor, terminal, Agent, machine, or network process is killed.' };
await mkdir(output, { recursive: false });
const persist = async () => { const temp = `${manifestPath}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(manifest, null, 2)); await rename(temp, manifestPath); };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });

try {
  await client.connect();
  const diagnostics = await client.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
  assert.equal(diagnostics.issues.length, 0); assert.equal(diagnostics.activeTokens.length, 0);
  const project = await readJson(join(root, 'project.json'));
  assert.equal(project.repositoryPath.toLowerCase(), sandboxPath.toLowerCase(), 'Only the registered PoC sandbox is allowed.');
  const agentsBefore = await api.agents.list(), workspacesBefore = await api.workspaces.list();
  assert.equal(agentsBefore.pageInfo.hasMore, false); assert.equal(workspacesBefore.pageInfo.hasMore, false);
  assert.ok(agentsBefore.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(String(agent.status).toLowerCase())), 'An unrelated Agent or pending permission exists.');
  assert.ok(workspacesBefore.entries.every(workspace => !workspace.activeTurn), 'An unrelated Workspace has an active turn.');
  const beforeDaemon = cliJson(['daemon', 'status', '--home', paseoHome, '--json']);
  assert.equal(beforeDaemon.localDaemon, 'running'); assert.equal(beforeDaemon.relay?.enabled, false);
  const initialRuntime = await readJson(runtimePath); assert.equal(initialRuntime.state, 'connected'); assert.equal(initialRuntime.restoring, false);

  const feature = { title: 'M6 D06 실행 중 worker 종료', goal: '작업을 시작한 뒤 30초간 대기하고 M6_D06_PROOF.md 파일 하나에 M6_D06_WORKER_SURVIVED를 기록한다.', scope: '등록된 PoC sandbox의 전용 Worktree에 M6_D06_PROOF.md 파일 하나만 생성한다.', constraints: '첫 단계에서 PowerShell Start-Sleep -Seconds 30을 정확히 한 번 실행한다. 이후 marker 파일 하나만 만들고 커밋·push·merge·다른 저장소 접근·추가 파일 생성을 하지 않는다.', validation: 'Orchiva가 marker의 포함 여부를 확인한다.', completionCriteria: '' };
  const tokenRecord = { token, commandKey: `${token}-save`, expectedRevision: 0, feature, criteria: [{ id: 'marker', text: 'M6_D06_PROOF.md contains M6_D06_WORKER_SURVIVED.', checkIds: ['marker-check'], manualMethod: '', legacy: false }], checks: [{ id: 'marker-check', kind: 'file-contains', path: 'M6_D06_PROOF.md', text: 'M6_D06_WORKER_SURVIVED', label: 'M6 D06 marker' }] };
  manifest.status = 'preparing'; manifest.feature = feature; manifest.baseline = { daemon: { pid: beforeDaemon.pid, workerPid: beforeDaemon.workerPid, version: beforeDaemon.daemonVersion }, runtime: { startedAt: initialRuntime.startedAt, pid: initialRuntime.pid }, inventory: { agents: agentsBefore.entries.length, workspaces: workspacesBefore.entries.length }, originalTaskAgents: agentsBefore.entries.map(({ agent }) => agent.id).sort(), originalWorkspaceIds: workspacesBefore.entries.map(workspace => workspace.id).sort() };
  await persist();
  const draft = await client.invokePluginRpc('orchiva-plugin', 'request.save-draft', tokenRecord);
  const ready = await client.invokePluginRpc('orchiva-plugin', 'request.prepare-plan', { token, commandKey: `${token}-plan`, expectedRevision: draft.revision });
  const plan = ready.plans.at(-1);
  const startInput = { token, commandKey: `${token}-start`, expectedRevision: ready.revision, planRevision: plan.revision, inputHash: plan.inputHash };
  manifest.startInput = startInput; manifest.plan = { revision: plan.revision, inputHash: plan.inputHash, baseCommit: plan.baseCommit };
  await persist();
  const accepted = await client.invokePluginRpc('orchiva-plugin', 'request.start', startInput);
  assert.equal(accepted.status, 'planned');
  const startedAt = performance.now(), deadline = Date.now() + 120_000;
  let runningRecord = null, liveAgent = null;
  while (Date.now() < deadline) {
    const current = await readJson(requestPath).catch(() => null);
    if (current?.status === 'running' && current.agentId) {
      const ref = api.agents.ref(current.agentId); await ref.refresh();
      if (ref.activeTurn) { runningRecord = current; liveAgent = { id: ref.id, status: ref.status, activeTurn: Boolean(ref.activeTurn), workspaceId: ref.workspaceId, pendingPermissions: ref.pendingPermissions?.length ?? 0 }; break; }
    }
    await delay(250);
  }
  assert.ok(runningRecord && liveAgent?.activeTurn, 'Did not observe the owned Agent actively running; no worker was killed.');
  assert.equal(liveAgent.pendingPermissions, 0, 'Task is waiting for permission; no worker was killed.');
  const beforeKillDaemon = cliJson(['daemon', 'status', '--home', paseoHome, '--json']);
  assert.equal(beforeKillDaemon.workerPid, beforeDaemon.workerPid, 'Paseo worker changed before the controlled kill.');
  const worker = processInfo(beforeKillDaemon.workerPid);
  assert.ok(worker); assert.equal(worker.ProcessId, beforeKillDaemon.workerPid); assert.equal(worker.ParentProcessId, beforeKillDaemon.pid, 'Reported worker is not a direct child of the Paseo supervisor; refusing to kill.');
  const agentsAtKill = await api.agents.list(), workspacesAtKill = await api.workspaces.list();
  assert.equal(agentsAtKill.pageInfo.hasMore, false); assert.equal(workspacesAtKill.pageInfo.hasMore, false);
  manifest.status = 'worker-active'; manifest.activeTask = { status: runningRecord.status, taskId: runningRecord.taskId, agentId: runningRecord.agentId, workspaceId: runningRecord.workspaceId, attempt: runningRecord.attempt, resultIds: runningRecord.results.map(item => item.id), agent: liveAgent, agentIds: agentsAtKill.entries.map(({ agent }) => agent.id).sort(), workspaceIds: workspacesAtKill.entries.map(workspace => workspace.id).sort(), requestSha256: sha(await readFile(requestPath)), elapsedFromStartMs: Number((performance.now() - startedAt).toFixed(1)) };
  manifest.killTarget = { ...worker, supervisorPid: beforeKillDaemon.pid, workerPid: beforeKillDaemon.workerPid, daemonVersion: beforeKillDaemon.daemonVersion };
  await persist();

  try { await api.dispose(); } finally { await client.close(); }
  manifest.killRequestedAt = now(); await persist();
  manifest.killResult = killExactWorker(beforeKillDaemon.workerPid, beforeKillDaemon.pid);
  manifest.workerKilledAt = now(); manifest.status = 'worker-killed'; await persist();

  const recoverDeadline = Date.now() + 60_000;
  let recoveredDaemon = null;
  while (Date.now() < recoverDeadline) {
    const current = cliJson(['daemon', 'status', '--home', paseoHome, '--json']);
    if (current.localDaemon === 'running' && current.workerPid && current.workerPid !== beforeKillDaemon.workerPid) { recoveredDaemon = current; break; }
    await delay(500);
  }
  assert.ok(recoveredDaemon, 'Paseo supervisor did not publish a replacement worker within 60 seconds.');
  const runtimeDeadline = Date.now() + 60_000;
  let recoveredRuntime = null;
  while (Date.now() < runtimeDeadline) {
    const current = await readJson(runtimePath).catch(() => null);
    if (current?.state === 'connected' && current.restoring === false && current.startedAt !== initialRuntime.startedAt) { recoveredRuntime = current; break; }
    await delay(200);
  }
  assert.ok(recoveredRuntime, 'Orchiva Plugin did not reconnect and complete restore within 60 seconds.');

  const afterClient = createHostClient('127.0.0.1:6767', { clientId: `${runId}-d06-after`, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
  const afterApi = createPaseoApi(afterClient);
  let afterDiagnostics, afterRecord, agentsAfter, workspacesAfter;
  try {
    await afterClient.connect();
    afterDiagnostics = await afterClient.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
    afterRecord = await afterClient.invokePluginRpc('orchiva-plugin', 'request.get', { token });
    const settleDeadline = Date.now() + 120_000;
    while (Date.now() < settleDeadline && ['planned', 'running', 'validating'].includes(afterRecord.status)) {
      await delay(500);
      afterRecord = await afterClient.invokePluginRpc('orchiva-plugin', 'request.get', { token });
    }
    afterDiagnostics = await afterClient.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
    agentsAfter = await afterApi.agents.list(); workspacesAfter = await afterApi.workspaces.list();
  } finally { try { await afterApi.dispose(); } finally { await afterClient.close(); } }
  const afterBytes = await readFile(requestPath), diskRecord = JSON.parse(afterBytes.toString('utf8'));
  assert.equal(afterRecord.token, token); assert.equal(afterRecord.attempt, runningRecord.attempt);
  assert.equal(afterRecord.agentId, runningRecord.agentId); assert.equal(afterRecord.workspaceId, runningRecord.workspaceId);
  assert.equal(diskRecord.token, afterRecord.token); assert.equal(diskRecord.attempt, afterRecord.attempt); assert.equal(diskRecord.agentId, afterRecord.agentId); assert.equal(diskRecord.workspaceId, afterRecord.workspaceId);
  assert.equal(agentsAfter.pageInfo.hasMore, false); assert.equal(workspacesAfter.pageInfo.hasMore, false);
  const agentIdsAfter = agentsAfter.entries.map(({ agent }) => agent.id).sort(), workspaceIdsAfter = workspacesAfter.entries.map(workspace => workspace.id).sort();
  const sameAgentInventory = JSON.stringify(agentIdsAfter) === JSON.stringify(manifest.activeTask.agentIds);
  const sameWorkspaceInventory = JSON.stringify(workspaceIdsAfter) === JSON.stringify(manifest.activeTask.workspaceIds);
  manifest.recovery = { observedAt: now(), daemon: { pid: recoveredDaemon.pid, workerPid: recoveredDaemon.workerPid, previousWorkerPid: beforeKillDaemon.workerPid, version: recoveredDaemon.daemonVersion, listen: recoveredDaemon.configuredListen }, runtime: { startedAt: recoveredRuntime.startedAt, state: recoveredRuntime.state, restoring: recoveredRuntime.restoring, failures: recoveredRuntime.failures, pid: recoveredRuntime.pid, cycles: recoveredRuntime.cycles }, request: { status: afterRecord.status, attempt: afterRecord.attempt, resultIds: afterRecord.results.map(item => item.id), decisionIds: afterRecord.decisions.map(item => item.id), commandStatuses: afterRecord.commands.map(item => ({ key: item.key, status: item.status, phase: item.phase })), sha256: sha(afterBytes), diskSha256: sha(afterBytes), hasTaskProofFile: (await readFile(join(afterRecord.worktreePath, 'M6_D06_PROOF.md')).then(bytes => bytes.toString('utf8').includes('M6_D06_WORKER_SURVIVED')).catch(() => false)) }, model: { agentId: afterRecord.agentId, status: agentsAfter.entries.find(({ agent }) => agent.id === afterRecord.agentId)?.agent.status ?? null, activeTurn: Boolean(agentsAfter.entries.find(({ agent }) => agent.id === afterRecord.agentId)?.agent.activeTurn), pendingPermissions: agentsAfter.entries.find(({ agent }) => agent.id === afterRecord.agentId)?.agent.pendingPermissions?.length ?? 0, sameAgentInventory, sameWorkspaceInventory, agentCountBeforeTask: manifest.baseline.inventory.agents, agentCountBeforeKill: manifest.activeTask.agentIds.length, agentCountAfter: agentsAfter.entries.length, workspaceCountBeforeTask: manifest.baseline.inventory.workspaces, workspaceCountBeforeKill: manifest.activeTask.workspaceIds.length, workspaceCountAfter: workspacesAfter.entries.length }, diagnostics: afterDiagnostics, totalElapsedMs: Number((performance.now() - startedAt).toFixed(1)) };
  assert.equal(afterDiagnostics.issues.length, 0); assert.equal(afterDiagnostics.activeTokens.length, 0);
  assert.equal(sameAgentInventory, true, 'An Agent was unexpectedly created or removed during worker restore.');
  assert.equal(sameWorkspaceInventory, true, 'A Workspace was unexpectedly created or removed during worker restore.');
  manifest.status = 'completed'; manifest.endedAt = now();
  manifest.pass = manifest.killResult.killedPid === beforeKillDaemon.workerPid && recoveredDaemon.workerPid !== beforeKillDaemon.workerPid && recoveredRuntime.state === 'connected' && recoveredRuntime.restoring === false && afterRecord.token === token && afterRecord.attempt === runningRecord.attempt && afterRecord.agentId === runningRecord.agentId && afterRecord.workspaceId === runningRecord.workspaceId && sameAgentInventory && sameWorkspaceInventory && afterDiagnostics.issues.length === 0 && afterDiagnostics.activeTokens.length === 0;
  await persist();
  console.log(JSON.stringify({ file: manifestPath, status: manifest.status, pass: manifest.pass, killedWorkerPid: beforeKillDaemon.workerPid, replacementWorkerPid: recoveredDaemon.workerPid, requestStatus: afterRecord.status, attempt: afterRecord.attempt, agentId: afterRecord.agentId, agentStatus: manifest.recovery.model.status, activeTurn: manifest.recovery.model.activeTurn, sameAgentInventory, sameWorkspaceInventory, totalElapsedMs: manifest.recovery.totalElapsedMs }, null, 2));
  if (!manifest.pass) process.exitCode = 1;
} catch (error) {
  manifest.status = 'failed'; manifest.error = error instanceof Error ? error.message : String(error); manifest.endedAt = now(); await persist().catch(() => undefined); throw error;
} finally {
  try { await api.dispose(); } catch {}
  try { await client.close(); } catch {}
}
