import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHostClient } from '@getpaseo/client/node';
const home = join(homedir(), '.paseo-orchiva');
const client = createHostClient('127.0.0.1:6767', {
  clientId: 'orchiva-smoke', clientType: 'cli', appVersion: '0.15.4',
  localCredential: () => readFileSync(join(home, 'local-credential'), 'utf8').trim(),
  reconnect: { enabled: false },
});
try {
  await client.connect();
  console.log('project', await client.invokePluginRpc('orchiva-plugin', 'project.read', {}));
  const input = { token: 'smoke-20261112-001', feature: {
    title: 'Orchiva end-to-end smoke test',
    goal: 'Verify that Codex reads both generated plans and can write a proof file in its assigned sandbox worktree.',
    scope: 'Create only POC_PROOF.md in the current worktree. Mention both plan filenames and the current branch in that file.',
    constraints: 'Use only this worktree. No production repositories, network access, dependencies, commits, push, or merge.',
    validation: 'Read both plans, run git branch --show-current, create POC_PROOF.md, and read it back.',
    completionCriteria: 'POC_PROOF.md exists and accurately names both plan files and current branch. Report the evidence.',
  }};
  const first = await client.invokePluginRpc('orchiva-plugin', 'request.start', input);
  console.log('first', JSON.stringify(first, null, 2));
  if (first.status !== 'started') throw new Error(first.error || first.status);
  const again = await client.invokePluginRpc('orchiva-plugin', 'request.start', input);
  if (first.agentId !== again.agentId || first.workspaceId !== again.workspaceId) throw new Error('Duplicate execution');
  console.log('Idempotency verified:', first.agentId);
} finally { await client.close(); }
