import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [action = 'help', runId] = process.argv.slice(2);
const home = homedir(), dataRoot = join(home, '.orchiva'), paseHome = join(home, '.paseo-orchiva');
const runRoot = runId ? join(dataRoot, 'm6', runId) : null;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const cliJson = (command, args) => {
  const psArgs = args.map(psQuote).join(', ');
  const script = `$ErrorActionPreference = 'Stop'; $cli = (Get-Command ${psQuote(`${command}.cmd`)}).Source; $m6Args = @(${psArgs}); & $cli @m6Args; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
};
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));

if (action === 'help') {
  console.log('Supplementary M6 tools, raw evidence and cleanup boundaries: scripts/m6/README.md. They include real session creation, owned process termination and temporary Plugin registration; completed run IDs must not be reused.');
  console.log('npm run m6 -- soak m6-<id> [m6-owned-request-token]\nObserves one stable M6-owned request for 30 minutes at 10-second intervals; it does not edit or resume the request.');
  console.log('npm run m6 -- restart m6-<id> [m6-owned-request-token]\nRestarts only the idle Paseo worker three times and measures until Plugin state is reconciled; it preserves terminals and daemon configuration.');
  console.log('npm run m6 -- a11 m6-<id> [m6-owned-request-token] [a11-evidence-dir]\nGracefully stops the idle daemon while preserving terminals, starts it with the provided local environment script, then checks request/resource identity and restore time.');
  console.log('npm run m6 -- d06 m6-<id> [d06-evidence-dir]\nCreates one bounded M6-owned task, then force-kills only the verified Paseo worker PID while that Agent is active; the supervisor and process identity are checked first.');
  console.log('npm run m6 -- d06-recover m6-<id> [d06-evidence-dir]\nResumes only the registered failed D06 request on its existing Agent and Workspace; it creates no new resources and refuses to reuse an existing evidence file.');
  console.log('npm run m6 -- help\nnpm run m6 -- init m6-<unique-id>\nnpm run m6 -- preflight m6-<id>\nnpm run m6 -- measure m6-<id>\nnpm run m6 -- performance m6-<id> [resume]\nnpm run m6 -- response-drop m6-<id> [resume|resume-replay]\nnpm run m6 -- own m6-<id> <gui-request-token>\nnpm run m6 -- verify-baseline m6-<id>\ninit creates a new local-only run and backs up request/config JSON, excluding authentication files. measure creates a synthetic isolated 100-record P01 dataset. performance starts the sequential real SDK P02 suite (30 Agents and Workspaces); resume continues only when the saved JSON and preserved temp file prove that no external effect ran, or when a timed-out start now has a durable result. response-drop intercepts real SDK WebSocket response frames for an M6-owned start/resume request; continuation modes reconcile the existing durable result before any send. own registers one clearly marked M6 request created through the GUI.');
  process.exit(0);
}
assert.ok(runId && /^m6-[a-z0-9-]{8,60}$/.test(runId), 'Use a unique run ID such as m6-20261113-001.');
assert.ok(runRoot);

if (action === 'init') {
  await mkdir(join(dataRoot, 'm6'), { recursive: true });
  await mkdir(runRoot, { recursive: false });
  await mkdir(join(runRoot, 'baseline'), { recursive: false });
  await mkdir(join(runRoot, 'baseline', 'requests'), { recursive: false });
  const project = await readJson(join(dataRoot, 'project.json'));
  const daemonConfig = await readJson(join(paseHome, 'config.json'));
  const files = ['project.json', 'runtime-status.json'];
  for (const name of files) await copyFile(join(dataRoot, name), join(runRoot, 'baseline', name));
  await copyFile(join(paseHome, 'config.json'), join(runRoot, 'baseline', 'paseo-config.json'));
  const requestDir = join(dataRoot, 'requests'), requests = [];
  for (const entry of (await readdir(requestDir, { withFileTypes: true })).filter(x => x.isFile() && x.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
    const source = join(requestDir, entry.name), bytes = await readFile(source), record = JSON.parse(bytes.toString('utf8'));
    await writeFile(join(runRoot, 'baseline', 'requests', entry.name), bytes, { flag: 'wx' });
    requests.push({ file: entry.name, sha256: sha(bytes), bytes: bytes.length, id: record.id, status: record.status, attempt: record.attempt });
  }
  const manifest = { runId, capturedAt: new Date().toISOString(), sourceHead: git(process.cwd(), 'rev-parse', 'HEAD'), sourceBranch: git(process.cwd(), 'branch', '--show-current'), projectPath: project.repositoryPath, baseRef: project.baseRef, provider: project.provider, requestCount: requests.length, requests, files: [] };
  for (const name of ['project.json', 'runtime-status.json', 'paseo-config.json']) {
    const path = join(runRoot, 'baseline', name), bytes = await readFile(path);
    manifest.files.push({ file: name, sha256: sha(bytes), bytes: bytes.length });
  }
  await writeFile(join(runRoot, 'baseline-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ runId, requestCount: requests.length, authFilesCopied: false, manifest: join(runRoot, 'baseline-manifest.json') }, null, 2));
  process.exit(0);
}

const manifest = await readJson(join(runRoot, 'baseline-manifest.json'));
assert.equal(manifest.runId, runId, 'Run ID does not match manifest.');

if (action === 'preflight') {
  const config = await readJson(join(dataRoot, 'project.json'));
  assert.equal(resolve(config.repositoryPath).toLowerCase(), resolve(join(home, 'lib', 'orchiva-PoC')).toLowerCase(), 'Only the registered PoC sandbox is permitted.');
  const remote = git(config.repositoryPath, 'remote', 'get-url', 'origin');
  assert.ok(['https://github.com/kopite97/PoC-sandbox.git', 'https://github.com/kopite97/PoC-sandbox', 'git@github.com:kopite97/PoC-sandbox.git'].includes(remote), 'Unexpected sandbox origin.');
  git(config.repositoryPath, 'rev-parse', '--verify', `${config.baseRef}^{commit}`);
  const status = cliJson('paseo', ['daemon', 'status', '--home', paseHome, '--json']);
  assert.equal(status.localDaemon, 'running', 'Paseo daemon is not running.');
  assert.equal(status.relay?.enabled, false, 'Paseo relay must remain disabled for the local acceptance run.');
  assert.equal(status.configuredListen, '127.0.0.1:6767', 'Unexpected daemon listen address.');
  assert.ok(status.providers?.some(x => x.provider === 'codex' && x.available), 'Codex provider is unavailable.');
  const plugins = cliJson('paseo', ['plugin', 'ls', 'orchiva-plugin', '--home', paseHome, '--json']);
  assert.ok((Array.isArray(plugins) ? plugins : [plugins]).some(x => x.id === 'orchiva-plugin' && x.enabled !== false), 'Orchiva Plugin is not enabled.');
  const agents = cliJson('paseo', ['agent', 'ls', '--home', paseHome, '--json']);
  assert.ok(Array.isArray(agents), 'Could not read the complete Agent inventory.');
  const busy = [];
  for (const agent of agents) {
    const detail = cliJson('paseo', ['agent', 'inspect', agent.id, '--home', paseHome, '--json']);
    if (['running', 'initializing'].includes(String(detail.Status).toLowerCase()) || detail.PendingPermissions?.length) busy.push({ id: agent.id, status: detail.Status, permissions: detail.PendingPermissions?.length ?? 0 });
  }
  assert.equal(busy.length, 0, 'Unrelated active Agent or pending permission exists.');
  const originals = await verifyRequestBaseline(manifest, runRoot, dataRoot);
  console.log(JSON.stringify({ runId, sourceHead: git(process.cwd(), 'rev-parse', 'HEAD'), sourceBranch: git(process.cwd(), 'branch', '--show-current'), sandboxOrigin: remote, sandboxStatusClean: git(config.repositoryPath, 'status', '--porcelain').length === 0, daemonPid: status.pid, daemonVersion: status.daemonVersion, codexAvailable: true, relayEnabled: status.relay.enabled, pluginEnabled: true, agents: agents.length, activeAgents: 0, originalRequestsVerified: originals.baselineCount, m6OwnedRequestsVerified: originals.ownedCount }, null, 2));
  process.exit(0);
}

if (action === 'verify-baseline') {
  const verified = await verifyRequestBaseline(manifest, runRoot, dataRoot);
  console.log(JSON.stringify({ runId, originalRequestFilesUnchanged: verified.baselineCount, m6OwnedRequestFilesUnchanged: verified.ownedCount, otherRunFiles: verified.newFiles, pass: true }, null, 2));
  process.exit(0);
}

if (action === 'own') {
  const token = process.argv[4];
  assert.ok(token && /^[a-zA-Z0-9-]{8,80}$/.test(token), 'Supply the new M6 request token.');
  const file = `${token}.json`, requestPath = join(dataRoot, 'requests', file), request = await readJson(requestPath);
  assert.equal(request.token, token); assert.ok(request.feature?.title?.startsWith('M6 '), 'Only a clearly marked M6 request can be registered.');
  assert.ok(Date.parse(request.createdAt) >= Date.parse(manifest.capturedAt), 'Request predates this run.');
  manifest.ownedRequests ??= [];
  const existing = manifest.ownedRequests.find(item => item.token === token);
  assert.ok(!existing, 'This request is already registered to the run.');
  const bytes = await readFile(requestPath);
  await mkdir(join(runRoot, 'owned', 'requests'), { recursive: true });
  await writeFile(join(runRoot, 'owned', 'requests', file), bytes, { flag: 'wx' });
  manifest.ownedRequests.push({ file, token, title: request.feature.title, status: request.status, createdAt: request.createdAt, sha256: sha(bytes), bytes: bytes.length, source: 'gui' });
  const temp = `${join(runRoot, 'baseline-manifest.json')}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(manifest, null, 2), { flag: 'wx' }); await rename(temp, join(runRoot, 'baseline-manifest.json'));
  console.log(JSON.stringify({ registered: token, source: 'gui', baselineRequestsUnchanged: manifest.requestCount }, null, 2));
  process.exit(0);
}

