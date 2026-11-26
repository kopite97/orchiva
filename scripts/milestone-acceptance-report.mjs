// Verify local source-to-Player lineage without changing either game or submitting decisions.
import assert from 'node:assert/strict';
import {copyFile,readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gitText,treeFile} from '../server/adapters/storage/integration-git.ts';
import {fileHash,inventory} from '../server/adapters/unity/evidence.ts';
const [trial,recoveryTrial]=process.argv.slice(2);
assert.match(trial??'',/^d1-ma-accept-[a-z0-9-]+$/);
const dir=resolve('.desktop-local',trial),storage=join(dir,'data/desktop');
const read=async path=>JSON.parse(await readFile(path,'utf8')),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence=resolve('docs/evidence/milestone-automation/MA6',trial);
await mkdir(evidence,{recursive:true});
const summaries=[];
for(const key of ['maze','orchard']){
  const s=await read(join(dir,key+'-trial.json'));
  const root=join(dir,key,'docs/.orchiva'),run=await read(join(root,'runs',s.runId+'.json'));
  assert.equal(run.state,'completed');assert.equal(run.projectId,s.projectId);
  const repo=join(storage,'integrations',s.projectId,'repository.git');
  const integration=await read(join(storage,'integrations',s.projectId,s.runId,'integration.json'));
  const features=[];let initial=integration.initial;
  for(const node of run.nodes){
    const d=await read(join(root,'requests',node.token+'.json')),r=d.engine.result;
    const entry=integration.entries.find(e=>e.feature===node.id);
    assert.equal(entry.base,initial);assert.equal(entry.integrated,node.integrationSha);
    assert.equal(await gitText(repo,['rev-parse',entry.integrated+'^']),initial);
    initial=entry.integrated;
    assert.equal(d.projectId,s.projectId);assert.equal(r.id,node.resultId);
    assert.ok(r.checks.length && r.checks.every(c=>c.passed));
    const predecessors=JSON.parse(d.milestone.brief).handoff;
    for(const producer of features){
      const transfer=predecessors.find(h=>h.id===producer.feature);
      assert.equal(transfer.result,producer.result);assert.equal(transfer.fingerprint,producer.fingerprint);
      assert.deepEqual(transfer.files.map(f=>[f.path,f.hash]),producer.files.map(f=>[f.path,f.hash]));
    }
    for(const file of node.files)assert.equal(hash((await treeFile(repo,node.integrationSha,file.path)).bytes),file.hash);
    features.push({feature:node.id,token:node.token,session:d.engine.agentId,planHash:d.planVersions.at(-1).hash,result:r.id,fingerprint:r.fingerprint,
      commit:node.integrationSha,files:node.files,consumed:predecessors.map(h=>h.result),checks:r.checks.map(c=>({label:c.label,hash:c.inputFingerprint,exit:c.exitCode}))});
  }
  const index=await read(join(storage,'unity-validation/runs',s.projectId,s.runId+'.json'));
  const gate=index.filter(g=>g.kind==='integration'&&g.sha===initial).at(-1);
  assert.equal(gate.status,'passed');
  const result=await read(join(gate.directory,'result.json')),build=await read(join(gate.directory,'build.json'));
  assert.equal(result.status,'passed');assert.equal(build.result,'Succeeded');assert.equal(build.errors,0);
  assert.equal(await fileHash(build.output),result.playerHash);
  assert.equal(hash(JSON.stringify(await inventory(join(gate.directory,'build'),true),null,2)),result.buildHash);
  const level=await read(join(gate.directory,'level.json'));
  assert.equal(level.cleared,true);assert.equal(level.wallBlocked,true);
  assert.equal(level.moves,key==='maze'?4:6);assert.equal(level.collected,key==='maze'?0:2);
  const optional=async path=>read(path).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  const decisions=await optional(join(storage,'acceptance',s.projectId,'decisions.json'))??[];
  const next=await optional(join(root,'runs',s.runId+'-next.json'));
  let entryPlan;
  if(next){
    const approval=decisions.at(-1);
    assert.equal(approval.verdict,'approve');assert.equal(approval.sha,initial);assert.equal(approval.buildHash,result.buildHash);
    assert.equal(next.selection.phase,'Polish');assert.equal(next.integrationInitial,initial);
    const receipt=await read(join(storage,'acceptance',s.projectId,'admissions',next.runId+'.json'));
    assert.equal(receipt.basis,approval.basis);assert.equal(receipt.scope,next.scopeHash);
    const d=await read(join(root,'requests',next.nodes[0].token+'.json'));
    assert.equal(d.milestone.integrationBase,initial);assert.equal(d.planning.state,'complete');
    entryPlan={token:d.token,status:d.engine.status,hash:d.planVersions.at(-1).hash,approvedBasis:receipt.basis};
  }
  summaries.push({game:key,projectId:s.projectId,runId:s.runId,profile:run.scope.acceptance,scope:run.scopeHash,roadmapRevision:run.scope.revision,
    features,tip:initial,editor:result.editor,attempt:gate.attempt,buildHash:result.buildHash,playerHash:result.playerHash,artifact:build.output,
    tests:result.stages.map(stage=>({name:stage.name,ms:stage.ms,exit:stage.exit,cases:stage.cases})),
    level:{name:level.name,moves:level.moves,collected:level.collected,cleared:level.cleared,wallBlocked:level.wallBlocked},
    history:run.history,decisions,entryPlan,next:next?{id:next.runId,phase:next.selection.phase,initial:next.integrationInitial,state:next.state}:null});
}
assert.equal(new Set(summaries.map(s=>s.projectId)).size,2);
assert.equal(new Set(summaries.flatMap(s=>s.features.map(f=>f.session))).size,8);
assert.notEqual(summaries[0].buildHash,summaries[1].buildHash);
await writeFile(join(evidence,'acceptance.json'),JSON.stringify(summaries,null,2)+'\n');
if(recoveryTrial){
  assert.match(recoveryTrial,/^d1-ma-accept-recovery-[a-z0-9-]+$/);
  const recovery=resolve('.desktop-local',recoveryTrial);
  const mismatch=await read(join(recovery,'fault.json')),foreign=await read(join(recovery,'foreign.json'));
  const shadow=await read(join(recovery,'shadow-check.json')),guiRerun=await read(join(recovery,'ui-rerun/rerun.json'));
  assert.equal(foreign.dispatches,0);assert.equal(foreign.registered,summaries[0].projectId);
  assert.equal(mismatch.build,'Failed');assert.equal(mismatch.phase.eligible,false);assert.equal(shadow.stale,'PHASE_POLICY_CHANGED');
  const repair=await read(join(recovery,'repair.json')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  const maze=summaries[0], code=maze.features.find(f=>f.feature==='Code');
  const doc=await read(join(dir,'maze/docs/.orchiva/requests',code.token+'.json'));
  const recoveryProof={foreign,guiRerun,repair,mismatch,shadow,worker:{session:doc.engine.agentId,journal:doc.journals.map(j=>j.kind),
    results:doc.engine.results.map(r=>({id:r.id,failure:r.failure,executionFailure:r.executionFailure}))},workspaces:[]};
  for(const [home,folder,name] of [[dir,'ui-approved-maze','maze-approved'],[dir,'ui-approved-orchard','orchard-approved'],[recovery,'ui-failed','build-failed'],[recovery,'ui-reject-clone','test-rejected']]){
    const ui=join(home,folder);assert.ok((await read(join(ui,'mock-results.json'))).passed);
    const review=await read(join(ui,'phase-ui.json'));
    await copyFile(join(ui,'phase-review.png'),join(evidence,name+'.png'));
    recoveryProof.workspaces.push({image:name+'.png',...review});
  }
  await writeFile(join(evidence,'recovery.json'),JSON.stringify(recoveryProof,null,2)+'\n');
}
console.log(summaries.map(s=>[s.game,s.tip,s.level,s.decisions.length,s.next?.phase]));
