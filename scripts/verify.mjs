import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';

const home = join(homedir(), '.paseo-orchiva');
const client = createHostClient('127.0.0.1:6767', {
  clientId: 'orchiva-verification', clientType: 'cli', appVersion: '0.15.4',
  localCredential: () => readFileSync(join(home, 'local-credential'), 'utf8').trim(),
  reconnect: { enabled: false },
});
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const common = async cwd => (await realpath(resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir')))).toLowerCase();
try {
  await client.connect();
  const api = createPaseoApi(client);
  const project = await client.invokePluginRpc('orchiva-plugin', 'project.read', {});
  const records = await client.invokePluginRpc('orchiva-plugin', 'request.list', {});
  const expected = new Map([
    ['smoke-20261112-001', 'POC_PROOF.md'],
    ['mwcyphtz-fnthmzhhky', 'GUI_PROOF.md'],
  ]);
  for (const [token, filename] of expected) {
    const record = records.find(item => item.token === token);
    assert.ok(record, `Missing request ${token}`);
    assert.ok(['awaiting-review', 'completed'].includes(record.status));
    assert.equal(await common(record.worktreePath), await common(project.repositoryPath));
    assert.notEqual(await realpath(record.worktreePath), await realpath(project.repositoryPath));
    const branch = git(record.worktreePath, 'branch', '--show-current');
    assert.equal(branch, `orchiva/${record.taskId.toLowerCase()}`);
    for (const plan of [record.requestPlan, record.taskPlan]) {
      assert.equal(await readFile(join(record.worktreePath, '.orchiva', 'plans', `${plan.id}.md`), 'utf8'), plan.content);
    }
    const agent = api.agents.ref(record.agentId);
    await agent.refresh();
    if (agent.status === 'running') await agent.waitForFinish(120000);
    await agent.refresh();
    // A completed provider process may be closed after a daemon restart.
    assert.ok(['idle', 'closed'].includes(agent.status), `Unexpected agent state: ${agent.status}`);
    assert.equal(agent.lastError, null);
    assert.equal((await realpath(agent.cwd)).toLowerCase(), (await realpath(record.worktreePath)).toLowerCase());
    const proof = await readFile(join(record.worktreePath, filename), 'utf8');
    for (const value of [record.requestPlan.id, record.taskPlan.id, branch]) assert.ok(proof.includes(value), `Missing proof: ${value}`);
    // Replays must return exactly the persisted execution, including after restart.
    const replay = await client.invokePluginRpc('orchiva-plugin', 'request.start', { token, feature: record.feature });
    assert.equal(replay.workspaceId, record.workspaceId);
    assert.equal(replay.agentId, record.agentId);
    console.log(JSON.stringify({ request: record.id, agent: record.agentId, branch, proof: join(record.worktreePath, filename), result: 'PASS' }));
  }
  assert.equal((await client.invokePluginRpc('orchiva-plugin', 'request.list', {})).length, records.length);
  console.log('PASS: plans, worktree ownership, completed agents, proof files, and restart idempotency.');
} finally { await client.close(); }
