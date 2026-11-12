import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { legacyRecordSchema } from '../shared/contracts/feature-request.ts';
import { payloadHash } from '../server/domain/record-v2.ts';
import { DirectoryOwner } from '../server/adapters/storage/directory-owner.ts';

const [action = 'help', runId] = process.argv.slice(2);
if (action === 'help') { console.log('npm run m1 -- backup|verify m1-<unique-run-id>\nbackup: preserve current bytes and assert idle; verify: compare migrated records via running Plugin. No agent creation.'); process.exit(0); }
assert.ok(['backup', 'verify'].includes(action)); assert.match(runId ?? '', /^m1-[a-zA-Z0-9-]{8,80}$/);
const root = join(homedir(), '.orchiva'), requests = join(root, 'requests'), directory = join(root, 'm1', runId);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const client = createHostClient('127.0.0.1:6767', { clientId: `orchiva-${runId}`, clientType: 'cli', appVersion: '0.15.4', localCredential: async () => (await readFile(join(homedir(), '.paseo-orchiva/local-credential'), 'utf8')).trim(), reconnect: { enabled: false } });
const api = createPaseoApi(client);
try {
  await client.connect();
  const agents = await api.agents.list(), workspaces = await api.workspaces.list();
  assert.ok(!agents.pageInfo.hasMore && !workspaces.pageInfo.hasMore, 'Inventory incomplete');
  assert.ok(agents.entries.every(({ agent }) => !agent.activeTurn && !agent.pendingPermissions?.length && !['running', 'initializing'].includes(agent.status)), 'Active work exists; do not reload');
  if (action === 'backup') {
    await mkdir(join(directory, 'original-requests'), { recursive: true });
    const records = [];
    for (const name of (await readdir(requests)).filter(x => x.endsWith('.json')).sort()) {
      const raw = await readFile(join(requests, name)); const value = JSON.parse(raw);
      assert.ok(value.schemaVersion === undefined || value.schemaVersion === 1, 'This baseline must precede migration');
      await writeFile(join(directory, 'original-requests', name), raw, { flag: 'wx' });
      const files = {};
      for (const filename of ['feature.test.mjs', 'POC_PROOF.md', 'GUI_PROOF.md']) {
        try { files[filename] = sha(await readFile(join(value.worktreePath, filename))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      records.push({ token: value.token, sha256: sha(raw), projectionHash: payloadHash(legacyRecordSchema.parse(value)), files });
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ runId, at: new Date().toISOString(), sourceBaseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(), agents: agents.entries.length, workspaces: workspaces.entries.length, records }, null, 2), { flag: 'wx' });
    console.log(`backup: PASS; ${records.length} original JSON files, idle inventory, ${directory}`);
  } else {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    assert.equal(agents.entries.length, manifest.agents); assert.equal(workspaces.entries.length, manifest.workspaces);
    const records = await client.invokePluginRpc('orchiva-plugin', 'request.list', {});
    assert.equal(records.length, manifest.records.length);
    const comparisons = [];
    const before = new Map();
    for (const baseline of manifest.records) {
      const record = records.find(x => x.token === baseline.token); assert.ok(record);
      assert.equal(record.schemaVersion, 2); assert.equal(record.migration.sourceSha256, baseline.sha256);
      assert.equal(payloadHash(legacyRecordSchema.parse(record)), baseline.projectionHash, 'Legacy fields changed');
      const original = await readFile(join(directory, 'original-requests', `${record.token}.json`));
      const migrationBackup = await readFile(join(requests, 'backups/v1', `${record.token}-${baseline.sha256}.json`));
      assert.equal(sha(original), baseline.sha256); assert.deepEqual(migrationBackup, original);
      for (const [file, expected] of Object.entries(baseline.files)) assert.equal(sha(await readFile(join(record.worktreePath, file))), expected);
      for (const plan of [record.requestPlan, record.taskPlan]) assert.equal(await readFile(join(record.worktreePath, '.orchiva/plans', `${plan.id}.md`), 'utf8'), plan.content);
      before.set(record.token, sha(await readFile(join(requests, `${record.token}.json`))));
      comparisons.push({ token: record.token, status: record.status, revision: record.revision, agentId: record.agentId, workspaceId: record.workspaceId, results: record.results.map(x => x.id), decisions: record.decisions.length, attempts: record.attemptHistory.map(x => x.number), legacyProjectionUnchanged: true, sourceSha256: baseline.sha256, backupBytesMatch: true, files: baseline.files });
    }
    for (let i = 0; i < 3; i++) assert.deepEqual(await client.invokePluginRpc('orchiva-plugin', 'request.list', {}), records);
    const diagnostics = await client.invokePluginRpc('orchiva-plugin', 'storage.diagnostics', {});
    assert.deepEqual(diagnostics.issues, []); assert.deepEqual(diagnostics.activeTokens, []);
    const contender = new DirectoryOwner(requests);
    try { await assert.rejects(contender.open(), /STORE_OWNED/); } finally { await contender.close(); }
    for (const [token, hash] of before) assert.equal(sha(await readFile(join(requests, `${token}.json`))), hash, 'List or diagnostics wrote a request');
    const result = { runId, at: new Date().toISOString(), sourceBaseline: manifest.sourceBaseline, comparisons, diagnostics, listReads: 4, listWrites: 0, secondWriterBlocked: true, agents: agents.entries.length, workspaces: workspaces.entries.length, newResources: 0 };
    await writeFile(join(directory, `verification-${Date.now()}.json`), JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(result, null, 2)); console.log('verify: PASS');
  }
} finally { try { await api.dispose(); } finally { await client.close(); } }
