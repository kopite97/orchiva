// Replay the stored, real Unity verdicts at the B and C integration boundaries.
// Only the roadmap and the pending successor are synthetic. Never edit the MA4 run.
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {Projects} from '../server/application/desktop/projects.ts';
import {Roadmaps} from '../server/application/desktop/roadmap.ts';
import {ProductionService} from '../server/application/desktop/production.ts';
import {ProductionArtifacts} from '../server/application/desktop/artifacts.ts';
import {MilestoneRuns} from '../server/application/desktop/milestone-run.ts';
import {JsonRequestStore} from '../server/adapters/storage/json-request-store.ts';
import {gitText} from '../server/adapters/storage/integration-git.ts';
const [id,trial,mode]=process.argv.slice(2), execute=mode==='--execute';assert.match(id,/^d1-ma-parallel-[a-z0-9-]+$/);assert.match(trial,/^ma5-[a-z0-9-]+$/);
const home=resolve('.desktop-local',id), output=resolve('.desktop-local',trial);
const {runId,projectId}=JSON.parse(await readFile(join(home,'parallel-report.json'),'utf8'));
const accepted=JSON.parse(await readFile(join(output,'poc.json'),'utf8'));
const relativeRun='docs/.orchiva/runs/'+runId+'.json';
const original=await readFile(join(home,'game',relativeRun),'utf8');
const outcomes=[];
for(const verdict of accepted){
  const work=await mkdtemp(join(output,'replay-')), game=join(work,'game'), db=join(work,'registry');
  await gitText(work,['clone','--no-hardlinks',join(home,'game'),game]);
  await cp(join(home,'game','AGENTS.md'),join(game,'AGENTS.md'));
  await cp(join(home,'game','docs'),join(game,'docs'),{recursive:true});
  const projects=new Projects(db), legacy=new JsonRequestStore(join(work,'legacy'));
  let models=0;const forbid=async()=>{models++;throw Error('Replay must stop at reservation');};
  const service=new ProductionService(projects,legacy,forbid,{generate:forbid});
  const road=new Roadmaps(projects,service),runs=new MilestoneRuns(road,new ProductionArtifacts(service));await runs.close();
  try {
    await legacy.open();assert.equal((await projects.register(game,'Unity gate replay')).projectId,projectId);
    const src=join(home,'data/desktop');
    await cp(join(src,'integrations',projectId),join(db,'integrations',projectId),{recursive:true});
    const ledger=join('unity-validation','runs',projectId,runId+'.json');
    const rows=JSON.parse(await readFile(join(src,ledger),'utf8')).filter(r=>r.attempt===verdict.attempt);
    assert.equal(rows.length,1);assert.equal(rows[0].status,verdict.status);
    await mkdir(join(db,'unity-validation','runs',projectId),{recursive:true});
    await writeFile(join(db,ledger),JSON.stringify(execute?[]:rows));
    const run=JSON.parse(original), last=run.nodes.findIndex(n=>n.integrationSha===verdict.sha);
    assert.ok(last>=0);run.nodes=run.nodes.slice(0,last+1);
    const map=await road.read(projectId), phase=map.roadmap.phases[0], milestone=phase.milestones[0];
    milestone.features=milestone.features.slice(0,last+1);
    phase.milestones=[milestone,{id:'After',features:[{id:'Next',title:'후속',goal:'인계 확인',outputs:['next.txt'],dependsOn:[run.nodes.at(-1).id]}]}];
    await road.save(projectId,map.revision,map.roadmap);
    run.selection.last='After';run.scope=await road.preview(projectId,run.selection);assert.deepEqual(run.scope.issues,[]);run.scopeHash=run.scope.hash;
    const token=kind=>'ma-'+createHash('sha256').update(JSON.stringify([runId,kind,kind==='advisor'?'After':'Next'])).digest('hex').slice(0,40);
    run.history=run.history.slice(0,run.history.findIndex(h=>h.event==='accepted '+run.nodes.at(-1).id)+1);
    run.nodes.push({id:'Next',milestone:'After',token:token('feature'),status:'waiting',resultId:null,fingerprint:null,files:[],transfers:[]});
    run.advisors.push({milestone:'After',token:token('advisor'),status:'skipped',report:'',planHash:null});
    run.unityProfile='hud-win64-v1';run.state='active';run.reason='';
    await writeFile(join(game,relativeRun),JSON.stringify(run));
    let attempt=verdict.attempt,whileRunning;
    if(execute){
      await runs.cycle();
      const [pending]=await runs.unity.list(run);assert.equal(pending.status,'running');
      assert.equal(pending.sha,verdict.sha);attempt=pending.attempt;
      whileRunning=(await runs.get(projectId,runId)).nodes.at(-1).status;assert.equal(whileRunning,'waiting');
      await runs.unity.close();
      const [finished]=await runs.unity.list(run);assert.equal(finished.status,verdict.status,finished.reason);
    }
    await runs.cycle();const next=await runs.get(projectId,runId), node=next.nodes.at(-1);
    assert.equal(node.status,verdict.status==='passed'?'reserved':'waiting',next.reason);
    if(verdict.status==='passed')assert.equal(node.lease.base,verdict.sha);
    else {assert.equal(node.lease,undefined);assert.equal(next.reason,verdict.reason);}
    assert.equal(models,0);outcomes.push({sha:verdict.sha,attempt,whileRunning,gate:verdict.status,next:node.status,base:node.lease?.base,reason:next.reason});
  }finally{await runs.close();await service.close();await projects.close();await legacy.close();}
}
assert.equal(await readFile(join(home,'game',relativeRun),'utf8'),original);
await writeFile(join(output,execute?'automatic-handoff.json':'handoff.json'),JSON.stringify(outcomes,null,2));console.log(outcomes);
