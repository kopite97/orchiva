import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { diagnosticsRpc } from '../../shared/contracts/feature-request.ts';

const [runId, evidenceDirectory = 'd06-003'] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use the registered M6 run ID.');
assert.match(evidenceDirectory, /^d06(?:-[a-z0-9-]{1,20})?$/, 'Use a unique D06 evidence directory.');
const token = `${runId}-d06`, home = homedir(), root = join(home, '.orchiva'), runRoot = join(root, 'm6', runId), recordPath = join(root, 'requests', `${token}.json`), evidencePath = join(runRoot, evidenceDirectory, 'd06-recovery.json'), paseoHome = join(home, '.paseo-orchiva');
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const credential = async () => (await readFile(join(paseoHome, 'local-credential'), 'utf8')).trim();
const makeClient = suffix => createHostClient('127.0.0.1:6767', { clientId: `${runId}-d06-recovery-${suffix}`, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
const readRecord = async () => JSON.parse((await readFile(recordPath, 'utf8')).replace(/^\uFEFF/, ''));
const evidence = { runId, token, startedAt: now(), status: 'preflight', instruction: 'The first attempt already ran the planned wait and was interrupted by the worker kill. Continue in the same Agent and Workspace; do not sleep again. Create only M6_D06_PROOF.md with M6_D06_WORKER_SURVIVED. Do not commit or create additional files.' };
const writeEvidence = async () => writeFile(evidencePath, JSON.stringify(evidence, null, 2), { flag: 'wx' });
await writeEvidence();
const client = makeClient('before'), api = createPaseoApi(client);
try {
  await client.connect();
  const diagnostics = await client.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
  assert.equal(diagnostics.issues.length, 0); assert.equal(diagnostics.activeTokens.length, 0);
  const beforeBytes = await readFile(recordPath), before = JSON.parse(beforeBytes.toString('utf8'));
  assert.equal(before.token, token); assert.equal(before.status, 'failed'); assert.equal(before.attempt, 1);
  assert.equal(before.results.length, 1); assert.ok(before.agentId && before.workspaceId && before.result?.id);
  assert.equal(before.commands.some(item => ['pending', 'unknown'].includes(item.status)), false);
  const agentsBefore = await api.agents.list(), workspacesBefore = await api.workspaces.list();
  assert.equal(agentsBefore.pageInfo.hasMore, false); assert.equal(workspacesBefore.pageInfo.hasMore, false);
  assert.ok(agentsBefore.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(String(agent.status).toLowerCase())), 'An unrelated active Agent or permission exists.');
  assert.ok(agentsBefore.entries.some(({ agent }) => agent.id === before.agentId), 'Original Agent is missing.');
  assert.ok(workspacesBefore.entries.some(workspace => workspace.id === before.workspaceId), 'Original Workspace is missing.');

  const input = { token, key: `${token}-resume-after-worker-kill`, instruction: evidence.instruction, expectedRevision: before.revision, resultId: before.result.id };
  Object.assign(evidence, { preflight: { status: before.status, revision: before.revision, attempt: before.attempt, resultId: before.result.id, resultIds: before.results.map(item => item.id), agentId: before.agentId, workspaceId: before.workspaceId, error: before.error, requestSha256: sha(beforeBytes), inventory: { agents: agentsBefore.entries.length, workspaces: workspacesBefore.entries.length }, diagnostics }, input, status: 'resuming' });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  const resumed = await client.invokePluginRpc('orchiva-plugin', 'request.resume', input);
  const replay = await client.invokePluginRpc('orchiva-plugin', 'request.resume', input);
  assert.equal(resumed.attempt, 2); assert.equal(replay.attempt, 2);
  assert.equal(resumed.agentId, before.agentId); assert.equal(replay.agentId, before.agentId);
  assert.equal(resumed.workspaceId, before.workspaceId); assert.equal(replay.workspaceId, before.workspaceId);
  evidence.accepted = { status: resumed.status, replayStatus: replay.status, attempt: resumed.attempt, agentId: resumed.agentId, workspaceId: resumed.workspaceId, sendCommandCountAfterReplay: replay.commands.filter(item => item.kind === 'resume').length };
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));

  const deadline = Date.now() + 180_000;
  let current = await client.invokePluginRpc('orchiva-plugin', 'request.get', { token });
  while (Date.now() < deadline && ['planned', 'running', 'validating'].includes(current.status)) { await delay(500); current = await client.invokePluginRpc('orchiva-plugin', 'request.get', { token }); }
  assert.equal(current.status, 'awaiting-review'); assert.equal(current.attempt, 2); assert.equal(current.results.length, 2);
  assert.equal(current.results[0].id, before.results[0].id, 'Original interrupted result must remain immutable.');
  assert.ok(current.result.checks.some(check => check.passed && check.checkId === 'marker-check'));
  const proof = await readFile(join(current.worktreePath, 'M6_D06_PROOF.md'), 'utf8'); assert.ok(proof.includes('M6_D06_WORKER_SURVIVED'));
  const afterDiagnostics = await client.invokePluginRpc('orchiva-plugin', diagnosticsRpc.name, {});
  const agentsAfter = await api.agents.list(), workspacesAfter = await api.workspaces.list(), afterBytes = await readFile(recordPath);
  const sameAgents = JSON.stringify(agentsAfter.entries.map(({ agent }) => agent.id).sort()) === JSON.stringify(agentsBefore.entries.map(({ agent }) => agent.id).sort());
  const sameWorkspaces = JSON.stringify(workspacesAfter.entries.map(workspace => workspace.id).sort()) === JSON.stringify(workspacesBefore.entries.map(workspace => workspace.id).sort());
  assert.equal(current.agentId, before.agentId); assert.equal(current.workspaceId, before.workspaceId);
  assert.equal(sameAgents, true); assert.equal(sameWorkspaces, true);
  assert.equal(afterDiagnostics.issues.length, 0); assert.equal(afterDiagnostics.activeTokens.length, 0);
  evidence.status = 'completed'; evidence.endedAt = now(); evidence.pass = true;
  evidence.recovery = { status: current.status, attempt: current.attempt, resultIds: current.results.map(item => item.id), previousFailedResultPreserved: current.results[0].id === before.result.id, checkPassed: current.result.checks.find(check => check.checkId === 'marker-check')?.passed === true, proofSha256: sha(Buffer.from(proof)), requestSha256: sha(afterBytes), sameAgent: current.agentId === before.agentId, sameWorkspace: current.workspaceId === before.workspaceId, sameAgentInventory: sameAgents, sameWorkspaceInventory: sameWorkspaces, agentCount: agentsAfter.entries.length, workspaceCount: workspacesAfter.entries.length, resumeCommandCount: current.commands.filter(item => item.kind === 'resume').length, diagnostics: afterDiagnostics };
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ file: evidencePath, pass: evidence.pass, status: current.status, attempt: current.attempt, agentId: current.agentId, workspaceId: current.workspaceId, results: current.results.length, sameAgentInventory: sameAgents, sameWorkspaceInventory: sameWorkspaces }, null, 2));
} catch (error) {
  evidence.status = 'failed'; evidence.error = error instanceof Error ? error.message : String(error); evidence.endedAt = now(); await writeFile(evidencePath, JSON.stringify(evidence, null, 2)).catch(() => undefined); throw error;
} finally { try { await api.dispose(); } finally { await client.close(); } }
