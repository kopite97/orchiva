import { UnityGates } from "./unity-gates";
import type { requestUnity, UnityEvidence } from "../../../shared/contracts/milestone-run";
import { readdir } from "node:fs/promises";
import type { z } from "zod";
import { type Binding, type Run, createRun, controlRun, runRecord, runView } from "../../../shared/contracts/milestone-run";
import { scopeSchema } from "../../../shared/contracts/milestone-roadmap";
import { payloadHash } from "../../domain/record-v2";
import type { Production, ProductionInput } from "../../../shared/contracts/desktop-production";
import { absent, atomic, bytes, digest, safePath } from "../../adapters/storage/project-files";
import { Integrations } from "./integration";
import { gitText, ref, treeFile } from "../../adapters/storage/integration-git";
import { loadSnapshot } from "./snapshots";
import type { Roadmaps } from "./roadmap";
import type { ProductionArtifacts } from "./artifacts";

import { featureResources, resourceConflict } from "./parallel-resources";
import { productionBusy } from "../../adapters/storage/production-store";
type WorkerNode = Run["nodes"][number];
const holdsClaim = (node:WorkerNode) => !!node.lease && !["accepted","awaiting-integration"].includes(node.status);
const computing = (node:WorkerNode) => holdsClaim(node) && !node.parked;
const prefix = "docs/.orchiva/runs/";
const key = (...parts: string[]) => "ma-" + digest(JSON.stringify(parts)).slice(0, 40);
const message = (e: unknown) => e instanceof Error ? e.message : "MILESTONE_RUN_INVALID";
const token = (run: string, kind: string, id: string) => key(run, kind, id);
type Effect = { projectId: string; token: string; input: ProductionInput; bound: Binding };

import { PhaseAcceptance } from "./phase-acceptance";
export class MilestoneRuns {
  private timer?: ReturnType<typeof setTimeout>;
  private working?: Promise<void>;
  private stopped = false;
  readonly integrations:Integrations;
  readonly unity:UnityGates;
  readonly phases:PhaseAcceptance;
  constructor(private roadmaps: Roadmaps, private artifacts: ProductionArtifacts) {
    this.unity=new UnityGates(roadmaps.projects);
    this.production.unityBusy=()=>this.unity.busy();
    this.integrations=new Integrations(roadmaps.production,artifacts);
    this.phases=new PhaseAcceptance(roadmaps,this.integrations,this.unity,(id,rid)=>this.get(id,rid),id=>this.ids(id),async run=>{await this.checkScope(run);await this.checkFiles(run);});
    this.production.reservations = async id => {
      const claims = [];
      for (const rid of await this.ids(id)) {
        const run = await this.get(id,rid);
        if (run.workers !== 2 || ["completed","cancelled"].includes(run.state)) continue;
        for (const node of run.nodes.filter(holdsClaim))
          claims.push({token:node.token,runId:rid,generation:node.lease!.generation});
      }
      return claims;
    };
  }
  private get projects() { return this.roadmaps.projects; }
  private get production() { return this.roadmaps.production; }

