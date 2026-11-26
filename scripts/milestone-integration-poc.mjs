import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Projects } from '../server/application/desktop/projects.ts';
import { ProductionService } from '../server/application/desktop/production.ts';
import { ProductionArtifacts } from '../server/application/desktop/artifacts.ts';
import { Roadmaps } from '../server/application/desktop/roadmap.ts';
import { MilestoneRuns } from '../server/application/desktop/milestone-run.ts';
import { JsonRequestStore } from '../server/adapters/storage/json-request-store.ts';
import { gitBytes, gitText, ref } from '../server/adapters/storage/integration-git.ts';
import { GhApi, lf } from '../server/adapters/github/milestone-github.ts';

const [mode,originalId,trial,selectedFeature,expectedHead]=process.argv.slice(2);
const featureAction = ['merge','owner-merge','refresh-base'].includes(mode);
assert.ok(featureAction || ['local','required','publish','conflict','verify','verify-owner'].includes(mode));
if (featureAction) assert.match(selectedFeature ?? '', /^[A-E]$/);
if (mode === 'owner-merge') assert.match(expectedHead ?? '', /^[a-f0-9]{40}$/);
assert.match(originalId??'',/^d1-ma-[a-z0-9-]+$/);assert.match(trial??'',/^ma3-[a-z0-9-]+$/);
const root=resolve(import.meta.dirname,'..','.desktop-local'), original=join(root,originalId,'game'), test=join(root,trial);
const source=join(test,'source'), report=JSON.parse(await readFile(join(root,originalId,'milestone-report.json'),'utf8'));
const id=report.projectId, runId=report.runId, branch='orchiva/integration/'+trial;
const repoName='kopite97/PoC-sandbox', repoId=1454742772;
const settings={mode:mode==='required'?'github':'local',target:branch,headPrefix:'orchiva/feature/'+trial,github:{repo:repoName,repoId,base:branch,checks:mode==='required'?['hud']:[]}};
const exec=promisify(execFile), hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(test,{recursive:true});
if(['local','required'].includes(mode) && !(await readdir(test)).includes('source')) {
  await exec('git',['clone','--no-hardlinks',original,source],{windowsHide:true});
  await cp(original,source,{recursive:true,filter:p=>basename(p)!=='.git'});
  await writeFile(join(source,'private-example.txt'),'developer draft\n');
  await writeFile(join(source,'checks','A.test.cjs'),'// developer-only dirty change\n',{flag:'a'});
}
async function dirtyFingerprint() {
  const status=await gitBytes(source,['status','--porcelain=v1','-z','-uall']);
  const files=(await gitBytes(source,['ls-files','--others','--exclude-standard','--cached','-z'])).toString().split('\0').filter(Boolean);
  const sums=[];for(const p of files.sort())sums.push([p,hash(await readFile(join(source,p)))]);
  return hash(Buffer.concat([status,Buffer.from(JSON.stringify(sums))]));
}
const projects=new Projects(join(test,'registry')), legacy=new JsonRequestStore(join(test,'legacy'));
const service=new ProductionService(projects,legacy,async()=>{throw Error('Fixture must reuse original MA2 approvals');});
const runs=new MilestoneRuns(new Roadmaps(projects,service),new ProductionArtifacts(service));
const evidencePath=join(test,'report.json');
try {
  await legacy.open();assert.equal((await projects.register(source,'MA3 replica')).projectId,id);
  const run=await runs.get(id,runId);assert.equal(run.state,'completed');
  const before=await dirtyFingerprint(), git=runs.integrations;
  let state=await projects.exclusive(()=>git.configure(run,settings));
  const sync=(feature,action,body,observedHash)=>projects.exclusive(()=>git.sync(run,{projectId:id,runId,feature,action,body,observedHash,expectedHead}));
  if(mode==='required'){
    state=await projects.exclusive(()=>git.advance(run,state));
    const again=await projects.exclusive(async()=>git.advance(run,await git.get(id,runId)));
    assert.equal(again.entries.length,1);assert.ok(again.entries[0].head);assert.equal(again.entries[0].integrated,null);
    assert.equal(await ref(git.repo(id),branch),state.initial);
    assert.equal(await dirtyFingerprint(),before);
    await writeFile(evidencePath,JSON.stringify({trial,runId,mode:settings.mode,waiting:again.entries[0].feature,unchangedIntegrationSha:state.initial,featureHead:again.entries[0].head,nextFeatureAllocated:false},null,2));
    console.log('PASS remote-required gate survives reopen without integrating A or allocating B');
  } else if(mode==='local') {
    for(const node of run.nodes) {
      state=await projects.exclusive(()=>git.advance(run,state));
      const e=state.entries.find(e=>e.feature===node.id);assert.equal(e.result,node.resultId);assert.ok(e.integrated);
    }
    const repo=git.repo(id), tip=await ref(repo,branch);
    const reopened = await git.get(id,runId);
    const replay = await projects.exclusive(() => git.advance(run,reopened,run.nodes.at(-1).id));
    assert.deepEqual(replay.entries,state.entries);
    assert.equal(await ref(repo,branch),tip);
    let previous=run.scope.baseCommit;
    for(const e of state.entries){
      assert.equal(e.base,previous);assert.equal(await gitText(repo,['rev-parse',e.head+'^']),e.base);
      const diff=(await gitBytes(repo,['diff','--no-renames','--name-only','-z',e.base,e.integrated])).toString().split('\0').filter(Boolean);
      const n=run.nodes.find(n=>n.id===e.feature);
      assert.deepEqual(diff,n.files.map(f=>f.path));
      for(const f of n.files)assert.equal(hash(await gitBytes(repo,['show',e.integrated+':'+f.path])),f.hash);
      previous=e.integrated;
    }
    assert.equal(tip,previous);
    const audit=join(test,'integrated-checkout');
    if(!(await readdir(test)).includes('integrated-checkout'))await exec('git',['clone','-b',branch,'--no-hardlinks',repo,audit],{windowsHide:true});
    assert.equal(await gitText(audit,['rev-parse','HEAD']),tip);
    const tests=await exec(process.execPath,['--test',...run.nodes.map(n=>'checks/'+n.id+'.test.cjs')],{cwd:audit,windowsHide:true});
    assert.equal(await dirtyFingerprint(),before);
    await writeFile(evidencePath,JSON.stringify({trial,projectId:id,runId,branch,base:run.scope.baseCommit,tip,unchangedSource:before,
      files:(await gitText(repo,['diff','--name-only',run.scope.baseCommit,tip])).split('\n'),entries:state.entries,tests:tests.stdout},null,2));
    console.log('PASS '+state.entries.length+' MA2 approvals on '+branch+' at '+tip);
  } else if (mode === 'verify-owner') {
    const api = new GhApi(), get = path => api.call('GET','repos/'+repoName+'/'+path);
    const original = JSON.parse(await readFile(evidencePath,'utf8'));
    const policy = await get('branches/'+encodeURIComponent(branch)+'/protection');
    assert.equal(policy.enforce_admins.enabled,true);
    assert.equal(policy.required_status_checks.strict,true);
    assert.equal(policy.required_pull_request_reviews.required_approving_review_count,0);
    const checkName = 'ma3-approved-output';
    assert.deepEqual(policy.required_status_checks.checks,[{context:checkName,app_id:15368}]);
    const main = (await get('git/ref/heads/main')).object.sha;
    assert.equal(main,original.remoteTarget.main);
    const owner = (await api.call('GET','repos/'+repoName)).owner;
    const rows = [];
    let previous = original.remoteTarget.tip;
    for (const feature of ['A','B','C','D','E']) {
      const entry = state.entries.find(e=>e.feature===feature), remote=entry.remote;
      const [pr,issue,commit,head,checks,files,reviews] = await Promise.all([
        get('pulls/'+remote.pr), get('issues/'+remote.issue), get('git/commits/'+remote.merge), get('git/commits/'+remote.head),
        get('commits/'+remote.head+'/check-runs?check_name='+checkName), get('pulls/'+remote.pr+'/files'),
        api.list('repos/'+repoName+'/pulls/'+remote.pr+'/reviews?per_page=100')
      ]);
      const {gate} = remote;
      assert.equal(remote.phase,'merged');assert.equal(gate.mode,'owner');assert.deepEqual(gate.reviewers,[]);
      assert.equal(pr.base.ref,branch);assert.ok(pr.merged);assert.equal(pr.merge_commit_sha,remote.merge);
      assert.equal(pr.head.sha,gate.head);assert.equal(gate.head,remote.head);assert.equal(gate.base,previous);
      assert.equal(owner.id,gate.actor);assert.equal(pr.merged_by.id,owner.id);assert.equal(pr.user.id,owner.id);
      assert.equal(issue.state,'closed');assert.equal(issue.closed_by.id,owner.id);assert.equal(lf(issue.body),lf(remote.lastBody));
      assert.equal(reviews.length,0);assert.deepEqual(commit.parents.map(p=>p.sha),[previous,gate.head]);assert.equal(commit.tree.sha,head.tree.sha);
      const [check] = checks.check_runs;assert.equal(checks.total_count,1);assert.equal(check.app.id,15368);
      assert.equal(check.head_sha,gate.head);assert.equal(check.conclusion,'success');assert.ok(Date.parse(check.completed_at)<=Date.parse(pr.merged_at));
      const [approved] = report.nodes.find(n=>n.id===feature).files;
      assert.equal(pr.changed_files,1);assert.equal(files.length,1);assert.equal(files[0].filename,approved.path);
      assert.equal(hash(Buffer.from((await get('git/blobs/'+files[0].sha)).content,'base64')),approved.hash);
      rows.push({feature,pr:pr.html_url,issue:issue.html_url,file:approved.path,sha256:approved.hash,base:previous,
        head:gate.head,check:check.html_url,checkCompletedAt:check.completed_at,approvedAt:gate.at,merge:remote.merge,
        mergedAt:pr.merged_at,closedAt:issue.closed_at,actor:pr.merged_by.login,approval:gate.mode,reviewCount:reviews.length});
      previous=remote.merge;
    }
    assert.equal((await get('git/ref/heads/'+branch)).object.sha,previous);
    const tree=await get('git/trees/'+previous+'?recursive=1');
    assert.equal(tree.truncated,false);assert.deepEqual(tree.tree.map(f=>f.path).sort(),rows.map(r=>r.file).sort());
    await Promise.all(tree.tree.map(async file => {
      const row = rows.find(r=>r.file===file.path);
      assert.equal(file.mode,'100644');
      const blob = await get('git/blobs/'+file.sha);
      assert.equal(hash(Buffer.from(blob.content,'base64')),row.sha256);
    }));
    assert.equal(await dirtyFingerprint(),before);
    await writeFile(join(test,'owner-acceptance.json'),JSON.stringify({repository:repoName,branch,main,tip:previous,
      requiredReviewers:0,strict:true,enforceAdmins:true,check:checkName,independentReview:'unverified',rows},null,2)+'\n');
    console.log('PASS five checked owner merges, five closed Issues, and five approved files at '+previous);
  } else if (featureAction) {
    const api = new GhApi();
    const entry = state.entries.find(e => e.feature === selectedFeature);
    assert.ok(entry?.remote?.pr && entry.remote.issue);
    let error;
    try { await sync(selectedFeature,mode,entry.remote.body); }
    catch (cause) { error=cause; }
    const latest = (await git.get(id,runId)).entries.find(e => e.feature === selectedFeature).remote;
    const pr = await api.call('GET','repos/'+repoName+'/pulls/'+latest.pr);
    const issue = await api.call('GET','repos/'+repoName+'/issues/'+latest.issue);
    const proof = {feature:selectedFeature,pr:pr.html_url,head:pr.head.sha,base:pr.base.sha,merged:pr.merged,
      merge:latest.merge,issue:issue.html_url,issueState:issue.state,phase:latest.phase,gate:latest.gate,
      protectedChecks:latest.protectedChecks,lastError:latest.lastError};
    await writeFile(join(test,mode+'-'+selectedFeature+'.json'), JSON.stringify(proof,null,2));
    console.log(JSON.stringify(proof));
    if (error) throw error;
    if (mode === 'refresh-base') {
      const target = await api.call('GET','repos/'+repoName+'/git/ref/heads/'+branch);
      assert.ok(!pr.merged && latest.head === pr.head.sha && latest.base === target.object.sha);
    }
    else assert.ok(pr.merged && latest.merge === pr.merge_commit_sha && issue.state === 'closed' && latest.phase === 'merged');
    assert.equal(await dirtyFingerprint(),before);
  } else {
    const summaries={A:'Define the score rule as 10.',B:'Define SCORE as the HUD label.',C:'Provide a score value of 10.',D:'Display SCORE 10 in the HUD.',E:'Record the expected score in the QA fixture.'};
    const api=new GhApi(), evidence=JSON.parse(await readFile(evidencePath,'utf8'));
    if(mode==='publish')for(const [feature,summary] of Object.entries(summaries)){
      const spec=run.scope.nodes.find(n=>n.id===feature);
      const body='# HUD fixture '+feature+'\n\n'+summary+'\n\nOutput: `'+spec.outputs[0]+'`\nDependencies: '+(spec.dependsOn.join(', ')||'none')+'\n\nAcceptance: the corresponding fixed HUD fixture check passes.\n';
      const approvedBody=state.entries.find(e=>e.feature===feature)?.remote?.body??body;
      state=await sync(feature,'publish',approvedBody);
      const e=state.entries.find(e=>e.feature===feature);assert.equal(e.remote.phase,'awaiting-review');
      const changed=await api.list('repos/'+repoName+'/pulls/'+e.remote.pr+'/files?per_page=100');
      assert.deepEqual(changed.map(f=>f.filename),spec.outputs);
      console.log(feature+' issue #'+e.remote.issue+' PR #'+e.remote.pr);
    }
    if(mode==='conflict'){
      const e=state.entries.find(e=>e.feature==='B'), path='repos/'+repoName+'/issues/'+e.remote.issue;
      const issue=await api.call('GET',path);
      const note='This fixture uses an uppercase label.';
      if(!issue.body.includes(note))await api.call('PATCH',path,{body:issue.body.replace('Define SCORE as the HUD label.','Define SCORE as the HUD label. '+note)});
      state=await sync('B','observe',e.remote.body);const prior=state.entries.find(e=>e.feature==='B').remote;
      if(prior.phase==='body-conflict'){
        await sync('B','adopt',prior.body,hash(prior.remoteBody));
        state=await sync('B','observe',prior.body);
      }
      const accepted=state.entries.find(e=>e.feature==='B').remote;
      assert.ok(accepted.body.includes(note));assert.equal(lf((await api.call('GET',path)).body),lf(accepted.lastBody));
      evidence.externalEdit={feature:'B',resolution:'adopt',hash:hash(lf(accepted.lastBody))};
    }
    const issues=await api.list('repos/'+repoName+'/issues?state=all&per_page=100');
    const pulls=await api.list('repos/'+repoName+'/pulls?state=all&base='+encodeURIComponent(branch)+'&per_page=100');
    evidence.github=[];
    for(const e of state.entries.filter(e=>e.remote?.pr)){
      const pr=await api.call('GET','repos/'+repoName+'/pulls/'+e.remote.pr);
      const issue=await api.call('GET','repos/'+repoName+'/issues/'+e.remote.issue);
      assert.equal(pr.state,'open');assert.equal(pr.merged,false);assert.equal(pr.base.ref,branch);
      const marker='<!-- orchiva-plan:'+hash(repoId+'/'+e.token)+' -->';
      assert.equal(issues.filter(i=>!i.pull_request && i.body?.includes(marker)).length,1);
      assert.equal(pulls.filter(p=>p.head.ref===e.branch).length,1);
      assert.equal(lf(issue.body),lf(e.remote.lastBody));
      const localBody=await readFile(join(test,'registry','integrations',id,runId,'public',e.token,hash(lf(issue.body))+'.md'),'utf8');
      assert.equal(localBody,lf(issue.body));
      evidence.github.push({feature:e.feature,issue:issue.html_url,pr:pr.html_url,base:pr.base.sha,head:pr.head.sha,issueBodyHash:hash(lf(issue.body)),merged:pr.merged});
    }
    assert.equal(evidence.github.length,5);
    if (evidence.externalEdit) {
      const adopted = state.entries.find(e => e.feature === evidence.externalEdit.feature).remote;
      const observed = evidence.github.find(e => e.feature === evidence.externalEdit.feature);
      assert.equal(hash(lf(adopted.lastBody)),observed.issueBodyHash);
      evidence.externalEdit.hash=observed.issueBodyHash;
    }
    const initialRemote=await api.call('GET','repos/'+repoName+'/git/ref/heads/main');
    const integrationRemote=await api.call('GET','repos/'+repoName+'/git/ref/heads/'+branch);
    assert.equal(integrationRemote.object.sha,initialRemote.object.sha);
    evidence.remoteTarget={repository:repoName,repoId,base:branch,main:initialRemote.object.sha,tip:integrationRemote.object.sha,openPullRequests:5,mergedPullRequests:0};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2));assert.equal(await dirtyFingerprint(),before);
    console.log('PASS 5 unique plan mappings, open PRs and public PLAN hashes');
  }
} finally {await runs.close();await service.close();await projects.close();await legacy.close();}
