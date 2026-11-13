import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { createHostClient, createHostTransportFactory } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { saveDraftRpc, preparePlanRpc, startRpc, getRpc, resumeRpc, diagnosticsRpc } from '../../shared/contracts/feature-request.ts';
import { findMessage } from '../../server/adapters/paseo/reconciliation.ts';
import { assertSandbox, loadConfig } from '../../server/config/project-config.ts';

const [runId, mode] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/, 'Use a unique M6 run ID.');
assert.ok(mode === undefined || mode === 'resume' || mode === 'resume-replay', 'Optional D03 mode must be resume or resume-replay.');
const home = homedir(), root = join(home, '.orchiva'), runRoot = join(root, 'm6', runId), output = join(runRoot, 'd03'), requestDir = join(root, 'requests');
const token = `${runId}-d03`, markerPath = `${token}.txt`, marker = `ORCHIVA_D03_${runId}_OK`, checkId = 'm6-d03-marker';
const manifestPath = join(output, 'd03-response-drop.json'), requestPath = join(requestDir, `${token}.json`);
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const readRecord = async () => JSON.parse((await readFile(requestPath, 'utf8')).replace(/^\uFEFF/, ''));
const saveManifest = async value => { const temp = `${manifestPath}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, manifestPath); };
const runtimeMessage = (record, instruction) => `Resume task ${record.taskId} in the SAME worktree. Read .orchiva/plans/${record.taskPlan.id}.md again. Do not push, merge, or access other repositories.\nRecovery instructions:\n${instruction}\nIndependent checks: ${JSON.stringify(record.checks)}`;
const config = await loadConfig(); await assertSandbox(config);
const baseline = JSON.parse((await readFile(join(runRoot, 'baseline-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(baseline.runId, runId); await mkdir(output, { recursive: true });
const requestExists = await readFile(requestPath).then(() => true, () => false);
const savedManifest = await readFile(manifestPath, 'utf8').then(raw => JSON.parse(raw)).catch(() => null);
if (mode) assert.ok(requestExists && savedManifest, 'D03 continuation requires its existing M6 request and manifest.');
else assert.ok(!requestExists, 'D03 token already exists; pass resume only after inspecting its durable state.');

const credential = async () => (await readFile(join(home, '.paseo-orchiva', 'local-credential'), 'utf8')).trim();
const clientConfig = async clientId => ({ clientId, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } });
function makeDropClient(clientId) {
  const baseFactory = createHostTransportFactory('127.0.0.1:6767');
  let armed = false, resolveDropped, chunkFrames = null;
  const dropped = new Promise(resolve => { resolveDropped = resolve; });
  const transportFactory = options => {
    const transport = baseFactory(options);
    return {
      ...transport,
      onMessage(handler) {
        return transport.onMessage((data, isBinary) => {
          const bytes = typeof data === 'string' ? null : Buffer.from(data);
          if (bytes?.[0] === 0x31 && bytes[1] === 1 && bytes.length > 4) {
            const isStart = (bytes[3] & 1) !== 0, isEnd = (bytes[3] & 2) !== 0;
            if (isStart) chunkFrames = [];
            if (chunkFrames) chunkFrames.push({ data, isBinary, bytes, kind: bytes[2] });
            if (isEnd && chunkFrames) {
              const frames = chunkFrames; chunkFrames = null;
              const payload = Buffer.concat(frames.map(frame => frame.bytes.subarray(4)));
              const text = frames[0].kind === 0 ? payload.toString('utf8') : null;
              const response = text ? parseRpcResponse(text) : null;
              if (armed && response) { armed = false; resolveDropped({ type: response.type, requestId: response.requestId ?? response.payload?.requestId ?? null, frameBytes: payload.length, transportFrames: frames.length, chunked: true, droppedAt: now() }); return; }
              for (const frame of frames) handler(frame.data, frame.isBinary);
            }
            return;
          }
          if (chunkFrames) { for (const frame of chunkFrames) handler(frame.data, frame.isBinary); chunkFrames = null; }
          if (armed) {
            const text = typeof data === 'string' ? data : bytes && (bytes[0] === 0x7b || bytes[0] === 0x5b) ? bytes.toString('utf8') : null;
            const response = text ? parseRpcResponse(text) : null;
            if (response) { armed = false; resolveDropped({ type: response.type, requestId: response.requestId ?? response.payload?.requestId ?? null, frameBytes: Buffer.byteLength(text), transportFrames: 1, chunked: false, droppedAt: now() }); return; }
          }
          handler(data, isBinary);
        });
      },
    };
  };
  const client = new DaemonClient({ ...awaitlessConfig(clientId), url: 'ws://host-connector/ws', transportFactory });
  return { client, dropped, arm: () => { armed = true; } };
}
function findRpcResponse(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  if (value.type === 'plugin.rpc.invoke.response') return value;
  for (const child of Object.values(value)) { const found = findRpcResponse(child, depth + 1); if (found) return found; }
  return null;
}
function parseRpcResponse(text) {
  try { return findRpcResponse(JSON.parse(text)); } catch { return null; }
}
function awaitlessConfig(clientId) {
  return { clientId, clientType: 'cli', appVersion: '0.15.4', localCredential: credential, reconnect: { enabled: false } };
}
async function callAndDrop(client, rpc, input, droppedSignal) {
  const invocation = client.invokePluginRpc('orchiva-plugin', rpc.name, input).then(value => ({ value }), error => ({ error: error instanceof Error ? error.message : String(error) }));
  let frame;
  try { frame = await Promise.race([droppedSignal, delay(15_000).then(() => { throw new Error(`No response frame was intercepted for ${rpc.name}.`); })]); }
  finally { await client.close().catch(() => undefined); }
  const caller = await invocation;
  assert.ok(caller.error, `Client unexpectedly received ${rpc.name} response after it was supposedly dropped.`);
  return { frame, callerError: caller.error };
}
async function normalClient(id, action) {
  const client = createHostClient('127.0.0.1:6767', await clientConfig(id)), api = createPaseoApi(client);
  await client.connect();
  try { return await action({ client, api, invoke: (rpc, input) => client.invokePluginRpc('orchiva-plugin', rpc.name, input) }); }
  finally { await api.dispose(); await client.close(); }
}
async function waitForResult(client, expectedAttempt, priorResultId, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await client.invokePluginRpc('orchiva-plugin', getRpc.name, { token });
    if (record.status === 'needs-input' || record.commands.some(item => item.status === 'unknown')) return { record, blocked: 'needs-input-or-unknown' };
    if (record.attempt === expectedAttempt && record.result && record.result.id !== priorResultId && ['awaiting-review', 'failed', 'completed'].includes(record.status)) return { record, blocked: null };
    await delay(500);
  }
  return { record: await client.invokePluginRpc('orchiva-plugin', getRpc.name, { token }), blocked: 'timeout' };
}
async function inventory(api) {
  const agents = await api.agents.list(), workspaces = await api.workspaces.list();
  assert.equal(agents.pageInfo.hasMore, false); assert.equal(workspaces.pageInfo.hasMore, false);
  return { agents: agents.entries.length, workspaces: workspaces.entries.length };
}
async function scanMessage(api, agentId, messageId, expectedText) {
  const timeline = api.agents.ref(agentId).timeline, entries = [], visited = new Set(); let cursor, epoch;
  for (let index = 0; index < 20; index++) {
    const page = await timeline.refetch(cursor ?? { direction: 'tail', limit: 100 });
    if (page.gap || page.staleCursor || (index > 0 && page.reset) || (epoch && epoch !== page.epoch)) return { kind: 'unknown', reason: 'timeline gap, reset, or epoch change' };
    epoch = page.epoch; entries.push(...page.entries);
    if (!page.hasOlder) {
      const users = entries.filter(entry => entry.item.type === 'user_message');
      const idMatches = users.filter(entry => entry.item.clientMessageId === messageId);
      const textMatches = users.filter(entry => entry.item.text === expectedText);
      if (idMatches.length > 1 || textMatches.length > 1) return { kind: 'unknown', reason: 'duplicate message id or payload' };
      if (idMatches.length === 1) return idMatches[0].item.text === expectedText ? { kind: 'found', messageId, pages: index + 1 } : { kind: 'unknown', reason: 'message id has a different payload' };
      if (textMatches.length === 1) return { kind: 'found', messageId: textMatches[0].item.clientMessageId ?? null, matchedBy: 'exact payload', pages: index + 1 };
      return { kind: 'absent', complete: true, pages: index + 1, olderMessagesWithoutIds: users.filter(entry => !entry.item.clientMessageId).length };
    }
    if (!page.startCursor) return { kind: 'unknown', reason: 'missing history cursor' };
    const key = JSON.stringify(page.startCursor); if (visited.has(key)) return { kind: 'unknown', reason: 'history cursor did not advance' };
    visited.add(key); cursor = { direction: 'before', cursor: page.startCursor, limit: 100 };
  }
  return { kind: 'unknown', reason: 'history page limit exceeded' };
}

const manifest = savedManifest ?? { runId, token, startedAt: now(), mode: 'actual SDK WebSocket response-frame drop', fixture: 'single M6-owned request; start and resume responses dropped after plugin RPC completion; no proxy outside this client', steps: [] };
assert.equal(manifest.runId, runId); assert.equal(manifest.token, token); assert.notEqual(manifest.result, 'pass');
manifest.retries ??= [];
if (mode === 'resume') manifest.retries.push({ at: now(), reason: 'The first driver stopped after observing the queued accepted start response; the same durable start was not reissued, and its worker effect later settled.' });
if (mode === 'resume-replay') manifest.retries.push({ at: now(), reason: 'The first resume effect is durable with its original message ID; this continuation verifies the same-key response path before a separate effectful resume frame drop.' });
await saveManifest(manifest);

// Prove the transport intercepts an actual SDK response frame before any effectful request.
if (!manifest.steps.some(item => item.id === 'proxy-probe' && item.result === 'pass')) {
  const probe = makeDropClient(`${runId}-d03-probe`);
  await probe.client.connect(); probe.arm();
  const probeCall = callAndDrop(probe.client, diagnosticsRpc, {}, probe.dropped);
  const [dropEvidence] = await Promise.all([probeCall]);
  manifest.steps.push({ id: 'proxy-probe', result: 'pass', ...dropEvidence }); await saveManifest(manifest);
}

if (mode === 'resume-replay') {
  const initial = await normalClient(`${runId}-d03-replay-current`, async ({ api, invoke }) => ({ record: await invoke(getRpc, { token }), inventory: await inventory(api), diagnostics: await invoke(diagnosticsRpc, {}) }));
  assert.equal(initial.diagnostics.activeTokens.length, 0); assert.equal(initial.diagnostics.issues.length, 0);
  let record = initial.record;
  assert.equal(record.attempt, 2); assert.equal(record.recovery?.pending, false);
  const priorResult = record.attempts.find(item => item.attempt === 1)?.result;
  const appliedResume = record.commands.find(item => item.key === `${token}-resume`);
  assert.ok(priorResult?.id && appliedResume?.status === 'applied' && appliedResume.messageId);
  const priorInstruction = record.recovery.instruction, priorMessageText = runtimeMessage(record, priorInstruction);
  const replayInput = { token, key: `${token}-resume`, instruction: priorInstruction, expectedRevision: record.revision, resultId: priorResult.id };
  const priorMessageBefore = await normalClient(`${runId}-d03-replay-message-before`, async ({ api }) => findMessage(api.agents.ref(record.agentId).timeline, appliedResume.messageId, priorMessageText));
  assert.equal(priorMessageBefore.kind, 'found');
  manifest.resumeReplayInput = replayInput; await saveManifest(manifest);
  const replayDrop = makeDropClient(`${runId}-d03-resume-replay-drop`); await replayDrop.client.connect(); replayDrop.arm();
  const droppedReplay = await callAndDrop(replayDrop.client, resumeRpc, replayInput, replayDrop.dropped);
  record = await readRecord(); assert.equal(record.attempt, 2); assert.equal(record.recovery?.pending, false);
  assert.equal(record.commands.filter(item => item.key === replayInput.key).length, 1);
  const priorMessageAfterDrop = await normalClient(`${runId}-d03-replay-message-after-drop`, async ({ api }) => findMessage(api.agents.ref(record.agentId).timeline, appliedResume.messageId, priorMessageText));
  assert.equal(priorMessageAfterDrop.kind, 'found');
  manifest.steps.push({ id: 'resume-response-drop-same-key-replay', result: 'pass', ...droppedReplay, appliedEffectBeforeReplay: true, messageId: appliedResume.messageId, messageBefore: priorMessageBefore, messageAfterDrop: priorMessageAfterDrop, attempt: record.attempt });
  await saveManifest(manifest);

  const resume3Instruction = `Confirm that ${markerPath} still contains ${marker} after the D03 response-loss check. Do not change files, checks, or any other worktree content. Report only the confirmation.`;
  const resume3MessageId = `orchiva-${token}-3`;
  const resume3Text = runtimeMessage(record, resume3Instruction);
  const before3 = await normalClient(`${runId}-d03-attempt3-before`, async ({ api }) => scanMessage(api, record.agentId, resume3MessageId, resume3Text));
  assert.equal(before3.kind, 'absent');
  const result2 = record.result;
  assert.ok(result2?.id);
  const resume3Input = { token, key: `${token}-resume-3`, instruction: resume3Instruction, expectedRevision: record.revision, resultId: result2.id };
  manifest.resume3Input = resume3Input; manifest.resume3MessageBefore = before3; await saveManifest(manifest);
  const drop3 = makeDropClient(`${runId}-d03-resume3-drop`); await drop3.client.connect(); drop3.arm();
  const droppedResume3 = await callAndDrop(drop3.client, resumeRpc, resume3Input, drop3.dropped);
  record = await readRecord();
  const command3 = record.commands.find(item => item.key === resume3Input.key);
  assert.equal(command3?.status, 'applied'); assert.equal(command3?.messageId, resume3MessageId);
  assert.equal(record.attempt, 3); assert.equal(record.agentId, initial.record.agentId); assert.equal(record.workspaceId, initial.record.workspaceId);
  assert.equal(record.recovery?.pending, false);
  const message3AfterDrop = await normalClient(`${runId}-d03-attempt3-message`, async ({ api }) => findMessage(api.agents.ref(record.agentId).timeline, resume3MessageId, resume3Text));
  assert.equal(message3AfterDrop.kind, 'found');
  const replay3 = await normalClient(`${runId}-d03-attempt3-replay`, async ({ api, invoke }) => ({ record: await invoke(resumeRpc, resume3Input), message: await findMessage(api.agents.ref(record.agentId).timeline, resume3MessageId, resume3Text) }));
  assert.equal(replay3.record.attempt, 3); assert.equal(replay3.record.commands.filter(item => item.key === resume3Input.key).length, 1); assert.equal(replay3.message.kind, 'found');
  const finalWait = await normalClient(`${runId}-d03-attempt3-result`, async ({ client }) => waitForResult(client, 3, result2.id));
  assert.equal(finalWait.blocked, null); assert.equal(finalWait.record.attempt, 3); assert.equal(finalWait.record.results.length, 3);
  manifest.steps.push({ id: 'resume-response-drop-after-send', result: 'pass', ...droppedResume3, commandStatusAfterDrop: command3.status, messageId: command3.messageId, messageBefore: before3, messageAfterDrop: message3AfterDrop, messageAfterSameKeyReplay: replay3.message, attempt: replay3.record.attempt });
  manifest.final = { status: finalWait.record.status, attempt: finalWait.record.attempt, results: finalWait.record.results.length, agentId: finalWait.record.agentId, workspaceId: finalWait.record.workspaceId, requestSha256: sha(await readFile(requestPath)), endedAt: now() };
  manifest.result = 'pass'; await saveManifest(manifest);
  console.log(JSON.stringify({ file: manifestPath, result: manifest.result, token, steps: manifest.steps.map(item => ({ id: item.id, result: item.result, callerError: item.callerError ?? null, requestId: item.requestId ?? null })), final: manifest.final }, null, 2));
  process.exit(0);
}

const feature = { title: `M6 D03 ${runId}`, goal: `Create ${markerPath} containing ${marker}, then report the result.`, scope: `One file ${markerPath}.`, constraints: 'Only the registered PoC sandbox Worktree. Do not edit Plugin source, install dependencies, use network, commit, push, or merge.', validation: `Independent file-contains check for ${markerPath}.`, completionCriteria: `${markerPath} contains ${marker}.` };
const criteria = [{ id: 'completion', text: feature.completionCriteria, checkIds: [checkId], manualMethod: '', legacy: false }];
const checks = [{ id: checkId, kind: 'file-contains', path: markerPath, text: marker, label: 'M6 D03 response-drop marker' }];
const current = await normalClient(`${runId}-d03-current`, async ({ api, invoke }) => ({ record: await invoke(getRpc, { token }).catch(() => null), inventory: await inventory(api), diagnostics: await invoke(diagnosticsRpc, {}) }));
assert.equal(current.diagnostics.activeTokens.length, 0); assert.equal(current.diagnostics.issues.length, 0);
const before = manifest.before ?? current;
if (!manifest.before) { manifest.before = before; await saveManifest(manifest); }
let record = current.record, startInput;
if (mode === 'resume') {
  assert.ok(record?.agentId && record.workspaceId && record.result?.id); assert.equal(record.status, 'awaiting-review'); assert.equal(record.attempt, 1);
  assert.ok(record.commands.some(item => item.key === `${token}-start` && item.status === 'applied'));
  const plan = record.plans.at(-1);
  startInput = { token, commandKey: `${token}-start`, expectedRevision: record.revision, planRevision: plan.revision, inputHash: plan.inputHash };
} else {
  const setup = makeDropClient(`${runId}-d03-setup`); await setup.client.connect();
  record = await setup.client.invokePluginRpc('orchiva-plugin', saveDraftRpc.name, { token, commandKey: `${token}-save`, expectedRevision: 0, feature, criteria, checks });
  record = await setup.client.invokePluginRpc('orchiva-plugin', preparePlanRpc.name, { token, commandKey: `${token}-plan`, expectedRevision: record.revision });
  const plan = record.plans.at(-1);
  startInput = { token, commandKey: `${token}-start`, expectedRevision: record.revision, planRevision: plan.revision, inputHash: plan.inputHash };
  await setup.client.close();
}
manifest.startInput = startInput; await saveManifest(manifest);

async function waitForStartEffect(timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const saved = await readRecord(), command = saved.commands.find(item => item.key === startInput.commandKey);
    if (command?.status === 'applied' && saved.agentId && saved.workspaceId) return saved;
    if (command?.status === 'unknown' || saved.status === 'needs-input' || saved.status === 'failed') return saved;
    await delay(500);
  }
  return readRecord();
}

const dropStart = makeDropClient(`${runId}-d03-start-drop-${mode ?? 'fresh'}`); await dropStart.client.connect(); dropStart.arm();
const droppedStart = await callAndDrop(dropStart.client, startRpc, startInput, dropStart.dropped);
record = await waitForStartEffect();
const startCommand = record.commands.find(item => item.key === startInput.commandKey);
assert.equal(startCommand?.status, 'applied', 'Worker effect did not settle after the accepted start response was dropped.');
assert.ok(record.agentId && record.workspaceId);
const afterStart = await normalClient(`${runId}-d03-check-start`, async ({ api, invoke }) => ({ record: await invoke(getRpc, { token }), inventory: await inventory(api) }));
assert.equal(afterStart.record.agentId, record.agentId); assert.equal(afterStart.record.workspaceId, record.workspaceId);
assert.equal(afterStart.inventory.agents, before.inventory.agents + 1); assert.equal(afterStart.inventory.workspaces, before.inventory.workspaces + 1);
const replayStart = await normalClient(`${runId}-d03-replay-start`, async ({ api, invoke }) => ({ record: await invoke(startRpc, startInput), inventory: await inventory(api) }));
assert.equal(replayStart.record.agentId, record.agentId); assert.equal(replayStart.record.workspaceId, record.workspaceId);
assert.deepEqual(replayStart.inventory, afterStart.inventory, 'Same-key start replay created another resource.');
manifest.steps.push({ id: mode === 'resume' ? 'start-response-drop-after-effect' : 'start-accepted-response-drop', result: mode === 'resume' ? 'pass' : 'partial', effectOrdering: 'start returns a durable accepted intent before the background worker creates the Agent; the same key is replayed only after the effect is confirmed', ...droppedStart, commandStatusAfterDrop: startCommand.status, agentId: record.agentId, workspaceId: record.workspaceId, inventoryBefore: before.inventory, inventoryAfter: afterStart.inventory, replayInventory: replayStart.inventory });
await saveManifest(manifest);

const startWait = await normalClient(`${runId}-d03-wait-start`, async ({ client }) => waitForResult(client, 1, null));
assert.equal(startWait.blocked, null, `First result did not settle: ${startWait.blocked}`);
record = startWait.record;
const startResult = record.result, agentId = record.agentId, workspaceId = record.workspaceId;
assert.ok(startResult?.id); assert.equal(record.attempt, 1);
const resumeInstruction = `Confirm that ${markerPath} still contains ${marker}. Do not change files, checks, or any other worktree content. Report only the confirmation.`;
const resumeMessageText = runtimeMessage(record, resumeInstruction);
const agentTimeline = async () => normalClient(`${runId}-d03-timeline`, async ({ api }) => findMessage(api.agents.ref(agentId).timeline, `orchiva-${token}-2`, resumeMessageText));
const messageBefore = await normalClient(`${runId}-d03-message-before`, async ({ api }) => scanMessage(api, agentId, `orchiva-${token}-2`, resumeMessageText));
assert.equal(messageBefore.kind, 'absent', 'Resume message already exists before the D03 effect.');
const resumeInput = { token, key: `${token}-resume`, instruction: resumeInstruction, expectedRevision: record.revision, resultId: startResult.id };
const dropResume = makeDropClient(`${runId}-d03-resume`);
await dropResume.client.connect();
const droppedResume = await callAndDrop(dropResume.client, resumeRpc, resumeInput, dropResume.dropped);
record = await readRecord();
const resumeCommand = record.commands.find(item => item.key === resumeInput.key);
assert.equal(resumeCommand?.status, 'applied', 'Resume effect must be durable before the response frame is dropped.');
assert.equal(record.attempt, 2); assert.equal(record.agentId, agentId); assert.equal(record.workspaceId, workspaceId);
assert.equal(record.recovery?.pending, false);
const messageAfterDrop = await agentTimeline(); assert.equal(messageAfterDrop.kind, 'found');
const replayResume = await normalClient(`${runId}-d03-replay-resume`, async ({ api, invoke }) => ({ record: await invoke(resumeRpc, resumeInput), message: await findMessage(api.agents.ref(agentId).timeline, resumeCommand.messageId, resumeMessageText) }));
assert.equal(replayResume.record.commands.filter(item => item.key === resumeInput.key).length, 1);
assert.equal(replayResume.record.agentId, agentId); assert.equal(replayResume.record.workspaceId, workspaceId);
assert.equal(replayResume.record.attempt, 2); assert.equal(replayResume.message.kind, 'found', 'Same-key replay must not create a duplicate message.');
manifest.steps.push({ id: 'resume-response-drop', result: 'pass', ...droppedResume, commandStatusAfterDrop: resumeCommand.status, messageId: resumeCommand.messageId, messageBefore, messageAfterDrop, messageAfterSameKeyReplay: replayResume.message, agentId, workspaceId, attemptAfterReplay: replayResume.record.attempt });
await saveManifest(manifest);

const final = await normalClient(`${runId}-d03-final`, async ({ client, invoke, api }) => {
  const waited = await waitForResult(client, 2, startResult.id);
  return { waited, inventory: await inventory(api), diagnostics: await invoke(diagnosticsRpc, {}) };
});
assert.equal(final.waited.blocked, null); assert.equal(final.waited.record.agentId, agentId); assert.equal(final.waited.record.workspaceId, workspaceId);
assert.equal(final.waited.record.attempt, 2); assert.equal(final.waited.record.results.length, 2);
assert.equal(final.inventory.agents, before.inventory.agents + 1); assert.equal(final.inventory.workspaces, before.inventory.workspaces + 1);
assert.equal(final.diagnostics.activeTokens.length, 0); assert.equal(final.diagnostics.issues.length, 0);
manifest.final = { status: final.waited.record.status, attempt: final.waited.record.attempt, firstResultId: startResult.id, finalResultId: final.waited.record.result?.id, agentId, workspaceId, inventory: final.inventory, diagnostics: final.diagnostics, requestSha256: sha(await readFile(requestPath)), endedAt: now() };
manifest.result = 'pass'; await saveManifest(manifest);
console.log(JSON.stringify({ file: manifestPath, result: manifest.result, token, steps: manifest.steps.map(item => ({ id: item.id, requestId: item.requestId ?? null, callerError: item.callerError ?? null })), final: manifest.final }, null, 2));
