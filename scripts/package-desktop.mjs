import { mkdir, readFile, writeFile, readdir, copyFile, lstat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestName = 'orchiva-package.json';
export const requiredFiles = ['Orchiva.Desktop.exe', 'Orchiva.Desktop.dll', 'Orchiva.Desktop.pri', 'App.xbf', 'MainWindow.xbf', 'ProductionWorkspace.xbf', 'ConversationWorkspace.xbf', 'Themes/Orchiva.xbf', 'coreclr.dll', 'hostfxr.dll', 'Microsoft.ui.xaml.dll', 'runtime/node.exe', 'runtime/plugin/bridge/index.ts', 'runtime/paseo/node_modules/@getpaseo/cli/bin/paseo'];
const sha = async path => { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); };
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`PACKAGE_LINK_REJECTED: ${name}`);
    if (entry.isDirectory()) result.push(...await files(directory, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`PACKAGE_ENTRY_REJECTED: ${name}`);
  }
  return result.sort();
}
function safeRelative(name) {
  return typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !name.includes('\\') && !name.includes(':') &&
    name.split('/').every(part => part && part !== '.' && part !== '..') && name !== manifestName;
}
export async function inventory(directory) {
  const entries = [];
  for (const path of await files(directory)) {
    if (path === manifestName) continue;
    // This published Paseo template contains empty keys, not a user's .env.
    const vendorTemplate = path === 'runtime/paseo/node_modules/@getpaseo/server/.env.example';
    if (!vendorTemplate && /(^|\/)(\.env(?:\..*)?|auth\.json|local-credential|profile\.json|desktop\.json|\.git|\.desktop-local)(\/|$)/i.test(path)) throw new Error(`PACKAGE_PRIVATE_FILE: ${path}`);
    entries.push({ path, bytes: (await lstat(join(directory, path))).size, sha256: await sha(join(directory, path)) });
  }
  return entries;
}
export async function verifyPackage(directory) {
  const manifest = JSON.parse(await readFile(join(directory, manifestName), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.profileVersion !== 1 || manifest.platform !== 'win-x64' || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('PACKAGE_SCHEMA');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!safeRelative(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || seen.has(file.path.toLowerCase())) throw new Error('PACKAGE_MANIFEST_ENTRY');
    seen.add(file.path.toLowerCase());
  }
  const actual = await inventory(directory);
  for (const path of requiredFiles) if (!actual.some(file => file.path === path)) throw new Error(`PACKAGE_REQUIRED_FILE: ${path}`);
  if (actual.length !== manifest.files.length) throw new Error('PACKAGE_FILE_COUNT');
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  for (const file of actual) {
    const item = expected.get(file.path);
    if (!item || item.bytes !== file.bytes || item.sha256 !== file.sha256) throw new Error(`PACKAGE_FILE_CHANGED: ${file.path}`);
  }
  return { files: actual.length, bytes: actual.reduce((total, file) => total + file.bytes, 0), version: manifest.version };
}
async function run(command, args, cwd) {
  await new Promise((ok, fail) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: 'inherit', shell: false });
    child.once('error', fail); child.once('exit', code => code === 0 ? ok() : fail(new Error(`PACKAGE_COMMAND_FAILED: ${command} (${code})`)));
  });
}
async function copyTree(source, target, filter = () => true) {
  await mkdir(target, { recursive: true });
  for (const file of await files(source)) {
    if (!filter(file)) continue;
    const destination = join(target, file); await mkdir(dirname(destination), { recursive: true }); await copyFile(join(source, file), destination);
  }
}
async function build(output, dotnet, node, npm) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('WINDOWS_X64_BUILD_REQUIRED');
  const nodeVersion = await new Promise((ok, fail) => {
    const child = spawn(node, ['--version'], { windowsHide: true }); let value = '';
    child.stdout.on('data', data => { value += data; }); child.once('error', fail); child.once('exit', code => code === 0 ? ok(value.trim()) : fail(new Error('NODE_VERSION')));
  });
  if (nodeVersion !== 'v26.13.0') throw new Error('PACKAGE_NODE_VERSION: expected v26.13.0');
  output = resolve(output);
  // An existing destination is never overwritten or recursively cleared.
  const rel = relative(root, output);
  if (!rel.startsWith(`.desktop-local${sep}`)) throw new Error('PACKAGE_OUTPUT_MUST_BE_NEW_DESKTOP_LOCAL_FOLDER');
  await mkdir(output); // also prevents accidental reuse after a failed build
  const runtime = join(output, 'runtime'), plugin = join(runtime, 'plugin'), paseo = join(runtime, 'paseo');
  await mkdir(plugin, { recursive: true }); await mkdir(paseo);
  for (const name of ['package.json', 'package-lock.json', 'paseo-plugin.json', 'index.server.ts', 'index.client.tsx', 'tsconfig.json']) await copyFile(join(root, name), join(plugin, name));
  for (const name of ['bridge', 'server', 'shared', 'client']) await copyTree(join(root, name), join(plugin, name), file => !file.split('/').includes('tests'));
  await mkdir(join(plugin, 'scripts'));
  for (const name of ['package-desktop.mjs', 'desktop-maintenance.mjs']) await copyFile(join(root, 'scripts', name), join(plugin, 'scripts', name));
  for (const name of ['package.json', 'package-lock.json']) await copyFile(join(root, 'desktop', 'deployment', 'paseo', name), join(paseo, name));
  await copyFile(node, join(runtime, 'node.exe'));
  await run(node, [npm, 'ci', '--no-audit', '--no-fund'], plugin);
  await run(node, [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], paseo);
  await run(dotnet, ['publish', join(root, 'desktop', 'Orchiva.Desktop', 'Orchiva.Desktop.csproj'), '-c', 'Release', '-p:OrchivaPackage=true', '-p:Platform=x64', '-p:RestoreLockedMode=true', '-o', output], root);
  await copyFile(join(root, 'docs', 'guides', 'desktop-package.md'), join(output, 'READ-ME.md'));
  const frameworks = JSON.parse(await readFile(join(output, 'Orchiva.Desktop.runtimeconfig.json'), 'utf8')).runtimeOptions.includedFrameworks;
  if (!Array.isArray(frameworks) || !frameworks.some(item => item.name === 'Microsoft.WindowsDesktop.App')) throw new Error('SELF_CONTAINED_RUNTIME_REQUIRED');
  const manifest = { schemaVersion: 1, profileVersion: 1, dataFormat: 'orchiva-v2-v3-conversation-v1-media-v1', platform: 'win-x64', version: '0.1.0-d6b-preview', channel: 'local-validation-unsigned', createdAt: new Date().toISOString(), versions: { node: nodeVersion, paseo: '0.15.4', windowsAppSdk: '2.6.5', frameworks }, files: await inventory(output) };
  await writeFile(join(output, manifestName), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, ...await verifyPackage(output) }));
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  const [mode, output, ...args] = process.argv.slice(2);
  if (mode === 'verify' && output) console.log(JSON.stringify(await verifyPackage(resolve(output))));
  else if (mode === 'build' && output) {
    const option = (name, fallback) => { const index = args.indexOf(name); if (index >= 0 && !args[index + 1]) throw new Error(`MISSING ${name}`); return index < 0 ? fallback : resolve(args[index + 1]); };
    await build(output, option('--dotnet', 'dotnet'), option('--node', process.execPath), option('--npm-cli', process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')));
  } else throw new Error('Usage: node scripts/package-desktop.mjs build <new .desktop-local/folder> [--dotnet path] [--node path] [--npm-cli path] | verify <folder>');
}
