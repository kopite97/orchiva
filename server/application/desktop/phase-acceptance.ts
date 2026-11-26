import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { decidePhase, phaseDecision, type PhaseDecision, type PhaseReview } from "../../../shared/contracts/phase-acceptance";
import type { Run } from "../../../shared/contracts/milestone-run";
import type { Roadmaps } from "./roadmap";
import type { Integrations } from "./integration";
import type { UnityGates } from "./unity-gates";
import { absent, atomic, bytes, digest } from "../../adapters/storage/project-files";
import { desktopError } from "../../../shared/contracts/desktop-errors";
import { verifyPlayableLevel } from "../../domain/playable-level";
import { ref, treeFile } from "../../adapters/storage/integration-git";
import { fileHash, inventory } from "../../adapters/unity/evidence";

export class PhaseAcceptance {
  constructor(private roadmaps:Roadmaps, private integrations:Integrations,private unity:UnityGates,
    private getRun:(id:string,rid:string)=>Promise<Run>, private listRuns:(id:string)=>Promise<string[]>, private verifyRun:(run:Run)=>Promise<void>) {}
  private path(id:string){return "acceptance/"+id+"/decisions.json";}
  private async history(id:string){
    const raw=await bytes(this.roadmaps.projects.directory,this.path(id),8*1024*1024);
    return raw?z.array(phaseDecision).parse(JSON.parse(raw.toString())):[];
  }
  review(run:Run, verifyBuild=false){return this.inspect(run,verifyBuild,true);}
  private async inspect(run:Run, verifyBuild:boolean,requireTip:boolean):Promise<PhaseReview> {
    const {roadmap,revision}=await this.roadmaps.read(run.projectId);
    const index=roadmap.phases.findIndex(p=>p.id===run.selection.phase);
    const decisions=(await this.history(run.projectId)).filter(d=>d.runId===run.runId);
    const times=run.history.map(h=>Date.parse(h.at));
    const result:PhaseReview={eligible:false,reason:"",next:index>=0?roadmap.phases[index+1]?.id??null:null,
      elapsedMs:times.length?times[times.length-1]-times[0]:0,calls:0,decisions};
    try {
      if(!run.scope.acceptance)throw Error("PHASE_PROFILE_REQUIRED");
      const store=await this.roadmaps.production.store(run.projectId);
      const production=await store.all();
      if(production.issues.length)throw Error("PROJECT_RECORD_INVALID");
      const requests=production.records.filter(doc=>doc.milestone?.runId===run.runId);
      result.calls=requests.reduce((total,doc)=>total+doc.journals.filter(j=>["plan","start","resume"].includes(j.kind)).length,0);
      if(!await this.integrations.get(run.projectId,run.runId))throw Error("PHASE_LOCAL_EVIDENCE_REQUIRED");
      if(index<0 || revision!==run.scope.revision)throw Error("PHASE_POLICY_CHANGED");
      const milestones=roadmap.phases[index].milestones.map(m=>m.id);
      if(JSON.stringify(milestones)!==JSON.stringify(run.scope.milestones))throw Error("PHASE_PARTIAL_RANGE");
      if(run.state!=="completed" || !run.integration || !run.nodes.length || run.nodes.some(n=>n.status!=="accepted"))throw Error("PHASE_RUN_INCOMPLETE");
      for(const id of await this.listRuns(run.projectId)){
        if(id===run.runId)continue;
        const other=await this.getRun(run.projectId,id);
        if(other.selection.phase===run.selection.phase && other.integration?.target===run.integration.target &&
          other.history[0]?.at>run.history[0]?.at && JSON.stringify(other.scope.milestones)===JSON.stringify(milestones))
          throw Error("PHASE_RUN_SUPERSEDED");
      }
      await this.verifyRun(run);
      const proof=[];
      const gates=await this.unity.list(run);
      for(const n of run.nodes){
        const doc=requests.find(request=>request.token===n.token);
        if(!doc)throw Error("PHASE_REQUIRED_CHECK");
        const r=doc.engine.result, review=doc.reviews.at(-1);
        const spec=run.scope.nodes.find(f=>f.id===n.id)!;
        if(!r || !r.fingerprint || r.id!==n.resultId || r.fingerprint!==n.fingerprint || r.failure || r.executionFailure || !review?.approved || review.fingerprint!==r.fingerprint || review.resultId!==r.id ||
          !doc.milestone || !spec.checks.length || spec.checks.length!==r.checks.length ||
          spec.checks.some(path=>!r.checks.some(check=>check.label===path && check.passed &&
            doc.milestone?.checks.some(c=>c.path===path && c.hash===check.inputFingerprint))))throw Error("PHASE_REQUIRED_CHECK");
        if(doc.milestone.runId!==run.runId || doc.milestone.item!==n.id || doc.milestone.scopeHash!==run.scopeHash)throw Error("PHASE_REQUIRED_CHECK");
        if(spec.unityTests?.length && gates.filter(g=>g.kind==="plan" && g.feature===n.id && g.sha===n.integrationSha).at(-1)?.status!=="passed")throw Error("PHASE_REQUIRED_CHECK");
        proof.push({result:r.id,fingerprint:r.fingerprint,checks:r.checks.map(c=>c.inputFingerprint),files:n.files});
      }
      const sha=run.nodes.at(-1)!.integrationSha;
      if(!sha || (requireTip && await ref(this.integrations.repo(run.projectId),run.integration.target)!==sha))throw Error("PHASE_BRANCH_CHANGED");
      for(const id of milestones){
        const node=run.nodes.filter(n=>n.milestone===id).at(-1)!;
        if(gates.filter(g=>g.kind==="integration" && g.feature===node.id && g.sha===node.integrationSha).at(-1)?.status!=="passed")
          throw Error("PHASE_BUILD_REQUIRED");
      }
      const gate=gates.filter(g=>g.kind==="integration" && g.sha===sha).at(-1)!;
      const build=JSON.parse(await readFile(join(gate.directory,"result.json"),"utf8"));
      const artifact=join(gate.directory,"build","Hud.exe");
      if(!build.level?.cleared || build.status!=="passed" || build.sha!==sha || build.attempt!==gate.attempt || !build.playerHash || build.playerHash!==gate.playerHash || !build.buildHash)
        throw Error("PHASE_BUILD_CHANGED");
      if(verifyBuild && (await fileHash(artifact)!==build.playerHash ||
        digest(JSON.stringify(await inventory(join(gate.directory,"build"),true),null,2))!==build.buildHash))throw Error("PHASE_BUILD_CHANGED");
      const asset=await treeFile(this.integrations.repo(run.projectId),sha,"Assets/Resources/Route.json");
      if(!asset)throw Error("PHASE_LEVEL_INVALID");
      const level=verifyPlayableLevel(asset.bytes,build.level);
      Object.assign(result,{eligible:true,level,sha,artifact,playerHash:build.playerHash,buildHash:build.buildHash,
        basis:digest(JSON.stringify({project:run.projectId,run:run.runId,scope:run.scopeHash,sha,proof,attempt:gate.attempt,build:build.buildHash}))});
    } catch(e){result.reason=desktopError(e)??"PHASE_EVIDENCE_INVALID";}
    return result;
  }
  async decide(input:z.infer<typeof decidePhase>){
    return this.roadmaps.projects.exclusive(async()=>{
      const run=await this.getRun(input.projectId,input.runId), all=await this.history(input.projectId);
      const prior=all.find(d=>d.commandKey===input.commandKey);
      if(prior){
        if(prior.runId!==input.runId || prior.basis!==input.basis || prior.verdict!==input.verdict || prior.note!==input.note)throw Error("IDEMPOTENCY_CONFLICT");
        return this.review(run);
      }
      const review=await this.review(run,true);
      if(!review.eligible || review.basis!==input.basis)throw Error(review.reason || "PHASE_EVIDENCE_CHANGED");
      const gate=(await this.unity.list(run)).filter(g=>g.kind==="integration" && g.sha===review.sha).at(-1)!;
      const decision:PhaseDecision={...input,at:new Date().toISOString(),phase:run.selection.phase,next:review.next,
        roadmapRevision:run.scope.revision,sources:run.nodes.map(n=>({featureId:n.id,token:n.token,resultId:n.resultId!,fingerprint:n.fingerprint!})),
        attempt:gate.attempt,sha:review.sha!,buildHash:review.buildHash!,playerHash:review.playerHash!};
      const updated=JSON.stringify([...all,decision]);
      if(Buffer.byteLength(updated)>8*1024*1024)throw Error("INPUT_SIZE_LIMIT");
      await atomic(join(this.roadmaps.projects.directory,this.path(input.projectId)),updated);
      return {...review,decisions:[...review.decisions,decision]};
    });
  }
  async recordAdmission(run:Run,basis:string){
    await atomic(join(this.roadmaps.projects.directory,"acceptance",run.projectId,"admissions",run.runId+".json"),
      JSON.stringify({phase:run.selection.phase,scope:run.scopeHash,basis}));
  }
  async requirePrevious(id:string,phase:string,target:string){
    const {roadmap}=await this.roadmaps.read(id);
    const index=roadmap.phases.findIndex(p=>p.id===phase);
    if(index===0)return;
    const previous=roadmap.phases[index-1]?.id;
    const decision=(await this.history(id)).filter(d=>d.phase===previous).at(-1);
    if(decision?.verdict!=="approve" || decision.next!==phase)throw Error("PHASE_APPROVAL_REQUIRED");
    const prior=await this.getRun(id,decision.runId), review=await this.inspect(prior,true,false);
    if(prior.integration?.target!==target || !review.eligible || review.basis!==decision.basis)throw Error("PHASE_APPROVAL_STALE");
    const tip=await ref(this.integrations.repo(id),target);
    if(tip!==decision.sha){
      // Later ranges may continue through integrations previously admitted on this exact approval.
      const dir=join(this.roadmaps.projects.directory,"acceptance",id,"admissions");
      const files=await readdir(dir).catch(e=>{if(absent(e))return [];throw e;});
      const parents=new Map<string,string>();
      for(const file of files.filter(f=>f.endsWith(".json"))){
        const grant=JSON.parse(await readFile(join(dir,file),"utf8"));
        if(grant.basis!==decision.basis || grant.phase!==phase)continue;
        const integration=await this.integrations.get(id,file.slice(0,-5));
        if(!integration || integration.settings.target!==target || integration.scopeHash!==grant.scope)continue;
        for(const entry of integration.entries)if(entry.integrated)parents.set(entry.integrated,entry.base);
      }
      let cursor=tip;const seen=new Set<string>();
      while(cursor && cursor!==decision.sha && !seen.has(cursor)){
        seen.add(cursor);cursor=parents.get(cursor)??null;
      }
      if(cursor!==decision.sha)throw Error("PHASE_APPROVAL_STALE");
    }
    return decision.basis;
  }
}
