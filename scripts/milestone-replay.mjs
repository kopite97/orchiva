import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Projects } from '../server/application/desktop/projects.ts';
import { ProductionService } from '../server/application/desktop/production.ts';
import { ProductionArtifacts } from '../server/application/desktop/artifacts.ts';
import { Roadmaps } from '../server/application/desktop/roadmap.ts';
import { MilestoneRuns } from '../server/application/desktop/milestone-run.ts';
import { JsonRequestStore } from '../server/adapters/storage/json-request-store.ts';

const id=process.argv[2];
assert.match(id??'',/^d1-ma-[a-zA-Z0-9-]{4,50}$/);
const home=resolve(import.meta.dirname,'../.desktop-local',id);
const config=JSON.parse(await readFile(join(home,'desktop.json'),'utf8'));
assert.equal(await realpath(home),config.isolationRoot);
const report=JSON.parse(await readFile(join(home,'milestone-report.json'),'utf8'));
const original=join(home,'game'), copy=await mkdtemp(join(home,'gate-replay-')), root=join(copy,'game');
await promisify(execFile)('git',['clone','--local','--no-hardlinks',original,root],{windowsHide:true});
await cp(original,root,{recursive:true,filter:path=>basename(path)!=='.git'});
const projects=new Projects(join(copy,'registry')), legacy=new JsonRequestStore(join(copy,'legacy'));
let remoteCalls=0;
const unavailable=async()=>{remoteCalls++;throw new Error('Unexpected model or runtime call during reconciliation');};
const service=new ProductionService(projects,legacy,unavailable,{generate:unavailable});
const worker=()=>new MilestoneRuns(new Roadmaps(projects,service),new ProductionArtifacts(service));
const runFile=join(root,'docs/.orchiva/runs',report.runId+'.json');
const baseline=await readFile(join(original,'docs/.orchiva/runs',report.runId+'.json'),'utf8');
try {
  await legacy.open();
  const project=await projects.register(root,'수용 게이트 재현');assert.equal(project.projectId,report.projectId);
  const snapshot=JSON.parse(baseline), last=snapshot.nodes.at(-1), finalId=last.id;
  const accepted=snapshot.history.findIndex(h=>h.event==='accepted '+finalId);
  assert.ok(accepted>=0 && snapshot.state==='completed');
  // Simulate loss of only the run-file write after the v3 transfer committed.
  snapshot.history=snapshot.history.slice(0,accepted);snapshot.revision=snapshot.history.length;snapshot.state='active';snapshot.reason='';
  Object.assign(last,{status:'awaiting-apply',resultId:null,fingerprint:null,files:[],transfers:[]});
  await writeFile(runFile,JSON.stringify(snapshot));
  const requests=await readdir(join(root,'docs/.orchiva/requests'));
  for(let i=0;i<3;i++) {
    const restored=worker();await restored.close();await restored.cycle();
  }
  const replay=JSON.parse(await readFile(runFile,'utf8'));
  assert.equal(replay.state,'completed');
  assert.deepEqual(replay.nodes,JSON.parse(baseline).nodes);
  assert.equal(replay.history.filter(h=>h.event==='accepted '+finalId).length,1);
  assert.deepEqual(await readdir(join(root,'docs/.orchiva/requests')),requests);
  assert.equal(remoteCalls,0);
  assert.equal(await readFile(join(original,'docs/.orchiva/runs',report.runId+'.json'),'utf8'),baseline);
  await writeFile(join(home,'milestone-replay.json'),JSON.stringify({runId:report.runId,removedGate:'accepted '+finalId,
    reconciliations:3,state:replay.state,result:replay.nodes.at(-1).resultId,newRequests:0,modelOrAgentCalls:remoteCalls,originalRunUnchanged:true},null,2));
  console.log('PASS transfer committed before run checkpoint; immutable approval and output recovered exactly once');
} finally { await service.close();await projects.close();await legacy.close(); }
