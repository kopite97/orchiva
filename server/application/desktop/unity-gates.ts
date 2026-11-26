import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { unityEvidence, type UnityEvidence, type Run } from "../../../shared/contracts/milestone-run";
import { absent, atomic } from "../../adapters/storage/project-files";
import { editorReserved, runUnityGate } from "../../adapters/unity/gate";
import type { Projects } from "./projects";

const ticket=unityEvidence.extend({key:z.string()});
type Ticket=z.infer<typeof ticket>;

// The worker never writes a gate decision in the developer's project checkout.
export class UnityGates {
  private job?:Promise<void>;
  private readonly storage:string;
  constructor(private projects:Projects,private execute=runUnityGate) {
    this.storage=join(projects.directory,"unity-validation");
  }
  private path(run:Run) {return join(this.storage,"runs",run.projectId,run.runId+".json");}
  async list(run:Run):Promise<Ticket[]> {
    try {return z.array(ticket).parse(JSON.parse(await readFile(this.path(run),"utf8")));}
    catch(error){if(absent(error))return [];throw error;}
  }
  // All index mutations are serialized by Projects.exclusive. A stopped process
  // can leave a completed result before it publishes the terminal index entry.
  private async finish(run:Run,row:Ticket) {
    const rows=await this.list(run), i=rows.findIndex(x=>x.attempt===row.attempt);
    if(i<0 || rows[i].status!=="running")return;
    rows[i]=row;await atomic(this.path(run),JSON.stringify(rows));
  }
  async recover(run:Run) {
    if(this.job)return;
    for(const row of (await this.list(run)).filter(r=>r.status==="running")) {
      let state:Partial<UnityEvidence>;
      try{
        const raw=JSON.parse(await readFile(join(row.directory,"result.json"),"utf8"));
        if(raw.sha!==row.sha || raw.attempt!==row.attempt || raw.profile!=="hud-win64-v1")throw Error("UNITY_EVIDENCE_IDENTITY");
        state={status:raw.status,reason:raw.reason,playerHash:raw.playerHash,hud:raw.signal?.after};
      }catch(e){
        if(!absent(e))throw e;
        state={status:"blocked",reason:"UNITY_ATTEMPT_INTERRUPTED"};
      }
      await this.finish(run,ticket.parse({...row,...state}));
    }
  }
  async schedule(run:Run,repo:string,node:Run["nodes"][number],kind:"plan"|"integration",key:string) {
    if(!node.integrationSha || node.status!=="accepted")throw Error("INTEGRATION_PREDECESSOR_REQUIRED");
    await this.recover(run);
    const rows=await this.list(run), prior=rows.find(r=>r.key===key);
    if(prior){
      if(prior.feature!==node.id || prior.kind!==kind || prior.sha!==node.integrationSha)throw Error("IDEMPOTENCY_CONFLICT");
      return prior;
    }
    if(this.job)throw Error("UNITY_EDITOR_BUSY");
    const attempt=randomUUID();
    const row:Ticket={key,feature:node.id,milestone:node.milestone,sha:node.integrationSha,kind,attempt,status:"running",reason:"",directory:join(this.storage,attempt)};
    rows.push(row);await atomic(this.path(run),JSON.stringify(rows));
    const tests=run.scope.nodes.find(n=>n.id===node.id)?.unityTests;
    this.job=this.execute(repo,row.sha,this.storage,attempt,kind,tests,!!run.scope.acceptance)
      .then(r=>({...row,status:r.status,reason:r.reason,playerHash:r.playerHash,hud:r.signal?.after}))
      .catch(e=>({...row,status:"blocked" as const,reason:e instanceof Error?e.message:"UNITY_ERROR"}))
      .then(result=>this.projects.exclusive(()=>this.finish(run,result)))
      .finally(()=>{this.job=undefined;});
    // The persisted attempt can be reconciled on the next tick if publishing fails.
    void this.job.catch(()=>{});
    return row;
  }
  async busy(){return !!this.job || await editorReserved(this.storage);}
  async close(){await this.job;}
}
