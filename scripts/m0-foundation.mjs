import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { TrackExecution } from '../server/application/track-execution.ts';
import { RequestLocks } from '../server/application/request-locks.ts';
import { JsonRequestStore } from '../server/adapters/storage/json-request-store.ts';
import { PaseoRuntime } from '../server/adapters/paseo/runtime.ts';
import { createRequest } from '../server/domain/request.ts';
import { performEffect } from '../server/application/effect-checkpoint.ts';
import { localConnection } from '../server/adapters/paseo/connection.ts';
import { createPinnedWorkspace } from '../server/adapters/paseo/pinned-workspace.ts';
import { findMessage, reconcileCandidates } from '../server/adapters/paseo/reconciliation.ts';
import { loadConfig } from '../server/config/project-config.ts';
import { responseDropProxy } from './m0-response-proxy.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const [action = 'help', ...args] = process.argv.slice(2);
const runId = args.includes('--run-id') ? args[args.indexOf('--run-id') + 1] : undefined;
const commands = ['init', 'inspect', 'workspace', 'agent', 'send', 'verify', 'probe-on', 'probe-off', 'probe-report', 'replay', 'fault-workspace', 'fault-agent', 'fault-message', 'verify-faults', 'base-ref', 'conflicts', 'assert-idle', 'wait', 'connection-failure', 'crash', 'crash-child', 'verify-crash', 'history', 'verify-uncertain', 'audit-legacy-refresh'];
if (action === 'help') { console.log(`M0 probe (explicit actions only): ${commands.join(', ')} --run-id m0-<unique-id>`); process.exit(0); }
assert.ok(commands.includes(action), 'Unknown action');
assert.match(runId ?? '', /^m0-[a-zA-Z0-9-]{8,80}$/);
const root = join(homedir(), '.orchiva');
const directory = join(root, 'm0', runId);
const manifestPath = join(directory, 'manifest.json');
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const git = (cwd, ...argv) => execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8', windowsHide: true }).trim();
const config = await loadConfig();
let manifest;
const persist = async () => {
  const temp = `${manifestPath}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(manifest, null, 2), 'utf8'); await rename(temp, manifestPath);
};
const record = async (kind, data) => { manifest.evidence.push({ kind, at: new Date().toISOString(), ...data }); await persist(); };
const effectStore = {
  read: async key => manifest.effects[key] ?? null,
  write: async checkpoint => { manifest.effects[checkpoint.key] = checkpoint; await persist(); },
};
async function baseline() {
  const snapshots = [];
  for (const filename of (await readdir(join(root, 'requests'))).filter(name => name.endsWith('.json')).sort()) {
    const value = JSON.parse(await readFile(join(root, 'requests', filename), 'utf8'));
    const { token, id, taskId, feature, workspaceId, agentId, worktreePath, requestPlan, taskPlan, attempt, result, attempts, decision, checks } = value;
    const immutable = { token, id, taskId, feature, workspaceId, agentId, worktreePath, requestPlan, taskPlan, attempt, result, attempts, decision, checks };
    const files = {}, fileSha256 = {};
    for (const path of ['feature.test.mjs', 'POC_PROOF.md', 'GUI_PROOF.md']) {
      try { const bytes = await readFile(join(worktreePath, path)); files[path] = hash(bytes); fileSha256[path] = createHash('sha256').update(bytes).digest('hex'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    snapshots.push({ token, agentId, workspaceId, hash: hash(immutable), files, fileSha256 });
  }
  return snapshots;
}
if (action === 'init') {
  await mkdir(directory, { recursive: true });
  // Never replace a previous run's intent or evidence.
  manifest = { runId, createdAt: new Date().toISOString(), sourceCommit: git(process.cwd(), 'rev-parse', 'HEAD'), baseCommit: git(config.repositoryPath, 'rev-parse', 'main'), original: await baseline(), effects: {}, evidence: [] };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  const backups = join(directory, 'original-requests'); await mkdir(backups);
  for (const original of manifest.original) await writeFile(join(backups, `${original.token}.json`), await readFile(join(root, 'requests', `${original.token}.json`)), { flag: 'wx' });
} else manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.runId, runId);
const owner = localConnection(`orchiva-${runId}-${action}`);
try {
  if (action === 'audit-legacy-refresh') {
    // An explicit audit for the two legacy unreviewed fixtures. Never adjusts completed evidence.
    assert.ok(!manifest.legacyRefresh, 'A recorded baseline exception cannot be silently overwritten');
    assert.ok(manifest.original.every(x => !x.fileSha256), 'This one-time audit is only for the original pre-snapshot manifest');
    const current = await baseline();
    const changes = [];
    for (const before of manifest.original) {
      const after = current.find(x => x.token === before.token); assert.ok(after);
      assert.equal(after.agentId, before.agentId); assert.equal(after.workspaceId, before.workspaceId); assert.deepEqual(after.files, before.files);
      if (after.hash === before.hash) continue;
      assert.ok(['mwcyphtz-fnthmzhhky', 'smoke-20261112-001'].includes(before.token));
      const request = JSON.parse(await readFile(join(root, 'requests', `${before.token}.json`), 'utf8'));
      assert.equal(request.status, 'awaiting-review'); assert.equal(request.decision, null); assert.equal(request.attempt, 1); assert.equal(request.checks.length, 0);
      for (const plan of [request.requestPlan, request.taskPlan]) assert.equal(await readFile(join(request.worktreePath, '.orchiva', 'plans', `${plan.id}.md`), 'utf8'), plan.content);
      changes.push({ token: before.token, previousHash: before.hash, currentHash: after.hash, resultId: request.result.id, collectedAt: request.result.collectedAt, reason: 'Legacy request.list recollected unreviewed results after timeline restoration; previous result envelope was not backed up. Original fixture files and IDs match.' });
    }
    const backups = join(directory, 'post-regression-requests'); await mkdir(backups);
    for (const row of current) await writeFile(join(backups, `${row.token}.json`), await readFile(join(root, 'requests', `${row.token}.json`)), { flag: 'wx' });
    manifest.legacyRefresh = changes; await record('legacy-result-refresh-audited', { changes, fileSha256: current.map(x => ({ token: x.token, files: x.fileSha256 })) });
  } else if (action === 'connection-failure') {
    const failed = localConnection(`${runId}-offline`, '127.0.0.1:1');
    let succeeded = false;
    const result = failed.start().then(() => { succeeded = true; }, () => {});
    await delay(100); await failed.dispose(); await result; await failed.dispose();
    assert.equal(failed.state, 'disposed'); assert.equal(succeeded, false);
    await record('connection-failure-disposed', { state: failed.state });
  } else if (action === 'probe-on') {
    assert.ok(manifest.agentId);
    await writeFile(join(root, 'm0-probe.json'), JSON.stringify({ runId, agentId: manifest.agentId }), { flag: 'wx' });
    await record('probe-enabled', {});
  } else if (action === 'probe-off') {
    const settings = JSON.parse(await readFile(join(root, 'm0-probe.json'), 'utf8'));
    assert.equal(settings.runId, runId); await unlink(join(root, 'm0-probe.json')); await record('probe-disabled', {});
  } else if (action === 'probe-report') {
    const events = (await readFile(join(directory, 'plugin.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const generations = [...new Set(events.map(event => event.generation))].map(generation => {
      const group = events.filter(event => event.generation === generation);
      const observations = group.filter(x => x.event === 'observed');
      return { generation, pid: group[0].pid, start: group[0].at, observations: observations.length, firstRpcCalls: observations[0]?.rpcCalls, closed: group.some(x => x.event === 'closed'), closedAt: group.find(x => x.event === 'closed')?.at, failed: group.some(x => x.event === 'failed') };
    });
    for (const generation of generations) { assert.ok(generation.observations > 0 && !generation.failed); assert.equal(generation.firstRpcCalls, 0); }
    try { await readFile(join(root, 'm0-probe.json')); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      assert.ok(generations.every(g => g.closed));
      const before = await readFile(join(directory, 'plugin.jsonl'), 'utf8'); await delay(1500);
      assert.equal(await readFile(join(directory, 'plugin.jsonl'), 'utf8'), before, 'Disposed probe still writes');
    }
    await record('probe-generations', { generations }); console.log(JSON.stringify(generations));
  } else {
    const api = await owner.start();
    const agentsPage = await api.agents.list();
    const workspacesPage = await api.workspaces.list();
    if (action === 'verify-uncertain') {
      const store = new JsonRequestStore(join(directory, 'pending-requests'));
      const token = `${runId}-pending`;
      let request = await store.get(token);
      if (!request) {
        request = createRequest(token, { title: 'M0 pending delivery', goal: 'Observe uncertain recovery', scope: 'Read-only observation', constraints: 'No resend', validation: 'No duplicate user message', completionCriteria: 'Pending checkpoint retained' });
        request.agentId = manifest.agentId; request.workspaceId = manifest.workspaceId; request.worktreePath = manifest.worktreePath;
        request.attempt = 2; request.status = 'needs-input';
        request.recovery = { key: `${runId}-pending-key`, messageId: manifest.faults.message.intent.messageId, instruction: manifest.faults.message.intent.text, pending: true };
        await store.save(request);
      }
      const agent = api.agents.ref(manifest.agentId);
      const before = await agent.timeline.refetch({ direction: 'tail', limit: 100 });
      const tracker = new TrackExecution(store, new RequestLocks()), runtime = new PaseoRuntime(api, config);
      for (let i = 0; i < 2; i++) {
        const state = await tracker.refresh(token, runtime);
        assert.equal(state.status, 'needs-input'); assert.equal(state.recovery.pending, true); assert.equal(state.attempt, 2);
      }
      await assert.rejects(tracker.resume({ token, key: `${runId}-replacement`, instruction: 'Must not send' }, runtime), /pending recovery/);
      const after = await agent.timeline.refetch({ direction: 'tail', limit: 100 });
      assert.deepEqual(after.entries, before.entries);
      await record('live-uncertain-held', { token, agentId: manifest.agentId, attempt: 2, noResend: true, newInstructionRejected: true });
    }
    if (action === 'history') {
      const history = await api.agents.ref(manifest.agentId).timeline.refetch({ direction: 'tail', limit: 100 });
      console.log(JSON.stringify({ epoch: history.epoch, gap: history.gap, hasOlder: history.hasOlder, items: history.entries.filter(e => e.item.type === 'user_message').map(e => ({ seq: e.seqEnd, turnId: e.turnId, item: e.item })) }, null, 2));
    }
    if (action === 'wait') {
      const agent = api.agents.ref(manifest.agentId); await agent.refresh();
      if (agent.activeTurn || ['running', 'initializing'].includes(agent.status)) await agent.waitForFinish(45000);
      await agent.refresh(); assert.ok(!agent.activeTurn && !agent.pendingPermissions?.length); assert.notEqual(agent.status, 'error');
    }
    if (action === 'crash-child') {
      assert.ok(process.send, 'Internal crash child requires an IPC parent');
      await api.agents.ref(manifest.agentId).send(manifest.crash.text, { messageId: manifest.crash.messageId });
      process.send({ boundary: 'B3', pid: process.pid });
      // Parent kills this owned process before it can persist an acknowledgement.
      await new Promise(() => {});
    }
    if (action === 'crash') {
      assert.ok(!manifest.crash, 'Existing crash must be reconciled');
      assert.ok(!agentsPage.pageInfo.hasMore && agentsPage.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length));
      manifest.crash = { messageId: `${runId}-crash-message`, text: 'M0 process crash probe. No tools or file changes. Reply M0_CRASH_OK and stop.', state: 'pending', at: new Date().toISOString() };
      await persist();
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), 'crash-child', '--run-id', runId], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let timer;
      const exit = once(child, 'exit');
      try {
        const received = await Promise.race([once(child, 'message'), exit.then(() => { throw Error('Crash child exited before the boundary'); }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Crash boundary timeout')), 45000); })]);
        clearTimeout(timer); assert.equal(received[0].pid, child.pid); assert.equal(received[0].boundary, 'B3');
        manifest.crash.pid = child.pid; manifest.crash.boundary = 'B3'; await persist();
        assert.ok(child.kill('SIGKILL')); const ended = await exit;
        await record('owned-process-killed', { pid: child.pid, exit: ended, boundary: 'B3', checkpoint: manifest.crash.state });
      } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    }
    if (action === 'verify-crash') {
      assert.ok(manifest.crash);
      const found = await findMessage(api.agents.ref(manifest.agentId).timeline, manifest.crash.messageId, manifest.crash.text);
      assert.ok(['found', 'unknown'].includes(found.kind));
      const history = await api.agents.ref(manifest.agentId).timeline.refetch({ direction: 'tail', limit: 100 });
      assert.equal(history.hasOlder, false);
      assert.equal(history.entries.filter(e => e.item.type === 'user_message' && e.item.text === manifest.crash.text).length, 1);
      manifest.crash.state = found.kind === 'found' ? 'reconciled' : 'unknown';
      await record('crash-reconciled', { messageId: manifest.crash.messageId, delivery: found.kind, noResend: true, fixtureTextCount: 1 });
    }
    if (action === 'assert-idle' || action.startsWith('fault-') || action === 'conflicts') {
      assert.ok(!agentsPage.pageInfo.hasMore && agentsPage.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(agent.status)), 'Active or unobserved work exists');
    }
    if (action.startsWith('fault-')) {
      const kind = action.slice(6);
      const responseType = kind === 'message' ? 'send_agent_message_response' : `${kind}.create.response`;
      manifest.faults ??= {};
      if (manifest.faults[kind] && args.includes('--retry-fixture')) {
        assert.ok(!manifest.faults[kind].dropped?.length, 'Successful fault injection must be reconciled, not replaced');
        manifest.faultHistory ??= [];
        manifest.faultHistory.push({ ...manifest.faults[kind], testFailure: 'Response proxy did not intercept session envelope; original intent preserved.' });
        delete manifest.faults[kind]; await persist();
      }
      assert.ok(!manifest.faults[kind], 'Use verify-faults to reconcile an existing fault; do not overwrite intent');
      const suffix = manifest.faultHistory?.length ? `-${manifest.faultHistory.length + 1}` : '';
      const intent = kind === 'workspace'
        ? { key: `${runId}-lost-workspace${suffix}`, title: `${runId}-lost${suffix}`, branch: `orchiva/${runId}-lost${suffix}`, commit: manifest.baseCommit }
        : kind === 'agent'
          ? { idempotencyKey: `${runId}-lost-agent`, title: `${runId}-lost`, labels: { orchivaM0: `${runId}-lost` }, config: { provider: config.provider } }
          : { messageId: `${runId}-lost-message`, text: 'M0 lost response probe. No tools or file changes. Reply M0_LOST_OK and stop.' };
      const checkpoint = { kind, intent, payloadHash: hash(intent), state: 'pending', at: new Date().toISOString() };
      manifest.faults[kind] = checkpoint; await persist();
      const proxy = await responseDropProxy(responseType);
      const faultOwner = localConnection(`orchiva-${runId}-fault-${kind}`, proxy.endpoint);
      let settled = false;
      try {
        const faultApi = await faultOwner.start();
        const effect = performEffect({ key: `fault-${kind}`, payloadHash: checkpoint.payloadHash }, effectStore, {
          lookup: async () => ({ kind: 'unknown', reason: 'Explicit recovery requires an independent observer.' }),
          apply: async () => {
            if (kind === 'workspace') return (await createPinnedWorkspace(faultApi, config, intent)).id;
            if (kind === 'agent') return (await faultApi.workspaces.ref(manifest.workspaceId).agents.create(intent)).id;
            await faultApi.agents.ref(manifest.agentId).send(intent.text, { messageId: intent.messageId }); return intent.messageId;
          },
        });
        const handled = effect.then(() => { settled = true; }, () => { settled = true; });
        const deadline = Date.now() + 45000;
        while (!proxy.dropped.length && Date.now() < deadline && !settled) await delay(100);
        assert.ok(proxy.dropped.length, 'Expected response was not intercepted');
        assert.equal(settled, false, 'Response reached the caller');
        let observed;
        if (kind === 'workspace') {
          const page = await api.workspaces.list();
          observed = reconcileCandidates(page.entries, w => w.title === intent.title, !page.pageInfo.hasMore);
          assert.equal(observed.kind, 'found'); checkpoint.resourceId = observed.value.id;
        } else if (kind === 'agent') {
          const page = await api.agents.list();
          observed = reconcileCandidates(page.entries.map(x => x.agent), a => a.labels?.orchivaM0 === `${runId}-lost` && a.workspaceId === manifest.workspaceId, !page.pageInfo.hasMore);
          assert.equal(observed.kind, 'found'); checkpoint.resourceId = observed.value.id;
        } else {
          observed = await findMessage(api.agents.ref(manifest.agentId).timeline, intent.messageId, intent.text);
          assert.equal(observed.kind, 'found'); checkpoint.resourceId = manifest.agentId;
        }
        checkpoint.state = 'unknown'; checkpoint.dropped = proxy.dropped; checkpoint.independentObservation = observed.kind;
        await persist();
        await record('response-dropped', { kind, responseType, callerSettled: settled, resourceId: checkpoint.resourceId, independentObservation: observed.kind });
        await faultOwner.dispose(); await handled;
      } finally { await faultOwner.dispose(); await proxy.close(); }
    }
    if (action === 'verify-faults') {
      for (const [kind, checkpoint] of Object.entries(manifest.faults ?? {})) {
        const { intent } = checkpoint;
        assert.equal(hash(intent), checkpoint.payloadHash);
        if (kind === 'workspace') {
          const before = await api.workspaces.list();
          assert.equal(before.entries.filter(w => w.title === intent.title).length, 1); assert.equal(before.pageInfo.hasMore, false);
          const workspace = await createPinnedWorkspace(api, config, intent); assert.equal(workspace.id, checkpoint.resourceId);
          const after = await api.workspaces.list(); assert.equal(after.entries.length, before.entries.length);
        } else if (kind === 'agent') {
          const before = await api.agents.list(); assert.equal(before.pageInfo.hasMore, false);
          assert.equal(before.entries.filter(({ agent }) => agent.labels?.orchivaM0 === `${runId}-lost`).length, 1);
          const agent = await api.workspaces.ref(manifest.workspaceId).agents.create(intent); assert.equal(agent.id, checkpoint.resourceId);
          const after = await api.agents.list(); assert.equal(after.entries.length, before.entries.length);
        } else {
          const agent = api.agents.ref(manifest.agentId); await agent.refresh(); assert.ok(!agent.activeTurn);
          const found = await findMessage(agent.timeline, intent.messageId, intent.text);
          assert.ok(['found', 'unknown'].includes(found.kind));
          checkpoint.delivery = found.kind;
          // Text counts establish fixture integrity, never delivery identity for a retry.
          const history = await agent.timeline.refetch({ direction: 'tail', limit: 100 });
          assert.equal(history.hasOlder, false, 'Count requires complete history');
          assert.equal(history.entries.filter(e => e.item.type === 'user_message' && e.item.text === intent.text).length, 1);
        }
        checkpoint.state = checkpoint.delivery === 'unknown' ? 'unknown' : 'reconciled'; await persist();
        const effectInput = { key: `fault-${kind}`, payloadHash: checkpoint.payloadHash };
        if (!manifest.effects[effectInput.key]) await effectStore.write({ ...effectInput, state: 'unknown' });
        const restored = await performEffect(effectInput, effectStore, {
          lookup: async () => kind === 'message'
            ? (await findMessage(api.agents.ref(manifest.agentId).timeline, intent.messageId, intent.text)).kind === 'found'
              ? { kind: 'found', value: intent.messageId } : { kind: 'unknown', reason: 'Restored message identity unavailable' }
            : { kind: 'found', value: checkpoint.resourceId },
          apply: async () => { throw Error('Recovery must not repeat the effect'); },
        });
        assert.equal(restored.kind, checkpoint.delivery === 'unknown' ? 'unknown' : 'found');
        await record('fault-reconciled', { kind, resourceId: checkpoint.resourceId, delivery: checkpoint.delivery ?? 'found', noDuplicate: true, noMessageResend: kind === 'message' });
      }
    }
    if (action === 'base-ref') {
      const ref = `refs/heads/orchiva/${runId}-moving`;
      const old = git(config.repositoryPath, 'rev-parse', `${manifest.baseCommit}^`);
      git(config.repositoryPath, 'update-ref', ref, old);
      try {
        const confirmed = git(config.repositoryPath, 'rev-parse', ref);
        git(config.repositoryPath, 'update-ref', ref, manifest.baseCommit, old);
        const workspace = await createPinnedWorkspace(api, config, { key: `${runId}-pinned`, title: `${runId}-pinned`, branch: `orchiva/${runId}-pinned`, commit: confirmed });
        const head = git(workspace.directory, 'rev-parse', 'HEAD'); assert.equal(head, confirmed); assert.notEqual(head, git(config.repositoryPath, 'rev-parse', ref));
        await record('moving-ref-pinned', { workspaceId: workspace.id, confirmed, movedTo: manifest.baseCommit, head });
      } finally { git(config.repositoryPath, 'update-ref', '-d', ref, manifest.baseCommit); }
    }
    if (action === 'conflicts') {
      const workspace = manifest.workspaceIntent;
      await assert.rejects(createPinnedWorkspace(api, config, { ...workspace, title: `${runId}-changed` }));
      await assert.rejects(api.workspaces.ref(manifest.workspaceId).agents.create({ ...manifest.agentIntent, title: `${runId}-changed` }));
      let messageConflict;
      try { await api.agents.ref(manifest.agentId).send('DIFFERENT M0 PAYLOAD', { messageId: manifest.messageIntent.messageId }); messageConflict = 'accepted-replay'; }
      catch { messageConflict = 'rejected'; }
      await record('payload-conflicts', { workspace: 'rejected', agent: 'rejected', message: messageConflict });
    }
    if (['init', 'inspect'].includes(action)) {
      console.log(JSON.stringify({ agents: agentsPage.entries.map(({ agent }) => ({ id: agent.id, title: agent.title, status: agent.status, active: !!agent.activeTurn, permissions: agent.pendingPermissions?.length ?? 0 })), agentPage: agentsPage.pageInfo, workspaces: workspacesPage.entries.map(w => ({ id: w.id, title: w.title })), workspacePage: workspacesPage.pageInfo }, null, 2));
      await record('connected', { agents: agentsPage.entries.length, workspaces: workspacesPage.entries.length });
    }
    if (action === 'workspace') {
      assert.ok(!agentsPage.pageInfo.hasMore && agentsPage.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length), 'Active or unobserved work exists');
      const intent = { key: `${runId}-workspace`, title: runId, branch: `orchiva/${runId}`, commit: manifest.baseCommit };
      if (manifest.workspaceIntent) assert.deepEqual(manifest.workspaceIntent, intent);
      else { manifest.workspaceIntent = intent; await persist(); }
      const workspace = await createPinnedWorkspace(api, config, intent);
      if (manifest.workspaceId) assert.equal(workspace.id, manifest.workspaceId);
      manifest.workspaceId = workspace.id; manifest.worktreePath = workspace.directory; await persist();
      await record('workspace', { workspaceId: workspace.id, head: git(workspace.directory, 'rev-parse', 'HEAD') });
    }
    if (action === 'agent') {
      assert.ok(manifest.workspaceId);
      const intent = { idempotencyKey: `${runId}-agent`, title: runId, labels: { orchivaM0: runId }, config: { provider: config.provider },
        prompt: `This is an Orchiva M0 connectivity probe. Stay in this sandbox worktree. Do not access other repositories, change files, commit, push, merge, or use network. Reply exactly M0_READY and stop.` };
      if (manifest.agentIntent) assert.deepEqual(manifest.agentIntent, intent);
      else { manifest.agentIntent = intent; await persist(); }
      const agent = await api.workspaces.ref(manifest.workspaceId).agents.create(intent);
      if (manifest.agentId) assert.equal(agent.id, manifest.agentId);
      manifest.agentId = agent.id; await persist(); await record('agent', { agentId: agent.id });
    }
    if (action === 'send') {
      const agent = api.agents.ref(manifest.agentId); await agent.refresh(); assert.ok(!agent.activeTurn && !agent.pendingPermissions?.length);
      const text = 'M0 recovery delivery probe. No tools or file changes. Reply exactly M0_RECOVERED and stop.';
      const intent = { text, messageId: `${runId}-message` };
      if (manifest.messageIntent) assert.deepEqual(manifest.messageIntent, intent);
      else { manifest.messageIntent = intent; await persist(); }
      await agent.send(text, { messageId: intent.messageId });
      await record('sent', { messageId: intent.messageId });
    }
    if (action === 'replay') {
      assert.ok(manifest.messageIntent);
      const workspace = await createPinnedWorkspace(api, config, manifest.workspaceIntent); assert.equal(workspace.id, manifest.workspaceId);
      const agent = await api.workspaces.ref(manifest.workspaceId).agents.create(manifest.agentIntent); assert.equal(agent.id, manifest.agentId);
      await agent.refresh(); assert.ok(!agent.activeTurn && !agent.pendingPermissions?.length);
      await agent.send(manifest.messageIntent.text, { messageId: manifest.messageIntent.messageId });
      await record('replayed', { workspaceId: workspace.id, agentId: agent.id, messageId: manifest.messageIntent.messageId });
    }
    if (action === 'verify') {
      const current = await baseline(); assert.equal(current.length, manifest.original.length);
      for (const original of manifest.original) {
        const actual = current.find(x => x.token === original.token); assert.ok(actual);
        assert.equal(actual.agentId, original.agentId); assert.equal(actual.workspaceId, original.workspaceId); assert.deepEqual(actual.files, original.files);
        if (original.fileSha256) assert.deepEqual(actual.fileSha256, original.fileSha256);
        const acknowledged = manifest.legacyRefresh?.find(x => x.token === original.token);
        assert.equal(actual.hash, acknowledged?.currentHash ?? original.hash, 'Original PoC evidence changed');
      }
      const workspace = api.workspaces.ref(manifest.workspaceId); await workspace.refresh();
      assert.equal(workspace.directory, manifest.worktreePath); assert.equal(git(workspace.directory, 'rev-parse', 'HEAD'), manifest.baseCommit);
      const agent = api.agents.ref(manifest.agentId); await agent.refresh(); assert.equal(agent.workspaceId, manifest.workspaceId);
      const message = manifest.messageIntent ? await findMessage(agent.timeline, manifest.messageIntent.messageId, manifest.messageIntent.text) : null;
      if (message) assert.ok(['found', 'unknown'].includes(message.kind));
      const first = await agent.timeline.refetch({ direction: 'tail', limit: 100 });
      const older = first.startCursor ? await agent.timeline.refetch({ direction: 'before', cursor: first.startCursor, limit: 100 }) : null;
      assert.equal(first.hasOlder, false, 'Fixture count requires complete history');
      const count = first.entries.filter(entry => entry.item.type === 'user_message' && entry.item.text === manifest.messageIntent?.text).length;
      if (manifest.messageIntent) assert.equal(count, 1, 'Duplicate recovery message');
      await record('verified', { workspaceId: workspace.id, agentId: agent.id, message, messageCount: count, olderPageSupported: !!older, status: agent.status, activeTurn: !!agent.activeTurn });
    }
  }
  console.log(`${action}: PASS (${runId})`);
} finally { await owner.dispose(); }