  async get(id: string, runId: string) {
    const { sourceRoot } = await this.projects.project(id);
    const raw = await bytes(sourceRoot, prefix + runId + ".json", 4 * 1024 * 1024);
    if (!raw) throw new Error("NOT_FOUND");
    let run:Run;
    try {run=runRecord.parse(JSON.parse(raw.toString("utf8")));} catch {throw new Error("MILESTONE_RUN_INVALID");}
    if (run.projectId !== id || run.runId !== runId || run.scopeHash !== run.scope.hash) throw new Error("MILESTONE_RUN_INVALID");
    if (run.nodes.length !== run.scope.nodes.length || run.nodes.some((node, i) =>
      node.id !== run.scope.nodes[i].id || node.milestone !== run.scope.nodes[i].milestone || node.token !== token(runId, "feature", node.id))) throw new Error("MILESTONE_RUN_INVALID");
    if (run.workers===2) {
      const held=run.nodes.filter(n=>n.lease && n.status!=="accepted");
      if (run.integration?.mode!=="local" || run.nodes.filter(computing).length>2 ||
          run.nodes.some(n=>n.parked && (!holdsClaim(n) || !["failed","plan-failed"].includes(n.status))) || run.nodes.some(n=>n.lease && n.lease.generation>run.revision) ||
          held.some((node,i)=>held.slice(i+1).some(peer=>resourceConflict(node.lease!.resources,peer.lease!.resources)))) throw new Error("MILESTONE_RUN_INVALID");
    }
    return run;
  }
  private async ids(id: string) {
    const { sourceRoot } = await this.projects.project(id);
    try { return (await readdir(await safePath(sourceRoot, "docs/.orchiva/runs"))).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)); }
    catch (e) { if (absent(e)) return []; throw e; }
  }
  async list(id:string) {
    return Promise.all((await this.ids(id)).map(async runId=>{
      try { const {selection,state}=await this.get(id,runId);return {runId,selection,state}; }
      catch { return {runId,state:"invalid" as const,issue:"MILESTONE_RUN_INVALID" as const}; }
    }));
  }
  private async assertAvailable(id:string, except?:string) {
    const runs=await this.list(id);
    if(runs.some(r=>r.state==="invalid")) throw new Error("MILESTONE_RUN_INVALID");
    if(runs.some(r=>r.runId!==except && r.state==="active")) throw new Error("MILESTONE_RUN_BUSY");
  }
  private async put(run: Run, event: string) {
    const { sourceRoot } = await this.projects.project(run.projectId);
    await this.projects.own(sourceRoot);
    run.revision++; run.history.push({ event, at: new Date().toISOString() });
    await atomic(await safePath(sourceRoot, prefix + run.runId + ".json"), JSON.stringify(run));
  }
  async create(input: z.infer<typeof createRun>) {
    const result = await this.projects.exclusive(async () => {
      const hash = digest(JSON.stringify(input)), ids = await this.ids(input.projectId);
      if (ids.includes(input.runId)) {
        const old = await this.get(input.projectId, input.runId);
        if (old.commands[0].hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
        return old;
      }
      if(input.unityProfile && !input.integration)throw Error("INTEGRATION_REQUIRED");
      if (input.workers === 2 && input.integration?.mode !== "local") throw new Error("MILESTONE_LOCAL_INTEGRATION_REQUIRED");
      if (input.parent && !ids.includes(input.parent)) throw new Error("NOT_FOUND");
      await this.assertAvailable(input.projectId);
      const scope = await this.roadmaps.preview(input.projectId, input.selection);
      if (scope.issues.length || scope.hash !== input.scopeHash) throw new Error("MILESTONE_INPUT_CHANGED");
      let admission:string|undefined;
      if(scope.acceptance) {
        if(!input.integration)throw Error("PHASE_INTEGRATION_REQUIRED");
        admission=await this.phases.requirePrevious(input.projectId,input.selection.phase,input.integration.target);
      }
      const run: Run = {
        ...input, ...(scope.acceptance?{unityProfile:"hud-win64-v1" as const}:{}), version: 1, revision: 0, scope, state: "active", reason: "", history: [], commands: [{ key: input.runId, hash }],
        nodes: scope.nodes.map(n => ({ id: n.id, milestone: n.milestone, token: token(input.runId, "feature", n.id), status: "waiting", resultId: null, fingerprint: null, files: [], transfers: [] })),
        advisors: scope.milestones.map(m => ({ milestone: m, token: token(input.runId, "advisor", m), status: scope.nodes.filter(n => n.milestone === m).length === 1 ? "skipped" : "pending", report: "", planHash: null }))
      };
      if(run.integration) run.integrationInitial=(await this.integrations.configure(run,run.integration)).initial;
      if(admission)await this.phases.recordAdmission(run,admission);
      await this.put(run, "범위 확정 및 요청 키 배정"); return run;
    });
    this.wake(); return runView.parse(result);
  }
  async control(i: z.infer<typeof controlRun>) {
    const result = await this.projects.exclusive(async () => {
      const run = await this.get(i.projectId, i.runId), hash = digest(JSON.stringify(i)), prior = run.commands.find(c => c.key === i.commandKey);
      if (prior) { if (prior.hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT"); return run; }
      if (run.revision !== i.expectedRevision || ["completed","cancelled"].includes(run.state)) throw new Error("REVISION_CONFLICT");
      if (i.action === "resume") {
        await this.assertAvailable(i.projectId,i.runId);
        await this.checkScope(run); await this.checkFiles(run);
      }
      if (i.action==="cancel") {
        await this.unity.recover(run);
        if((await this.unity.list(run)).some(r=>r.status==="running"))throw Error("UNITY_EDITOR_BUSY");
        const all=await (await this.production.store(run.projectId)).all();
        if (all.issues.length || all.records.some(doc=>doc.milestone?.runId===run.runId && productionBusy(doc))) throw new Error("MILESTONE_WORKER_ACTIVE");
        run.state="cancelled";run.reason="사용자 취소";run.commands.push({key:i.commandKey,hash});await this.put(run,"cancel");return run;
      }
      run.state = i.action === "pause" ? "paused" : "active"; run.reason = ""; run.commands.push({ key: i.commandKey, hash });
      await this.put(run, i.action); return run;
    });
    this.wake(); return runView.parse(result);
  }
  private async checkScope(run: Run) {
    const current = await this.roadmaps.preview(run.projectId, run.selection);
    if (current.hash !== run.scopeHash || current.issues.length || payloadHash(scopeSchema.parse(current)) !== payloadHash(run.scope)) throw new Error("MILESTONE_INPUT_CHANGED");
  }
  private async checkFiles(run: Run) {
    const { sourceRoot } = await this.projects.project(run.projectId);
    const latest = new Map<string, string | null>();
    for (const external of run.scope.external) {
      const doc = await this.production.required(run.projectId, external.token);
      if (doc.milestone?.integrationBase) {
        const prior=await this.get(run.projectId,doc.milestone.runId);
        const node=prior.nodes.find(n=>n.id===external.featureId && n.token===external.token && n.status==="accepted");
        const entry=(await this.integrations.outputs(prior)).find(e=>e.feature===node?.id);
        if(!node?.integrationSha || entry?.integrated!==node.integrationSha || entry.result!==external.resultId || entry.fingerprint!==external.fingerprint)
          throw new Error("INTEGRATION_PREDECESSOR_REQUIRED");
        const repo=this.integrations.repo(run.projectId);
        if(run.integration) await gitText(repo,["merge-base","--is-ancestor",node.integrationSha,run.integrationInitial??run.scope.baseCommit]);
        for(const file of node.files) {
          const source=await treeFile(repo,node.integrationSha,file.path);
          if((source?digest(source.bytes):null)!==file.hash)throw new Error("INTEGRATION_TREE_MISMATCH");
          latest.set(file.path,file.hash);
        }
        continue;
      }
      const transfers = await this.artifacts.transfers(run.projectId, external.token, external.resultId);
      const files = transfers.filter(t => t.state === "applied").flatMap(t => t.files);
      if (!files.length || (doc.milestone && (doc.milestone.item !== external.featureId || doc.milestone.outputs.some(path => !files.some(f => f.path === path))))) throw new Error("MILESTONE_TRANSFER_CHANGED");
      for (const f of files) latest.set(f.path, f.after);
    }
    for (const h of run.history.filter(h => h.event.startsWith("accepted "))) {
      const node = run.nodes.find(n => n.id === h.event.slice(9))!;
      if(run.integration) {
        const record=(await this.integrations.outputs(run)).find(e=>e.feature===node.id);
        if(!record || record.integrated!==node.integrationSha || record.result!==node.resultId || record.fingerprint!==node.fingerprint) throw new Error("INTEGRATION_PREDECESSOR_REQUIRED");
        for(const f of node.files) latest.set(f.path,f.hash);
        continue;
      }
      const applied = (await this.artifacts.transfers(run.projectId, node.token, node.resultId!)).filter(t => t.state === "applied");
      if (!node.transfers.every(key => applied.some(t => t.key === key))) throw new Error("MILESTONE_TRANSFER_CHANGED");
      for (const file of node.files) latest.set(file.path, file.hash);
    }
    for (const [path, hash] of latest) {
      const commit=run.nodes.filter(n=>n.integrationSha).at(-1)?.integrationSha??run.integrationInitial??run.scope.baseCommit;
      const content = run.integration && commit ? (await treeFile(this.integrations.repo(run.projectId),commit,path))?.bytes : await bytes(sourceRoot, path);
      if ((content ? digest(content) : null) !== hash) throw new Error("MILESTONE_TRANSFER_CHANGED");
    }
    return [...latest].map(([path, hash]) => ({ path, hash }));
  }
  async guard(id: string, bound: Binding) {
    const run = await this.get(id, bound.runId);
    if (run.scope.acceptance && !await this.integrations.get(id,run.runId)) throw Error("PHASE_LOCAL_EVIDENCE_REQUIRED");
    if (run.state !== "active" || run.scopeHash !== bound.scopeHash) throw new Error("MILESTONE_PAUSED_OR_STALE");
    await this.checkScope(run); await this.checkFiles(run);
    if (bound.generation) {
      const node = run.nodes.find(n=>n.id===bound.item);
      if (!node || !holdsClaim(node) || node.lease?.generation!==bound.generation || node.lease.base!==bound.integrationBase) throw new Error("MILESTONE_STALE_WORKER");
      if (node.parked) {
        if (run.nodes.filter(computing).length>=2) throw new Error("GLOBAL_EXECUTION_BUSY");
        delete node.parked;
        await this.put(run,"복구 슬롯 예약 "+node.id);
      }
      return;
    }
    if(run.integration && await ref(this.integrations.repo(id),run.integration.target)!==bound.integrationBase)throw new Error("INTEGRATION_BASE_MOVED");
  }
  private prepare(run: Run, id: string, milestone: string, coordinator: boolean, inputs: Binding["inputs"]): Effect {
    const features = run.scope.nodes.filter(f => f.milestone === milestone && (coordinator || f.id === id)), f = features[0];
    const references=new Set(features.flatMap(node=>node.context));
    const sections=run.scope.excerpts?.filter(s=>references.has(s.reference)) ?? [];
    const context = run.scope.files.filter(file => references.has(file.path) || sections.some(s=>s.path===file.path)).map(({ path, hash }) => ({ path, hash }));
    const lease = !coordinator && run.nodes.find(n => n.id===id)?.lease;
    const bound: Binding = {
      ...(run.unityProfile?{unityProfile:run.unityProfile}:{}),runId: run.runId, milestone, item: id, scopeHash: run.scopeHash, coordinator, inputs: [...context, ...(lease ? lease.inputs : inputs)],
      checks: coordinator ? [] : context.filter(c => f.checks.includes(c.path)), outputs: coordinator ? [] : f.outputs
    };
    const accepted = run.nodes.filter(n => n.status === "accepted");
    const predecessors = lease ? accepted.slice(0,accepted.findIndex(n=>n.integrationSha===lease.base)+1) : accepted;
    const handoff = predecessors.map(n => ({ id: n.id, result: n.resultId, fingerprint:n.fingerprint, files: n.files.map(file=>({...file,format:file.path.split('.').at(-1)})), ...(n.integrationSha?{integrationSha:n.integrationSha}:{}) }));
    if(run.integration) bound.integrationBase=run.nodes.filter(n=>n.integrationSha).at(-1)?.integrationSha??run.integrationInitial??run.scope.baseCommit;
    if (run.workers===2 && coordinator) bound.readPaths=[...new Set(features.flatMap(n=>n.outputs))];
    if (lease) { bound.integrationBase=lease.base; bound.generation=lease.generation; }
    if (sections.length) bound.sectionOnly=[...new Set(sections.map(s=>s.path).filter(path=>!references.has(path)))];
    bound.brief = JSON.stringify({
      ...(sections.length ? {sections} : {}),
      items: features.map(n => ({ id: n.id, goal: n.goal, role: n.role, dependsOn: n.dependsOn, outputs: n.outputs })),
      handoff, ...(run.scope.external.length?{externalHandoff:run.scope.external}:{}), reports: run.advisors.filter(a => a.handoff?.verdict === "accepted").slice(-1).map(a => a.handoff!.report)
    });
    const goal = coordinator ? "읽기 전용 Milestone 조율. 아래 Feature들의 의존 순서, 역할, 정책 충돌·영향·대안과 인계 근거를 분석한다. 해결이 필요한 충돌이면 BLOCKED, 그 외 READY. 검토 절 마지막에 정확히 다음 형식 한 줄을 작성한다. MA_VERDICT " + run.scopeHash + " READY 또는 MA_VERDICT " + run.scopeHash + " BLOCKED." : f.goal;
    const proposal = run.advisors.find(a => a.milestone === milestone);
    const input: ProductionInput = {
      title: (coordinator ? "Milestone 조율 " + milestone : f.title), goal, scope: coordinator ? "읽기 전용 분석" : JSON.stringify(f.outputs),
      constraints: ("허용된 산출물만 변경한다. 필수 검사와 지침을 보존한다. 적용 지침 " + JSON.stringify(context.map(x => x.path)) + "\n선행 인계 " + JSON.stringify(handoff) + (coordinator ? "" : "\n조율 근거 " + (proposal?.report ?? ""))).slice(0, 12000),
      discipline: coordinator ? "planning" : f.discipline, mode: "new", parentToken: null, parentResultId: null, provider: run.provider, thinkingOptionId: run.thinkingOptionId, outputPath: "", validationProfile: bound.checks.length ? "node-test" : "files"
    };
    if(run.workers===2 && coordinator) input.constraints+="\n서비스 배정 정책: 출력 경로·Scene·Editor 자원을 선점하고 충돌을 직렬화한다. 승인된 결과는 범위의 위상 순서로 통합한다. 기존 출력 파일은 읽기 전용 입력으로 제공되며, 새 파일은 PLAN에서 생성할 수 있다. 이 프로젝트의 등록된 지침과 고정 검사에 따라 판단한다.";
    if (lease) input.constraints = "서비스가 이 작업에 자원을 이미 예약했다. 별도의 잠금 파일을 만들거나 Editor를 실행할 필요가 없다. "
      + JSON.stringify({ generation:lease.generation, base:lease.base, resources:lease.resources }) + "\n" + input.constraints;
    input.constraints=input.constraints.slice(0,12000);
    return { projectId: run.projectId, token: token(run.runId, coordinator ? "advisor" : "feature", id), input, bound };
  }
  async view(id:string,rid:string) {
    const run=await this.get(id,rid);
    await this.projects.exclusive(()=>this.unity.recover(run));
    const rows=await this.unity.list(run);
    return runView.parse({...run,unityEvidence:rows.length?rows:undefined});
  }
  async validateUnity(i:z.infer<typeof requestUnity>) {
    return this.projects.exclusive(async()=>{
      const run=await this.get(i.projectId,i.runId);
      const node=run.nodes.find(n=>n.id===i.feature);
      if(!node || node.status!=="accepted" || node.integrationSha!==i.expectedSha)throw Error("INTEGRATION_PREDECESSOR_REQUIRED");
      const entry=(await this.integrations.outputs(run)).find(e=>e.feature===node.id);
      if(entry?.integrated!==i.expectedSha || entry.result!==node.resultId)throw Error("INTEGRATION_IDENTITY_INVALID");
      if(!(await this.unity.list(run)).some(r=>r.key===i.commandKey))await this.production.assertSlot();
      return this.unity.schedule(run,this.integrations.repo(run.projectId),node,i.kind,i.commandKey);
    });
  }
  private pendingUnity(run:Run,milestone:string,rows:UnityEvidence[]) {
    if(!run.unityProfile)return;
    const nodes=run.nodes.filter(n=>n.milestone===milestone);
    if(!nodes.every(n=>n.status==="accepted"))return;
    const required=nodes.filter(n=>run.scope.nodes.find(f=>f.id===n.id)?.unityTests?.length)
      .map(node=>({node,kind:"plan" as "plan"|"integration"}));
    required.push({node:nodes[nodes.length-1],kind:"integration"});
    for(const spec of required){
      const row=rows.filter(r=>r.feature===spec.node.id && r.kind===spec.kind && r.sha===spec.node.integrationSha).at(-1);
      if(row?.status!=="passed")return {...spec,row};
    }
  }
  private async reconcile(run: Run): Promise<Effect | undefined> {
    if(run.scope.acceptance && !await this.integrations.get(run.projectId,run.runId))throw Error("PHASE_LOCAL_EVIDENCE_REQUIRED");
    await this.checkScope(run);
    const inputs = await this.checkFiles(run);
    if(run.unityProfile)await this.unity.recover(run);
    const rows=run.unityProfile?await this.unity.list(run):[];
    const milestone = run.scope.milestones.find(m => this.pendingUnity(run,m,rows) || run.nodes.some(n => n.milestone === m && n.status !== "accepted") ||
      run.advisors.some(a => a.milestone === m && a.status === "accepted" && a.handoff?.verdict !== "accepted"));
    if (!milestone) { run.state = "completed"; run.reason = "선택 구간 인계 완료"; await this.put(run, "completed"); return; }
    const advisor = run.advisors.find(a => a.milestone === milestone)!;
    const store = await this.production.store(run.projectId);
    if (advisor.status === "blocked") throw new Error("MILESTONE_ADVISOR_BLOCKED");
    if (advisor.status === "pending") {
      const doc = await store.envelope(advisor.token);
      if (!doc || (doc.engine.status === "draft" && !doc.planning)) return this.prepare(run, milestone, milestone, true, inputs);
      const plan = doc.planVersions.at(-1);
      if (!plan) { if (doc.planning?.error) throw new Error(doc.planning.error); return; }
      if (!doc.milestone?.coordinator || doc.milestone.scopeHash !== run.scopeHash || plan.origin !== "ai") throw new Error("MILESTONE_RUN_INVALID");
      advisor.status = this.verdict(plan.content, run.scopeHash);
      advisor.report = plan.content; advisor.planHash = plan.hash; await this.put(run, "조율 " + advisor.status); return;
    }
    if (run.nodes.filter(n => n.milestone === milestone).every(n => n.status === "accepted")) {
      const gate=this.pendingUnity(run,milestone,rows);
      if(gate){
        if(!gate.row){
          await this.production.assertSlot();
          await this.unity.schedule(run,this.integrations.repo(run.projectId),gate.node,gate.kind,key("unity",gate.kind,gate.node.token,gate.node.integrationSha!));
        }
        const reason=gate.row?.reason || "UNITY_GATE_RUNNING";
        if(run.reason!==reason){run.reason=reason;await this.put(run,reason);}
        return;
      }
      return this.handoff(run, milestone, inputs);
    }
    if (run.workers === 2) return this.parallel(run,milestone,inputs);
    const node = run.nodes.find(n => n.milestone === milestone && n.status !== "accepted" && run.scope.nodes.find(f => f.id === n.id)!.dependsOn.every(d => !run.nodes.some(p => p.id === d && p.status !== "accepted")));
    if (!node) throw new Error("MILESTONE_DEPENDENCY_BLOCKED");
    return this.reconcileNode(run,node,inputs);
  }
  private async parallel(run:Run,milestone:string,inputs:Binding["inputs"]):Promise<Effect|undefined> {
    const pending=run.nodes.filter(n=>n.milestone===milestone && n.status!=="accepted");
    for (const node of pending.filter(n=>n.lease)) {
      const revision=run.revision;
      const effect=await this.reconcileNode(run,node,inputs);
      if (effect || run.revision!==revision) return effect;
    }
    const waiting=pending.filter(n=>!n.lease);
    if (!waiting.length) return;
    const occupied=pending.filter(computing);
    if (!occupied.length) {
      const claim=pending.find(holdsClaim);
      await this.production.assertSlot(claim ? {projectId:run.projectId,token:claim.token} : undefined);
    }
    const base=run.nodes.filter(n=>n.integrationSha).at(-1)?.integrationSha ?? run.integrationInitial!;
    const {sourceRoot}=await this.projects.project(run.projectId);
    const prior=pending.filter(n=>n.lease).map(n=>({id:n.id,keys:n.lease!.resources}));
    const changes:string[]=[];
    for (const node of waiting) {
      const spec=run.scope.nodes.find(f=>f.id===node.id)!;
      const keys=await featureResources(sourceRoot,this.integrations.repo(run.projectId),base,spec);
      const dep=spec.dependsOn.find(id=>run.nodes.some(n=>n.id===id && n.status!=="accepted"));
      const conflict=prior.find(p=>resourceConflict(p.keys,keys));
      const failed=run.failurePolicy!=="continue-independent" && pending.find(n=>n.status==="failed" || n.status==="plan-failed");
      const reason=dep ? "선행 통합 대기 "+dep : failed ? "실패 복구 대기 "+failed.id :
        conflict ? "자원 대기 "+conflict.id+" · "+resourceConflict(conflict.keys,keys) : occupied.length>=2 ? "worker 슬롯 대기" : "";
      if (!reason) {
        node.lease={generation:run.revision+1,base,resources:keys,inputs,at:new Date().toISOString()};
        node.status="reserved"; occupied.push(node); changes.push("reserved "+node.id);
      }
      if (node.waitReason!==reason) { node.waitReason=reason; changes.push(node.id+" "+reason); }
      prior.push({id:node.id,keys});
    }
    if (changes.length) { run.reason=""; await this.put(run,changes.join(" / ")); }
  }
  private async reconcileNode(run:Run,node:WorkerNode,inputs:Binding["inputs"]):Promise<Effect|undefined> {
    const store=await this.production.store(run.projectId), milestone=node.milestone;
    const doc = await store.envelope(node.token);
    if (!doc) return this.prepare(run,node.id,milestone,false,inputs);
    if (doc.engine.status === "draft" && !doc.planning && doc.milestone)
      return {...this.prepare(run,node.id,milestone,false,inputs),input:doc.input,bound:doc.milestone};
    if (!doc.milestone || doc.milestone.runId !== run.runId) throw new Error("MILESTONE_RUN_INVALID");
    const result = doc.engine.result;
    const worker=node.lease ? {workspace:doc.engine.workspaceId,session:doc.engine.agentId,
      started:doc.engine.commands.find(c=>c.kind==="start")?.resolvedAt ?? null,ended:result?.collectedAt ?? null} : undefined;
    const workerChanged=worker && JSON.stringify(worker)!==JSON.stringify(node.worker);
    if (worker) node.worker=worker;
    if (result && doc.engine.status === "completed" && doc.reviews.at(-1)?.approved && doc.exports.some(e => e.resultId === result.id)) {
      if(run.integration) {
        if (run.workers===2 && run.nodes.find(n=>n.status!=="accepted")?.id!==node.id) {
          if (node.status!=="awaiting-integration") { node.status="awaiting-integration"; await this.put(run,node.id+" awaiting-integration"); }
          return;
        }
        const state=await this.integrations.get(run.projectId,run.runId);
        if(!state)throw new Error("INTEGRATION_REQUIRED");
        const updated=await this.integrations.advance(run,state,node.id);
        const entry=updated.entries.find(e=>e.feature===node.id)!;
        if(!entry.integrated){
          if(node.status!=="awaiting-github"){node.status="awaiting-github";await this.put(run,node.id+" awaiting-github");}
          return;
        }
        const files=[];
        for(const path of doc.milestone.outputs){
          const file=await treeFile(this.integrations.repo(run.projectId),entry.integrated,path);
          files.push({path,hash:file?digest(file.bytes):null});
        }
        Object.assign(node,{status:"accepted",resultId:result.id,fingerprint:result.fingerprint,files,integrationSha:entry.integrated});
        run.reason="";await this.put(run,"accepted "+node.id);return;
      }
      const transfers = (await this.artifacts.transfers(run.projectId, node.token, result.id)).filter(t => t.state === "applied");
      const files = transfers.flatMap(t => t.files.map(f => ({ path: f.path, hash: f.after })));
      const manifest = await this.artifacts.manifest(run.projectId, node.token, result.id);
      if (manifest.files.every(change => files.some(f => f.path === change.path && f.hash === change.after))) {
        const plan = doc.planVersions.find(p => p.revision === doc.engine.confirmedPlanRevision)!;
        const unchanged = doc.milestone.outputs.filter(path => !manifest.files.some(f => f.path === path));
        if (unchanged.length) {
          const snapshot = await loadSnapshot(store.root, plan.snapshotId);
          for (const path of unchanged) files.push({ path, hash: snapshot.files.find(f => f.path === path)?.hash ?? null });
        }
        const { sourceRoot } = await this.projects.project(run.projectId);
        for (const f of files) { const raw = await bytes(sourceRoot, f.path); if ((raw ? digest(raw) : null) !== f.hash) throw new Error("MILESTONE_TRANSFER_CHANGED"); }
        Object.assign(node, { status: "accepted", files, transfers: transfers.map(t => t.key), resultId: result.id, fingerprint: result.fingerprint });
        run.reason = ""; await this.put(run, "accepted " + node.id); return;
      }
    }
    const status = doc.planning && doc.planning.state !== "complete" ? "plan-" + doc.planning.state : doc.engine.status === "completed" ? "awaiting-apply" : doc.engine.status;
    const reason = doc.planning?.error ?? result?.failure ?? "";
    // A confirmed terminal failure may yield a computation slot. Keep its resource
    // claim until recovery, and keep uncertain external commands in capacity.
    const park = run.failurePolicy==="continue-independent" && (status==="failed" || status==="plan-failed") && !productionBusy(doc);
    const parkingChanged = !!node.parked!==park;
    if (park) node.parked=true;
    else delete node.parked;
    if (parkingChanged || workerChanged || node.status !== status || node.resultId !== (result?.id ?? null) || (!run.workers && run.reason !== reason)) {
      Object.assign(node, { status, resultId: result?.id ?? null, fingerprint: result?.fingerprint ?? null }); run.reason = reason; await this.put(run, node.id + " " + status);
    }
  }
  private async handoff(run: Run, milestone: string, inputs: Binding["inputs"]): Promise<Effect | undefined> {
    const nodes = run.nodes.filter(n => n.milestone === milestone);
    const proofs=[];
    for (const node of nodes) {
      const doc=await this.production.required(run.projectId,node.token);
      const result=doc.engine.result, review=doc.reviews.at(-1);
      if (!result || result.id!==node.resultId || result.fingerprint!==node.fingerprint ||
          !review?.approved || review.resultId!==result.id || review.fingerprint!==result.fingerprint ||
          result.failure || result.executionFailure || !doc.milestone ||
          doc.milestone.checks.length!==result.checks.length ||
          result.checks.some((check,i)=>!check.passed || check.inputFingerprint!==doc.milestone!.checks[i].hash)) throw new Error("MILESTONE_CHECK_MISSING");
      proofs.push({feature:node.id,resultId:result.id,fingerprint:result.fingerprint,reviewId:review.id,approved:review.approved,
        planHash:doc.planVersions.find(p=>p.revision===doc.engine.confirmedPlanRevision)?.hash,
        checks:result.checks.map(c=>({check:c.label,status:c.status,exitCode:c.exitCode,inputHash:c.inputFingerprint})),
        ...(node.integrationSha ? {integrationSha:node.integrationSha,verifiedCommitFiles:node.files} : {appliedTransfers:node.transfers,verifiedSourceFiles:node.files})});
    }
    const revision = payloadHash({scope:run.scopeHash,proofs});
    const owner = run.advisors.find(a => a.milestone === milestone)!;
    if (owner.handoff?.revision===revision && owner.handoff.verdict==="blocked") throw new Error("MILESTONE_ADVISOR_BLOCKED");
    if (run.reason==="MILESTONE_ADVISOR_BLOCKED") {run.reason="변경된 검증 근거로 인계 재검토";await this.put(run,run.reason);}
    const effect = this.prepare(run, milestone, milestone, true, inputs);
    effect.bound.brief=JSON.stringify({assignment:JSON.parse(effect.bound.brief!),verification:proofs});
    effect.input.constraints="서비스가 고정 검사 원본의 해시와 검사 결과, 독립 검토 승인, 선택 반영 이력, 현재 원본 파일 해시를 대조했다. verification에는 실제 대조를 통과한 결과만 들어 있다. 이 기록을 토대로 인계 판정을 작성한다.";
    effect.token = key(owner.token, "handoff", revision);
    effect.input.title = milestone + " 결과 인계";
    effect.input.goal = "같은 Milestone 조율 담당으로서 검토·반영된 결과와 남은 의존성을 검토하고 인계 요약, 영향과 충돌 근거를 작성한다. 실제 충돌이면 BLOCKED, 통과하면 READY. 독립된 마지막 줄에 MA_VERDICT " + revision + " READY 또는 MA_VERDICT " + revision + " BLOCKED 형식으로 판정한다.";
    if(run.integration) effect.input.constraints="서비스가 고정 검사, 결과 지문과 검토 승인을 대조했다. verification의 integrationSha와 verifiedCommitFiles는 관리 브랜치에서 검증한 커밋과 파일이다. 이 근거로 후속 Milestone 인계를 판정한다.";
    const doc = await (await this.production.store(run.projectId)).envelope(effect.token);
    if (!doc || (doc.engine.status === "draft" && !doc.planning)) return effect;
    const plan = doc.planVersions.at(-1);
    if (!plan) { if (doc.planning?.error) throw new Error(doc.planning.error); return; }
    if (!doc.milestone?.coordinator || doc.milestone.scopeHash !== run.scopeHash || plan.origin !== "ai") throw new Error("MILESTONE_RUN_INVALID");
    const verdict = this.verdict(plan.content, revision);
    if (owner.handoff) { const {report,...prior}=owner.handoff; (owner.priorHandoffs??=[]).push(prior); }
    run.reason=verdict==="accepted"?"":"MILESTONE_ADVISOR_BLOCKED";
    owner.handoff = { token: effect.token, revision, verdict, report: plan.content, planHash: plan.hash };
    await this.put(run, "handoff " + milestone + " " + verdict);
  }
  private verdict(report: string, revision: string) {
    const verdicts = [...report.matchAll(/^MA_VERDICT ([a-f0-9]{64}) (READY|BLOCKED)\s*$/gm)];
    return verdicts.length === 1 && verdicts[0][1] === revision && verdicts[0][2] === "READY" ? "accepted" as const : "blocked" as const;
  }
  private async dispatch(e: Effect) {
    const doc: Production = await this.production.save({ projectId: e.projectId, token: e.token, expectedRevision: 0, commandKey: key(e.token, "draft"), input: e.input }, e.bound);
    if (!doc.planning && doc.engine.status === "draft") await this.production.plan({ projectId: e.projectId, token: e.token, expectedRevision: doc.revision, commandKey: key(e.token, "plan") });
  }
  wake() {
    if (this.stopped || this.working) return;
    clearTimeout(this.timer);
    this.working = this.cycle().catch(() => undefined).finally(() => { this.working = undefined; if (!this.stopped) { this.timer = setTimeout(() => this.wake(), 2000); this.timer.unref(); } });
  }
  async close() { this.stopped = true; clearTimeout(this.timer); await this.working; await this.unity.close(); }
  async cycle() {
    for (const p of await this.projects.list()) {
      if (!p.available || !p.initialized) continue;
      const records=await this.list(p.projectId).catch(()=>[]);
      if(records.some(r=>r.state==="invalid")) continue;
      for (const {runId:rid} of records.filter(r=>r.state==="active")) {
        try {
          const e = await this.projects.exclusive(async () => { const run = await this.get(p.projectId, rid); if (run.state === "active") return this.reconcile(run); });
          if (e) await this.dispatch(e);
        } catch (error) {
          await this.projects.exclusive(async () => {
            const run = await this.get(p.projectId, rid); const reason = message(error);
            if (run.state === "active" && run.reason !== reason) { run.reason = reason; await this.put(run, reason); }
          });
        }
      }
    }
  }
}
