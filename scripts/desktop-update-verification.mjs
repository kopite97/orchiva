// Real process interruption test, restricted to the D6-owned isolated profile.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { maintainDeployment } from '../server/adapters/storage/deployment-maintenance.ts';
import { verifyPackage } from './package-desktop.mjs';

const [mode, runId, targetArgument] = process.argv.slice(2), root=resolve(import.meta.dirname,'..');
assert.ok(['verify','crash-child'].includes(mode));assert.match(runId,/^d6b-[a-z0-9-]{10,55}$/);
const run=join(root,'.desktop-local',runId), profile=join(run,'profile'), target=resolve(targetArgument);
assert.ok(target.startsWith(join(root,'.desktop-local')+'\\'));assert.notEqual(target,run);
const state=JSON.parse(await readFile(join(run,'integrated.json'),'utf8'));assert.ok(state.completed.includes('verify'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const input={mode:'switch',profileRoot:profile,target,expectedProfileHash:hash(await readFile(join(profile,'profile.json'))),expectedPackageHash:hash(await readFile(join(target,'orchiva-package.json')))};
if(mode==='crash-child'){
  await maintainDeployment(input,verifyPackage,async phase=>{if(phase==='config')process.exit(86);});
  throw Error('Expected abrupt exit');
}
async function snapshot(){
  const entries={};
  async function walk(path){
    const stat=await lstat(path);assert.ok(!stat.isSymbolicLink());
    if(stat.isDirectory()){for(const name of (await readdir(path)).sort())await walk(join(path,name));}
    else entries[relative(run,path).replaceAll('\\','/')]=hash(await readFile(path));
  }
  for(const path of [join(state.source,'docs'),state.output,join(profile,'data','requests'),join(profile,'data','desktop','projects.json')])await walk(path);
  return entries;
}
if(mode==='verify'){
  const before=await snapshot(),profileBefore=await readFile(join(profile,'profile.json'),'utf8');
  await writeFile(join(run,'update-baseline.json'),JSON.stringify({input,before},null,2),{flag:'wx'});
  const code=await new Promise((ok,fail)=>{const child=spawn(process.execPath,['--import','tsx',import.meta.filename,'crash-child',runId,target],{cwd:root,windowsHide:true,stdio:'inherit'});child.once('error',fail);child.once('exit',ok);});
  assert.equal(code,86);assert.equal(await readFile(join(profile,'profile.json'),'utf8'),profileBefore);
  const journal=JSON.parse(await readFile(join(profile,'update-pending.json'),'utf8'));
  assert.equal(await readFile(join(profile,'paseo','config.json'),'utf8'),journal.afterConfig);
  assert.deepEqual(await snapshot(),before);
  const recovered=await maintainDeployment({...input,mode:'recover'},verifyPackage);
  assert.equal(recovered.recovered,true);assert.deepEqual(await snapshot(),before);
  const updated=JSON.parse(await readFile(join(profile,'profile.json'),'utf8'));
  assert.equal(updated.InstallRoot,target);
  // Refresh this test's developer override from the actual committed profile.
  const options=Object.fromEntries(Object.entries(updated.Options).map(([key,value])=>[key[0].toLowerCase()+key.slice(1),value]));
  await writeFile(join(run,'desktop.json'),JSON.stringify(options,null,2));
  const summary={runId,crashExitCode:code,crashPhase:'config',recovered,filesPreserved:Object.keys(before).length,dataDigest:hash(JSON.stringify(before)),packageHash:input.expectedPackageHash};
  await writeFile(join(run,'update-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}
