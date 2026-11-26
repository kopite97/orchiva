import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { inventory, verifyPackage, requiredFiles } from './package-desktop.mjs';

test('package verification rejects corruption, extra/private files, traversal and duplicate paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orchiva-package-test-'));
  try {
    await writeFile(join(directory, 'app.exe'), 'original');
    for (const file of requiredFiles) { await mkdir(dirname(join(directory, file)), { recursive: true }); await writeFile(join(directory, file), 'fixture'); }
    const manifest = { schemaVersion: 1, profileVersion: 1, platform: 'win-x64', version: 'test', files: await inventory(directory) };
    const save = value => writeFile(join(directory, 'orchiva-package.json'), JSON.stringify(value));
    await save(manifest); assert.equal((await verifyPackage(directory)).files, requiredFiles.length + 1);
    await rm(join(directory, 'Orchiva.Desktop.pri'));
    await assert.rejects(verifyPackage(directory), /PACKAGE_REQUIRED_FILE/);
    await writeFile(join(directory, 'Orchiva.Desktop.pri'), 'fixture');
    await writeFile(join(directory, 'app.exe'), 'modified');
    await assert.rejects(verifyPackage(directory), /PACKAGE_FILE_CHANGED/);
    await writeFile(join(directory, 'app.exe'), 'original');
    await writeFile(join(directory, 'extra'), 'extra');
    await assert.rejects(verifyPackage(directory), /PACKAGE_FILE_COUNT/);
    await rm(join(directory, 'extra'));
    await writeFile(join(directory, 'auth.json'), '{}');
    await assert.rejects(inventory(directory), /PACKAGE_PRIVATE_FILE/);
    await rm(join(directory, 'auth.json'));
    for (const path of ['../escape', 'C:/escape', 'sub/../../escape', 'app.exe:stream', 'sub\\escape']) {
      await save({ ...manifest, files: [{ ...manifest.files[0], path }] });
      await assert.rejects(verifyPackage(directory), /PACKAGE_MANIFEST_ENTRY/);
    }
    await save({ ...manifest, files: [manifest.files[0], { ...manifest.files[0], path: manifest.files[0].path.toUpperCase() }] });
    await assert.rejects(verifyPackage(directory), /PACKAGE_MANIFEST_ENTRY/);
    assert.equal(await readFile(join(directory, 'app.exe'), 'utf8'), 'original');
  } finally { await rm(directory, { recursive: true }); }
});
