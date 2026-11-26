import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPackage } from './package-desktop.mjs';
import { maintainDeployment, deploymentDataFormat } from '../server/adapters/storage/deployment-maintenance.ts';

const [mode, profileArgument, targetArgument, expectedProfileHash, expectedPackageHash] = process.argv.slice(2);
if (!['inspect','switch','recover'].includes(mode) || !profileArgument || !targetArgument) throw new Error('Usage: node --import tsx scripts/desktop-maintenance.mjs inspect|switch|recover <profile-root> <new-package> [profile-sha256 package-sha256]');
const profileRoot = resolve(profileArgument), target = resolve(targetArgument);
const hash = data => createHash('sha256').update(data).digest('hex');
if (mode === 'inspect') {
  const profile = await readFile(join(profileRoot, 'profile.json')), manifest = await readFile(join(target, 'orchiva-package.json'));
  const info = await verifyPackage(target), format = JSON.parse(manifest).dataFormat;
  if (format !== deploymentDataFormat) throw new Error('UPDATE_FORMAT_UNSUPPORTED');
  console.log(JSON.stringify({ ...info, profileHash: hash(profile), packageHash: hash(manifest), target, dataFormat: format, instruction: 'Close the app and stop its idle daemon before switch. Data and update history are retained.' }, null, 2));
} else {
  if (!/^[a-f0-9]{64}$/.test(expectedProfileHash ?? '') || !/^[a-f0-9]{64}$/.test(expectedPackageHash ?? '')) throw new Error('EXPECTED_HASHES_REQUIRED');
  console.log(JSON.stringify(await maintainDeployment({ mode, profileRoot, target, expectedProfileHash, expectedPackageHash }, verifyPackage), null, 2));
}
