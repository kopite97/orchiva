// Audit the prepared TunePass plans against the resulting branches, fresh Players and original Play receipt.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {gitText,treeFile} from '../server/adapters/storage/integration-git.ts';
import {editTests,fileHash,inventory,playTests,verifyLog,verifyXml} from '../server/adapters/unity/evidence.ts';
import {verifyPlayableLevel} from '../server/domain/playable-level.ts';

const [trial]=process.argv.slice(2);
assert.match(trial??'',/^d1-ma-accept-[a-z0-9-]+$/);
const local=resolve('.desktop-local',trial),storage=join(local,'data/desktop');
const evidence=resolve('docs/evidence/milestone-automation/MA6',trial);
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const exec=promisify(execFile);
const reports=[];
for(const prior of await read(join(evidence,'acceptance.json'))){
  const {game,projectId,next,entryPlan}=prior;
  const source=join(local,game,'docs/.orchiva');
  const run=await read(join(source,'runs',next.id+'.json'));
  assert.equal(run.projectId,projectId);
  assert.deepEqual(run.selection,{phase:'Polish',first:'Tune',last:'Tune'});
  assert.equal(run.state,'completed');
  assert.deepEqual(run.nodes.map(n=>[n.id,n.token,n.status]),[['TunePass',entryPlan.token,'accepted']]);
  const [node]=run.nodes,sha=node.integrationSha;
  const request=await read(join(source,'requests',node.token+'.json'));
  const result=request.engine.result;
  assert.equal(request.engine.status,'completed');
  assert.equal(request.planVersions.length,1);
  assert.equal(request.journals.filter(j=>j.kind==='start' && j.state==='applied').length,1);
  assert.equal(request.planVersions.find(p=>p.revision===request.engine.confirmedPlanRevision)?.hash,entryPlan.hash);
  assert.equal(request.milestone.integrationBase,prior.tip);
  assert.ok(request.engine.agentId && request.engine.workspaceId);
  assert.equal(result.id,node.resultId);
  assert.equal(result.fingerprint,node.fingerprint);
  assert.ok(!result.failure && !result.executionFailure);
  assert.deepEqual(result.checks.map(c=>[c.label,c.inputFingerprint,c.exitCode,c.passed]),
    request.milestone.checks.map(c=>[c.path,c.hash,0,true]));
  const integration=await read(join(storage,'integrations',projectId,next.id,'integration.json'));
  const repo=join(storage,'integrations',projectId,'repository.git');
  const branch=integration.settings.target, [entry]=integration.entries;
  assert.equal(branch,'orchiva/integration/'+game);
  assert.equal(integration.entries.length,1);
  assert.equal(entry.review,request.reviews.at(-1).id);
  assert.ok(request.reviews.at(-1).approved && request.exports.some(e=>e.resultId===result.id));
  assert.equal(entry.result,result.id);
  assert.equal(entry.integrated,sha);
  assert.equal(entry.base,prior.tip);
  assert.equal(await gitText(repo,['rev-parse',sha+'^']),prior.tip);
  assert.equal(await gitText(repo,['rev-parse','refs/heads/'+branch]),sha);
  assert.equal(await gitText(repo,['diff','--name-status',prior.tip,sha]),'A\ttuning.json');
  const tuning=JSON.parse((await treeFile(repo,sha,'tuning.json')).bytes);
  assert.deepEqual(tuning,{tuning:'playtest'});

  const tickets=await read(join(storage,'unity-validation/runs',projectId,next.id+'.json'));
  const gate=tickets.filter(g=>g.kind==='integration' && g.sha===sha && g.feature===node.id).at(-1);
  assert.equal(gate.status,'passed');
  assert.notEqual(gate.attempt,prior.attempt);
  const dir=gate.directory, checkout=join(dir,'source'), audit=await read(join(dir,'result.json'));
  assert.equal(audit.sha,sha);assert.equal(audit.attempt,gate.attempt);assert.equal(audit.status,'passed');
  const inputPath=join(dir,'input.json'), input=await read(inputPath);
  assert.equal(await fileHash(inputPath),audit.inputHash);
  assert.equal(input.sha,sha);
  assert.equal(input.tree,await gitText(repo,['rev-parse',sha+'^{tree}']));
  assert.equal(await gitText(checkout,['rev-parse','HEAD']),sha);
  assert.deepEqual(audit.stages.map(s=>s.name),['EditMode','PlayMode','build','player']);
  for(const stage of audit.stages){
    assert.equal(stage.exit,0);const log=join(dir,stage.name+'.log');
    assert.equal(await fileHash(log),stage.logHash);
    verifyLog(stage.name,await readFile(log,'utf8'));
    if(stage.name==='EditMode'||stage.name==='PlayMode'){
      const xml=join(dir,stage.name+'.xml');assert.equal(await fileHash(xml),stage.xmlHash);
      assert.deepEqual(verifyXml(await readFile(xml,'utf8'),stage.name==='EditMode'?editTests:playTests,
        {started:stage.started,ended:stage.started+stage.ms}),stage.cases);
    }
  }
  const build=await read(join(dir,'build.json'));
  assert.equal(build.result,'Succeeded');assert.equal(build.errors,0);assert.equal(build.target,'StandaloneWindows64');
  assert.equal(resolve(build.output),join(dir,'build','Hud.exe'));
  assert.equal(await fileHash(build.output),audit.playerHash);
  assert.equal(await fileHash(join(dir,'build-files.json')),audit.buildHash);
  assert.deepEqual(await inventory(join(dir,'build'),true),await read(join(dir,'build-files.json')));
  const signal=await read(join(dir,'signal.json')),level=await read(join(dir,'level.json'));
  assert.ok(signal.nonce && signal.nonce===level.nonce && signal.frame>0 && signal.visible && level.wallBlocked);
  const replay=verifyPlayableLevel((await treeFile(repo,sha,'Assets/Resources/Route.json')).bytes,level);
  assert.equal(replay.name,prior.level.name);
  assert.deepEqual([signal.before,signal.after,signal.score],['SCORE 0','SCORE 10',10]);

  const roles=run.scope.acceptance.roles,checks=[...new Set(roles.flatMap(r=>r.checks))];
  const inputs=roles.flatMap(r=>r.outputs);
  assert.equal(await gitText(checkout,['diff','--name-only',sha,'--',...checks,...inputs]),'');
  const {stdout}=await exec(process.execPath,['--test','--test-reporter=tap',...checks],{cwd:checkout,windowsHide:true});
  assert.ok(stdout.split(/\r?\n/).includes('# pass '+checks.length));
  const projectChecks=[];
  for(const path of checks)projectChecks.push({path,sha256:await fileHash(join(checkout,path))});
  reports.push({game,projectId,runId:next.id,token:node.token,planHash:entryPlan.hash,session:request.engine.agentId,
    resultId:result.id,branch,parent:prior.tip,commit:sha,tuning,featureChecks:result.checks.map(c=>({name:c.label,exit:c.exitCode})),
    projectChecks,attempt:gate.attempt,editor:audit.editor,stages:audit.stages.map(s=>({name:s.name,exit:s.exit,ms:s.ms,pid:s.pid,cases:s.cases})),
    target:build.target,buildErrors:build.errors,distributionHash:audit.buildHash,artifact:build.output,playerHash:audit.playerHash,
    level:replay,blockedBoundary:level.wallBlocked,hud:signal.after,frame:signal.frame});
}
assert.deepEqual(reports.map(r=>r.game).sort(),['maze','orchard']);
assert.equal(new Set(reports.map(r=>r.session)).size,2);
await writeFile(join(evidence,'polish-tune.json'),JSON.stringify(reports,null,2)+'\n');
console.log(reports.map(({game,commit,level,projectChecks})=>({game,commit,level,checks:projectChecks.length})));
