import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { applyTransfer, readTransfer, transferManifest } = require('../../server/application/desktop/transfers.ts');
const [action, trial, token, resultId] = process.argv.slice(2);
assert.match(trial, /^d1-gui-[a-z0-9-]+$/);
const home = resolve(import.meta.dirname, '../../.desktop-local', trial);
const source = join(home, '시험 소스');
const config = JSON.parse(await readFile(join(home, 'desktop.json'), 'utf8'));
assert.equal(await realpath(home), config.isolationRoot);
if (action === 'seed') {
  await assert.rejects(stat(source), { code: 'ENOENT' });
  const git = (...args) => execFileSync('git', args, { windowsHide: true, stdio: 'pipe' });
  git('clone', '--no-hardlinks', resolve(config.sourceRoot, '../orchiva-PoC'), source);
  await mkdir(join(source, 'checks'));
  await mkdir(join(home, '결과물'));
  await writeFile(join(source, 'checks/value.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; test('answer',()=>assert.equal(readFileSync(new URL('../answer.txt', import.meta.url),'utf8').trim(),'42'));\n", { flag: 'wx' });
  git('-C', source, 'add', 'checks/value.test.mjs');
  git('-C', source, '-c', 'user.name=Orchiva', '-c', 'user.email=test@fixture.invalid', 'commit', '-m', 'Add isolated validation');
  process.exit(0);
}
assert.equal(action, 'interrupt');
assert.match(token, /^[a-f0-9]{32}$/);
assert.match(resultId, /^[a-f0-9-]{36}$/);
assert.equal(await realpath(source), source);
const doc = JSON.parse(await readFile(join(source, 'docs/.orchiva/requests', token + '.json'), 'utf8'));
assert.equal(doc.engine.status, 'completed');
assert.equal(doc.engine.result.id, resultId);
const manifest = transferManifest.parse(JSON.parse(await readFile(join(source, 'docs/.orchiva/exports', token, resultId + '.json'), 'utf8')));
assert.equal(manifest.projectId, doc.projectId);
assert.equal(manifest.resultId, resultId);
assert.equal(manifest.token, token);
const paths = ['answer.txt', 'note.txt'];
for (const path of paths) {
  assert.equal(manifest.files.find(f => f.path === path)?.before, null);
  await assert.rejects(stat(join(source, path)), { code: 'ENOENT' });
}
const key = 'partial-' + randomUUID();
const failure = new Error('fixture interruption after first source write');
await assert.rejects(applyTransfer(source, manifest, key, paths, () => { throw failure; }), e => e === failure);
assert.equal((await readTransfer(source, key)).state, 'applying');
console.log(JSON.stringify({trial, key, interruptedAfterWrites: 1}));
