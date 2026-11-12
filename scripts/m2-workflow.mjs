import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { JsonRequestStore } from '../server/adapters/storage/json-request-store.ts';
import { DraftRequest } from '../server/application/draft-request.ts';
import { StartFeatureRequest } from '../server/application/start-feature-request.ts';
import { PaseoRuntime } from '../server/adapters/paseo/runtime.ts';
import { loadConfig } from '../server/config/project-config.ts';

const [action = 'help', runId] = process.argv.slice(2);
if (action === 'help') { console.log('npm run m2 -- init|prepare|start|ref-check|verify m2-<unique-run-id>\ninit backs up existing JSON; prepare creates a draft/plan only; start creates ONE sandbox agent; verify waits and collects its evidence. GUI may perform start instead.'); process.exit(0); }
assert.ok(['init','prepare','start','ref-check','verify'].includes(action)); assert.match(runId ?? '', /^m2-[a-z0-9-]{8,70}$/);
const root = join(homedir(), '.orchiva'), directory = join(root, 'm2', runId), manifestPath = join(directory, 'manifest.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, encoding: 'utf8' }).trim();
const client = createHostClient('127.0.0.1:6767', { clientId: runId, clientType: 'cli', appVersion: '0.15.4', localCredential: async () => (await readFile(join(homedir(), '.paseo-orchiva/local-credential'), 'utf8')).trim(), reconnect: { enabled: false } });
const api = createPaseoApi(client), rpc = (name, input) => client.invokePluginRpc('orchiva-plugin', name, input);
let manifest;
const persist = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2));
try {
  await client.connect();
  const agents = await api.agents.list(), workspaces = await api.workspaces.list();
  assert.ok(!agents.pageInfo.hasMore && !workspaces.pageInfo.hasMore);
  if (action === 'init') {
    assert.ok(agents.entries.every(({agent}) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running','initializing'].includes(agent.status)), 'Active work exists');
    await mkdir(join(directory, 'original-requests'), { recursive: true });
    const originals = [];
    for (const file of (await readdir(join(root, 'requests'))).filter(x=>x.endsWith('.json'))) {
      const bytes = await readFile(join(root, 'requests', file)); await writeFile(join(directory, 'original-requests', file), bytes, { flag: 'wx' }); originals.push({ file, sha256: sha(bytes) });
    }
    manifest = { runId, at: new Date().toISOString(), baseline: git(process.cwd(), 'rev-parse', 'HEAD'), originals, agents: agents.entries.length, workspaces: workspaces.entries.length, token: `${runId}-request` };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  } else {
    manifest = JSON.parse(await readFile(manifestPath,'utf8'));
    if (action === 'prepare') {
      const feature = { title: 'M2 계획 확인 검증', goal: 'Create M2_PROOF.md containing M2_CONFIRMED after reading both local PLAN files.', scope: 'One proof file in this sandbox worktree only.', constraints: 'Do not commit, push, merge, access other repositories, install dependencies, or use network.', validation: 'Orchiva independently checks the proof string.', completionCriteria: '' };
      manifest.saveInput ??= { token: manifest.token, commandKey: `${runId}-save`, expectedRevision: 0, feature, checks: [{ id:'proof', kind:'file-contains', path:'M2_PROOF.md', text:'M2_CONFIRMED', label:'Proof marker' }], criteria: [{ id:'proof-present', text:'The proof file contains M2_CONFIRMED.', checkIds:['proof'], manualMethod:'', legacy:false }] }; await persist();
      const draft = await rpc('request.save-draft', manifest.saveInput); assert.equal(draft.workspaceId, null); assert.equal(draft.agentId, null);
      manifest.prepareInput ??= { token: manifest.token, commandKey: `${runId}-plan`, expectedRevision: draft.revision }; await persist();
      const prepared = await rpc('request.prepare-plan', manifest.prepareInput); assert.equal(prepared.status, 'ready');
      assert.equal((await api.agents.list()).entries.length, manifest.agents); assert.equal((await api.workspaces.list()).entries.length, manifest.workspaces);
      const plan = prepared.plans.at(-1); manifest.startInput = { token: manifest.token, commandKey: `${runId}-start`, expectedRevision: prepared.revision, planRevision: plan.revision, inputHash: plan.inputHash }; manifest.baseCommit = plan.baseCommit; await persist();
      console.log(JSON.stringify({ token: manifest.token, title: prepared.feature.title, status: prepared.status, baseCommit: plan.baseCommit, noResourcesBeforeConfirmation: true }));
    }
    if (action === 'start') console.log(JSON.stringify(await rpc('request.start', manifest.startInput)));
    if (action === 'ref-check') {
      const config = await loadConfig(), ref = `refs/heads/${runId}-moving`, head = git(config.repositoryPath, 'rev-parse', config.baseRef), older = git(config.repositoryPath, 'rev-parse', `${head}^`);
      git(config.repositoryPath, 'update-ref', ref, older, '0'.repeat(40));
      const store = new JsonRequestStore(join(directory,'ref-requests'));
      try {
        const runtime = new PaseoRuntime(api, { ...config, baseRef: ref }), drafts = new DraftRequest(store), token = `${runId}-ref`;
        const draft = await drafts.save({ ...manifest.saveInput, token, commandKey: `${runId}-ref-save`, expectedRevision: 0 });
        const ready = await drafts.prepare({ token, commandKey: `${runId}-ref-plan`, expectedRevision: draft.revision }, runtime);
        git(config.repositoryPath, 'update-ref', ref, head, older);
        await assert.rejects(new StartFeatureRequest(store).start({ token, commandKey: `${runId}-ref-start`, expectedRevision: ready.revision, planRevision: ready.plans.at(-1).revision, inputHash: ready.plans.at(-1).inputHash }, runtime), /PLAN_STALE/);
        manifest.refCheck = { confirmed: older, movedTo: head, rejected: 'PLAN_STALE', resourcesCreated: 0 }; await persist();
        assert.equal((await api.agents.list()).entries.length, agents.entries.length); assert.equal((await api.workspaces.list()).entries.length, workspaces.entries.length);
      } finally { await store.close(); const current = git(config.repositoryPath,'rev-parse',ref); assert.ok([head,older].includes(current)); git(config.repositoryPath,'update-ref','-d',ref,current); }
    }
    if (action === 'verify') {
      let record = await rpc('request.get',{ token: manifest.token }); assert.ok(record.agentId);
      const agent = api.agents.ref(record.agentId); await agent.refresh(); if (agent.activeTurn || ['running','initializing'].includes(agent.status)) await agent.waitForFinish(45000);
      await agent.refresh(); assert.ok(!agent.activeTurn && !agent.pendingPermissions?.length);
      record = await rpc('request.refresh', { token: record.token }); assert.equal(record.status, 'awaiting-review'); assert.equal(record.result.checks[0].passed, true);
      const config = await loadConfig(); assert.equal(git(record.worktreePath,'rev-parse','HEAD'),manifest.baseCommit); assert.equal(record.confirmationSource,'confirmed-plan');
      for(const plan of [record.requestPlan,record.taskPlan]) assert.equal(await readFile(join(record.worktreePath,'.orchiva/plans',`${plan.id}.md`),'utf8'),plan.content);
      const command = record.commands.find(x=>x.kind==='start'); assert.ok(command); const replay = await rpc('request.start', { ...manifest.startInput, commandKey: command.key }); assert.equal(replay.agentId,record.agentId);
      await assert.rejects(rpc('request.start',{ token:`${runId}-bypass`, feature:record.feature, checks:record.checks }),/PLAN_REQUIRED/);
      for(const original of manifest.originals) assert.equal(sha(await readFile(join(root,'requests',original.file))),original.sha256,`Original changed: ${original.file}`);
      const afterAgents = await api.agents.list(), afterWorkspaces = await api.workspaces.list(); assert.equal(afterAgents.entries.length,manifest.agents+1); assert.equal(afterWorkspaces.entries.length,manifest.workspaces+1);
      manifest.result = { at:new Date().toISOString(), token:record.token, agentId:record.agentId, workspaceId:record.workspaceId, head:git(record.worktreePath,'rev-parse','HEAD'), planRevision:record.confirmedPlanRevision, inputHash:record.plans.at(-1).inputHash, status:record.status, checksPassed:true, startReplaySameId:true, originalBytesUnchanged:manifest.originals.length, newAgents:1, newWorkspaces:1, sourceOrigin:git(process.cwd(),'remote','get-url','origin'), sandboxHead:git(config.repositoryPath,'rev-parse',config.baseRef) }; await persist(); console.log(JSON.stringify(manifest.result,null,2));
    }
  }
  console.log(`${action}: PASS`);
} finally { try { await api.dispose(); } finally { await client.close(); } }