if (action === 'measure') {
  const script = resolve('scripts/m6/measure.mjs');
  const child = execFileSync(process.execPath, ['--import', 'tsx', script, runId], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(child);
  process.exit(0);
}

if (action === 'performance') {
  const mode = process.argv[4];
  assert.ok(mode === undefined || mode === 'resume', 'Optional performance mode must be resume.');
  const script = resolve('scripts/m6/p02-live.mjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script, runId, ...(mode ? [mode] : [])], { windowsHide: true, stdio: 'inherit' });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  if (outcome.signal) throw new Error(`P02 child exited by ${outcome.signal}.`);
  process.exitCode = outcome.code;
  process.exit();
}

if (action === 'response-drop') {
  const mode = process.argv[4];
  assert.ok(mode === undefined || mode === 'resume' || mode === 'resume-replay', 'Optional D03 mode must be resume or resume-replay.');
  const script = resolve('scripts/m6/d03-response-drop.mjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script, runId, ...(mode ? [mode] : [])], { windowsHide: true, stdio: 'inherit' });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  if (outcome.signal) throw new Error(`D03 child exited by ${outcome.signal}.`);
  process.exitCode = outcome.code;
  process.exit();
}

if (action === 'soak') {
  const token = process.argv[4];
  const evidenceDirectory = process.argv[5] ?? 'p05';
  assert.ok(token === undefined || (token.startsWith(`${runId}-`) && /^[a-zA-Z0-9-]{8,80}$/.test(token)), 'P05 accepts only a request token owned by this M6 run.');
  assert.match(evidenceDirectory, /^p05(?:-[a-z0-9-]{1,20})?$/, 'Use a unique P05 evidence directory, e.g. p05-002.');
  const script = resolve('scripts/m6/p05-soak.mjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script, runId, token ?? '', evidenceDirectory], { windowsHide: true, stdio: 'inherit' });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  if (outcome.signal) throw new Error(`P05 child exited by ${outcome.signal}.`);
  process.exitCode = outcome.code;
  process.exit();
}

if (action === 'restart') {
  const token = process.argv[4];
  assert.ok(token === undefined || (token.startsWith(`${runId}-`) && /^[a-zA-Z0-9-]{8,80}$/.test(token)), 'P04 accepts only a request token owned by this M6 run.');
  const script = resolve('scripts/m6/p04-restarts.mjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script, runId, ...(token ? [token] : [])], { windowsHide: true, stdio: 'inherit' });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  if (outcome.signal) throw new Error(`P04 child exited by ${outcome.signal}.`);
  process.exitCode = outcome.code;
  process.exit();
}

if (action === 'd06') {
  const evidenceDirectory = process.argv[4] ?? 'd06';
  assert.match(evidenceDirectory, /^d06(?:-[a-z0-9-]{1,20})?$/, 'Use a unique D06 evidence directory, e.g. d06-002.');
  const script = resolve('scripts/m6/d06-worker-kill.mjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script, runId, evidenceDirectory], { windowsHide: true, stdio: 'inherit' });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  if (outcome.signal) throw new Error(`D06 child exited by ${outcome.signal}.`);
  process.exitCode = outcome.code;
  process.exit();
}

if (action === 'd06-recover') {
  const evidenceDirectory = process.argv[4] ?? 'd06-003';
  assert.match(evidenceDirectory, /^d06(?:-[a-z0-9-]{1,20})?$/, 'Use a unique D06 evidence directory, e.g. d06-003.');
  const script = resolve('scripts/m6/d06-recovery.mjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script, runId, evidenceDirectory], { windowsHide: true, stdio: 'inherit' });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  if (outcome.signal) throw new Error(`D06 recovery child exited by ${outcome.signal}.`);
  process.exitCode = outcome.code;
  process.exit();
}

if (action === 'a11') {
  const token = process.argv[4];
  const evidenceDirectory = process.argv[5] ?? 'a11';
  assert.ok(token === undefined || (token.startsWith(`${runId}-`) && /^[a-zA-Z0-9-]{8,80}$/.test(token)), 'A11 accepts only a request token owned by this M6 run.');
  assert.match(evidenceDirectory, /^a11(?:-[a-z0-9-]{1,20})?$/, 'Use a unique A11 evidence directory, e.g. a11-002.');
  const script = resolve('scripts/m6/a11-daemon-stop-start.mjs');
  const child = spawn(process.execPath, ['--import', 'tsx', script, runId, token ?? '', evidenceDirectory], { windowsHide: true, stdio: 'inherit' });
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  if (outcome.signal) throw new Error(`A11 child exited by ${outcome.signal}.`);
  process.exitCode = outcome.code;
  process.exit();
}

throw new Error(`Unknown M6 action: ${action}`);

async function verifyRequestBaseline(base, directory, sourceRoot) {
  let baselineCount = 0, ownedCount = 0;
  for (const item of base.requests) {
    const current = await readFile(join(sourceRoot, 'requests', item.file));
    assert.equal(sha(current), item.sha256, `Original request changed: ${item.file}`);
    const saved = await readFile(join(directory, 'baseline', 'requests', item.file));
    assert.deepEqual(current, saved, `Saved baseline differs: ${item.file}`); baselineCount++;
  }
  for (const item of base.ownedRequests ?? []) {
    const current = await readFile(join(sourceRoot, 'requests', item.file));
    assert.equal(sha(current), item.sha256, `Run-owned GUI request changed unexpectedly: ${item.file}`);
    const saved = await readFile(join(directory, 'owned', 'requests', item.file));
    assert.deepEqual(current, saved, `Run-owned GUI snapshot differs: ${item.file}`); ownedCount++;
  }
  const original = new Set([...base.requests.map(x => x.file), ...(base.ownedRequests ?? []).map(x => x.file)]);
  const newFiles = (await readdir(join(sourceRoot, 'requests'))).filter(name => name.endsWith('.json') && !original.has(name)).sort();
  const unexpected = newFiles.filter(name => !name.startsWith(runId));
  assert.deepEqual(unexpected, [], `New request files outside this run: ${unexpected.join(', ')}`);
  return { count: baselineCount + ownedCount, baselineCount, ownedCount, newFiles };
}
