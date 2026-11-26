import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink, readdir } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import { Projects } from "../application/desktop/projects";
import { ProductionService } from "../application/desktop/production";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { productionInput } from "../../shared/contracts/desktop-production";
import { planSections } from "../adapters/paseo/plan-generator";
import { captureInput } from "../application/desktop/snapshots";
import { applyTransfer, undoTransfer } from "../application/desktop/transfers";
import { digest } from "../adapters/storage/project-files";
import { StartFeatureRequest } from "../application/start-feature-request";
import { createRequest } from "../domain/request";
import type { Runtime } from "../application/ports";
import type { DesktopRuntime } from "../adapters/paseo/desktop-runtime";
import { ProductionArtifacts } from "../application/desktop/artifacts";
import { Roadmaps } from "../application/desktop/roadmap";
import { MilestoneRuns } from "../application/desktop/milestone-run";
import { roadmapSchema } from "../../shared/contracts/milestone-roadmap";
import { featureResources, resourceConflict } from "../application/desktop/parallel-resources";
const run = promisify(execFile);
const input = productionInput.parse({ title: "작은 변경", goal: "정확한 결과를 만든다", scope: "작은 범위", constraints: "지침 준수", discipline: "coding", mode: "new", parentToken: null, parentResultId: null, provider: "codex/test", thinkingOptionId: "low", outputPath: "" });
const content = "# 계획\n" + planSections.map(s => `\n## ${s}\n요청을 분석한 구체적인 ${s} 내용을 기록합니다.\n`).join("");
async function fixture(answer: (goal:string)=>string|Promise<string> = () => content) {
  const root = await mkdtemp(join(tmpdir(), "orchiva-d3-")), source = join(root, "소스"), output = join(root, "출력"); await mkdir(source); await mkdir(output);
  await run("git", ["-C", source, "init", "-b", "main"]); await writeFile(join(source, "value.txt"), "before"); await run("git", ["-C", source, "add", "value.txt"]);
  await run("git", ["-C", source, "-c", "user.name=Orchiva Test", "-c", "user.email=orchiva@test.invalid", "commit", "-m", "fixture"]);
  const projects = new Projects(join(root, "registry")), legacy = new JsonRequestStore(join(root, "legacy")); await legacy.open();
  const p = await projects.register(source, "시험"); const init = await projects.preview(p.projectId); await projects.initialize(p.projectId, init.fingerprint, "initialize-test"); await projects.configure(p.projectId, 1, { name: "시험", baseRef: "main", outputRoot: output });
  let calls = 0;
  const api = { providers: { listModels: async () => ({ models: [{ id: "test", label: "Test", thinkingOptions: [{ id: "low", label: "Low" }] }] }) } } as unknown as PaseoApi;
  const service = new ProductionService(projects, legacy, async () => api, { generate: async (_directory,input) => { calls++; return answer(input.goal); } });
  return { root, source, output, projects, legacy, service, api, id: p.projectId, calls: () => calls,
    async close() { await service.close(); await projects.close(); await legacy.close(); const rel = relative(tmpdir(), root); assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel)); await rm(root, { recursive: true, force: true }); } };
}
test("project acceptance pins role paths and checks, blocks unsupported tools and protects the next phase",async()=>{
  const f=await fixture(), maps=new Roadmaps(f.projects,f.service), runs=new MilestoneRuns(maps,new ProductionArtifacts(f.service));
  try{
    const feature=(id:string)=>({id,title:id,goal:"make a level",role:"level",outputs:["Assets/world.json"]});
    const map=roadmapSchema.parse({version:1,acceptance:{pipeline:"unity-level-v1",version:1,roles:[
      {role:"level",tool:"level",outputs:["Assets/world.json"],checks:["world.test.cjs"]}]},
      phases:[{id:"Play",milestones:[{id:"M",features:[feature("A")]}]},{id:"Polish",milestones:[{id:"N",features:[feature("B")]}]}]});
    const write=async()=>maps.save(f.id,(await maps.read(f.id)).revision,map);
    await write();
    const first={phase:"Play",first:"M",last:"M"}, second={phase:"Polish",first:"N",last:"N"};
    assert.ok((await maps.preview(f.id,first)).issues.some(i=>i.includes("world.test.cjs")));
    await writeFile(join(f.source,"world.test.cjs"),"require('node:assert/strict').ok(true);");
    const ready=await maps.preview(f.id,second);
    assert.deepEqual(ready.issues,[]);assert.deepEqual(ready.nodes[0].checks,["world.test.cjs"]);
    const input={projectId:f.id,runId:"phase-gate-negative",selection:second,scopeHash:ready.hash,provider:"codex/test",thinkingOptionId:null,parent:null};
    await assert.rejects(runs.create(input),/PHASE_INTEGRATION_REQUIRED/);
    await assert.rejects(runs.create({...input,integration:{mode:"local",target:"integrated",headPrefix:"feature"}}),/PHASE_APPROVAL_REQUIRED/);
    await assert.rejects(maps.save(f.id,ready.revision,{...map,acceptance:undefined}),/PHASE_PROFILE_REQUIRED/);
    map.acceptance!.roles[0].tool="sound";await write();
    assert.ok((await maps.preview(f.id,first)).issues.some(i=>i.includes("PHASE_TOOL_UNAVAILABLE")));
    map.acceptance!.roles[0].tool="level";map.phases[0].milestones[0].features[0].outputs=["world.test.cjs"];await write();
    assert.ok((await maps.preview(f.id,first)).issues.some(i=>i.includes("PHASE_OUTPUT_POLICY")));
    await writeFile(join(f.source,"docs/roadmap/roadmap.json"),JSON.stringify({...map,acceptance:undefined}));
    assert.ok((await maps.preview(f.id,first)).issues.includes("PHASE_PROFILE_CHANGED"));
    assert.deepEqual(await runs.list(f.id),[]);
  }finally{await runs.close();await f.close();}
});
test("Unity-bound feature snapshots pin untouched large content to Git and preserve legacy snapshot limits",async()=>{
  const f=await fixture();
  try{
    await writeFile(join(f.source,"large.bytes"),Buffer.alloc(17*1024*1024));
    await run("git",["-C",f.source,"add","large.bytes"]);
    await run("git",["-C",f.source,"-c","user.name=Fixture","-c","user.email=f@localhost","commit","-m","large input"]);
    const sha=(await run("git",["-C",f.source,"rev-parse","HEAD"])).stdout.trim();
    const snap=await captureInput(f.projects,f.id,input,{runId:"unity-fixture",milestone:"M",item:"A",scopeHash:"0".repeat(64),
      coordinator:false,unityProfile:"hud-win64-v1",integrationBase:sha,inputs:[],checks:[],outputs:["value.txt"]});
    assert.equal(snap.baseCommit,sha);assert.ok(snap.files.some(f=>f.path==="value.txt"));assert.ok(!snap.files.some(f=>f.path==="large.bytes"));
    await assert.rejects(captureInput(f.projects,f.id,input),/FILE_LIMIT|INPUT_SIZE_LIMIT/);
  }finally{await f.close();}
});
test("v3 drafts, AI PLAN, replay and external edits preserve authoritative source history", async () => {
  const f = await fixture();
  try {
    const draft = await f.service.save({ projectId: f.id, token: "request-test-01", commandKey: "save-test-0001", expectedRevision: 0, input });
    assert.equal(draft.engine.status, "draft"); assert.equal(draft.engine.plans.length, 0);
    const command = { projectId: f.id, token: draft.token, commandKey: "plan-test-0001", expectedRevision: draft.revision };
    await f.service.plan(command); await f.service.settle();
    const ready = await f.service.required(f.id, draft.token); assert.equal(ready.engine.status, "ready"); assert.equal(ready.planVersions.length, 1); assert.equal(f.calls(), 1); assert.equal(ready.journals.find(x => x.kind === "plan")?.state, "applied");
    assert.equal(await readFile(join(f.source, ready.planVersions[0].path), "utf8"), content);
    await f.service.plan(command); await f.service.settle(); assert.equal(f.calls(), 1);
    await writeFile(join(f.source, ready.planVersions[0].path), content + "\n외부에서 보완한 계획\n");
    await assert.rejects(f.service.start({ ...command, commandKey: "start-test-001", expectedRevision: ready.revision, planHash: ready.planVersions[0].hash }), /EXTERNAL_CHANGE/);
    const updated = await f.service.syncPlan({ ...command, commandKey: "sync-test-0001", expectedRevision: ready.revision });
    assert.equal(updated.planVersions.length, 2); assert.equal(updated.planVersions[0].content, content);
    const snapshot = await captureInput(f.projects, f.id, input); assert.ok(snapshot.files.some(x => x.path === "docs/evidence/evidence.md"));
    await writeFile(join(f.source, "value.txt"), "external");
    await assert.rejects(f.service.start({ ...command, commandKey: "start-test-002", expectedRevision: updated.revision, planHash: updated.planVersions[1].hash }), /INPUT_CHANGED/);
    const store = await f.service.store(f.id), corrupt = structuredClone(updated); corrupt.planVersions[0].content = "changed"; await assert.rejects(store.put(corrupt), /IMMUTABLE_HISTORY/);
    await writeFile(join(f.source, "docs/.orchiva/requests/future-record.json"), '{"schemaVersion":99}'); await assert.rejects(f.service.assertSlot(), /RECORD_INVALID/);
  } finally { await f.close(); }
});
test("selected source apply survives interruption, refuses external conflicts and restores original bytes", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, "delete.txt"), "delete me");
    const manifest = { version: 1 as const, projectId: f.id, token: "transfer-test", resultId: "result-test", fingerprint: "fingerprint", files: [
      { path: "value.txt", before: digest("before"), after: digest("after"), content: Buffer.from("after").toString("base64") },
      { path: "delete.txt", before: digest("delete me"), after: null, content: null },
      { path: "new.txt", before: null, after: digest("new"), content: Buffer.from("new").toString("base64") } ] };
    const paths = manifest.files.map(x => x.path); let injected = false;
    await assert.rejects(applyTransfer(f.source, manifest, "apply-test-001", paths, () => { if (!injected) { injected = true; throw new Error("INTERRUPTED"); } }), /INTERRUPTED/);
    const done = await applyTransfer(f.source, manifest, "apply-test-001", paths); assert.equal(done.state, "applied"); assert.equal(done.completed.length, 3);
    await applyTransfer(f.source, manifest, "apply-test-001", paths);
    await writeFile(join(f.source, "new.txt"), "user edit"); await assert.rejects(undoTransfer(f.source, "apply-test-001"), /CONFLICT/);
    assert.equal(await readFile(join(f.source, "value.txt"), "utf8"), "after");
    await writeFile(join(f.source, "new.txt"), "new"); assert.equal((await undoTransfer(f.source, "apply-test-001")).state, "undone");
    assert.equal(await readFile(join(f.source, "value.txt"), "utf8"), "before"); assert.equal(await readFile(join(f.source, "delete.txt"), "utf8"), "delete me"); await assert.rejects(readFile(join(f.source, "new.txt")), { code: "ENOENT" });
    await assert.rejects(applyTransfer(f.source, manifest, "apply-test-001", ["value.txt"]), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(applyTransfer(f.source, manifest, "apply-partial-02", paths, () => { throw new Error("partial failure"); }), /partial failure/);
    assert.equal((await undoTransfer(f.source, "apply-partial-02")).state, "undone");
    assert.equal(await readFile(join(f.source, "value.txt"), "utf8"), "before");
  } finally { await f.close(); }
});
test("v3 engine saves retain command references; global slot includes other projects and legacy archives preserve bytes", async () => {
  const f = await fixture();
  try {
    const draft = await f.service.save({ projectId: f.id, token: "checkpoint-test", commandKey: "checkpoint-save", expectedRevision: 0, input });
    await f.service.plan({ projectId: f.id, token: draft.token, commandKey: "checkpoint-plan", expectedRevision: draft.revision }); await f.service.settle(); await f.service.close();
    const doc = await f.service.required(f.id, draft.token), plan = doc.engine.plans.at(-1)!, store = await f.service.store(f.id); const calls: string[] = [];
    const runtime: Runtime = { projectSnapshot: plan.projectSnapshot, validate: async () => {}, preflight: async () => ({ baseCommit: plan.baseCommit!, projectSnapshot: plan.projectSnapshot! }), createWorkspace: async () => { calls.push("workspace"); return { id: "workspace-1", directory: "test-only" }; }, writePlans: async () => { calls.push("plan"); }, startAgent: async () => { calls.push("agent"); return "agent-1"; } };
    const request = { token: doc.token, commandKey: "checkpoint-start", expectedRevision: doc.engine.revision, planRevision: plan.revision, inputHash: plan.inputHash };
    const started = await new StartFeatureRequest(store).start(request, runtime); assert.equal(started.commands[0].phase, "done"); assert.equal(started.commands[0].status, "applied");
    await new StartFeatureRequest(store).start(request, runtime); assert.deepEqual(calls, ["workspace", "plan", "agent"]);
    await assert.rejects(f.service.assertSlot({ projectId: "other-project", token: "other-request" }), /GLOBAL_EXECUTION_BUSY/);
    let legacyCalls = 0; await assert.rejects(f.service.legacyCommand("legacy-operation", async () => { legacyCalls++; }), /GLOBAL_EXECUTION_BUSY/); assert.equal(legacyCalls, 0);
    const raw = JSON.stringify({ ...createRequest("legacy-archive-01", { title: "원본", goal: "원본", scope: "원본", constraints: "원본", validation: "원본", completionCriteria: "원본" }), status: "completed" }, null, 3);
    const imported = await f.service.importLegacy(f.id, "legacy-archive-01", "legacy-import-001", raw); assert.equal(imported.legacy?.sourceHash, digest(raw));
    assert.equal(await readFile(join(f.source, `docs/.orchiva/backups/legacy/legacy-archive-01-${digest(raw)}.json`), "utf8"), raw);
    await assert.rejects(f.service.save({ projectId: f.id, token: imported.token, commandKey: "legacy-edit-001", expectedRevision: imported.revision, input }), /ARCHIVE_ONLY/);
  } finally { await f.close(); }
});
test("restored AI completion is reconciled without another model call; unfinished planning blocks a new key", async () => {
  const f = await fixture();
  try {
    f.service.wake = () => {};
    const draft = await f.service.save({ projectId: f.id, token: "restore-plan-test", commandKey: "restore-save-001", expectedRevision: 0, input });
    await f.service.plan({ projectId: f.id, token: draft.token, commandKey: "restore-plan-001", expectedRevision: draft.revision });
    const store = await f.service.store(f.id), pending = await f.service.required(f.id, draft.token);
    await assert.rejects(f.service.plan({ projectId: f.id, token: draft.token, commandKey: "restore-plan-002", expectedRevision: pending.revision }), /PLANNING_IN_PROGRESS/);
    pending.planning!.state = "running"; pending.journals.find(x => x.kind === "plan")!.phase = "model"; await store.put(pending);
    await mkdir(pending.planning!.directory, { recursive: true }); await writeFile(join(pending.planning!.directory, "answer.md"), content); await writeFile(join(pending.planning!.directory, "completion.json"), JSON.stringify({ hash: digest(content), succeeded: true }));
    const restored = new ProductionService(f.projects, f.legacy, async () => { throw new Error("unexpected provider call"); }, { generate: async () => { throw new Error("duplicate model call"); } });
    try { restored.startWorker(); await restored.settle(); const complete = await restored.required(f.id, draft.token); assert.equal(complete.engine.status, "ready"); assert.equal(complete.planVersions.length, 1); assert.equal(complete.planning?.state, "complete"); }
    finally { await restored.close(); }
    assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});
test("lost stop response is never resent, holds the slot and reconciles observed termination with failed evidence", async () => {
  const f = await fixture(); let service: ProductionService | undefined;
  try {
    const draft = await f.service.save({ projectId: f.id, token: "stop-request-01", commandKey: "stop-draft-001", expectedRevision: 0, input });
    await f.service.plan({ projectId: f.id, token: draft.token, commandKey: "stop-plan-0001", expectedRevision: draft.revision }); await f.service.settle(); await f.service.close();
    const store = await f.service.store(f.id), doc = await f.service.required(f.id, draft.token), plan = doc.engine.plans.at(-1)!;
    const runtime = { projectSnapshot: plan.projectSnapshot, validate: async () => {}, preflight: async () => ({ baseCommit: plan.baseCommit!, projectSnapshot: plan.projectSnapshot! }), createWorkspace: async () => ({ id: "ws-stop", directory: "fixture-only" }), writePlans: async () => {}, startAgent: async () => "agent-stop", verifyResources: async () => {}, observe: async () => ({ status: "ended", agentStatus: "idle", sourceKey: "stop-source", finalResponse: "partial result", failure: null, seenRecovery: false }), collect: async (_record: unknown, observation: { failure: string | null }) => ({ id: "stop-result", sourceKey: "stop-source", collectedAt: new Date().toISOString(), agentStatus: "idle", finalResponse: "partial result", changedFiles: [], files: [], checks: [], diffStat: "", fingerprint: "stop-fingerprint", failure: observation.failure, executionFailure: observation.failure }), fingerprint: async () => "stop-fingerprint", resume: async () => {} } as unknown as DesktopRuntime;
    await new StartFeatureRequest(store).start({ token: doc.token, commandKey: "stop-start-001", expectedRevision: doc.engine.revision, planRevision: plan.revision, inputHash: plan.inputHash }, runtime);
    let cancels = 0;
    service = new ProductionService(f.projects, f.legacy, async () => f.api, undefined, async () => { cancels++; throw new Error("lost response"); }); service.runtime = async () => runtime;
    const wake = service.wake.bind(service); service.wake = () => {};
    const latest = await service.required(f.id, draft.token), command = { projectId: f.id, token: draft.token, commandKey: "stop-command-1", expectedRevision: latest.revision };
    assert.equal((await service.stop(command)).journals.at(-1)?.state, "unknown"); await service.stop(command); assert.equal(cancels, 1);
    await assert.rejects(service.assertSlot(), /GLOBAL_EXECUTION_BUSY/);
    wake(); await service.settle(); const stopped = await service.required(f.id, draft.token); assert.equal(stopped.journals.at(-1)?.state, "applied"); assert.equal(stopped.engine.status, "failed"); assert.ok(stopped.engine.result?.executionFailure); assert.equal(cancels, 1);
    await service.assertSlot();
  } finally { await service?.close(); await f.close(); }
});
test("permission replies bind the displayed request and never resend an uncertain response", async () => {
  const f = await fixture(); let service: ProductionService | undefined;
  try {
    const draft = await f.service.save({ projectId: f.id, token: "permission-test", commandKey: "permission-draft", expectedRevision: 0, input });
    await f.service.plan({ projectId: f.id, token: draft.token, commandKey: "permission-plan", expectedRevision: draft.revision }); await f.service.settle(); await f.service.close();
    const store = await f.service.store(f.id), doc = await f.service.required(f.id, draft.token); doc.engine.agentId = "permission-agent"; doc.engine.workspaceId = "permission-workspace"; doc.engine.status = "needs-input"; await store.put(doc);
    let pending = [{ id: "permission-1", name: "Test command", provider: "codex", kind: "tool", input: { command: "fixture only" } }], sends = 0;
    const api = { agents: { ref: () => ({ refresh: async () => ({}), get pendingPermissions() { return pending; }, respondToPermission: async () => { sends++; throw new Error("response lost"); } }) } } as unknown as PaseoApi;
    service = new ProductionService(f.projects, f.legacy, async () => api); service.runtime = async () => ({ verifyResources: async () => {}, observe: async () => ({ status: "running", agentStatus: "running", sourceKey: "", finalResponse: "", failure: null, seenRecovery: false }) }) as unknown as DesktopRuntime;
    const wake = service.wake.bind(service); service.wake = () => {};
    const [request] = await service.attention(f.id, doc.token), command = { projectId: f.id, token: doc.token, commandKey: "permission-reply", expectedRevision: doc.revision, requestId: request.id, requestHash: request.hash, actionId: "deny", behavior: "deny" as const };
    await assert.rejects(service.permission({ ...command, requestHash: digest("changed") }), /PERMISSION_CHANGED/); assert.equal(sends, 0);
    await service.permission(command); await service.permission(command); assert.equal(sends, 1);
    const latest = await service.required(f.id, doc.token); assert.equal(latest.journals.at(-1)?.state, "unknown");
    await assert.rejects(service.permission({ ...command, commandKey: "permission-retry", expectedRevision: latest.revision }), /DELIVERY_UNKNOWN/);
    pending = []; wake(); await service.settle(); const resolved = await service.required(f.id, doc.token); assert.equal(resolved.journals.at(-1)?.state, "applied"); assert.equal(resolved.journals.at(-1)?.outcome, "request-no-longer-pending"); assert.equal(sends, 1);
  } finally { await service?.close(); await f.close(); }
});
test("export resumes its frozen destination after conflict and settings changes; apply/undo preserve command history", async () => {
  const f = await fixture();
  try {
    const draft = await f.service.save({ projectId: f.id, token: "export-request-1", commandKey: "export-draft-01", expectedRevision: 0, input });
    await f.service.plan({ projectId: f.id, token: draft.token, commandKey: "export-plan-001", expectedRevision: draft.revision }); await f.service.settle(); await f.service.close();
    const store = await f.service.store(f.id), doc = await f.service.required(f.id, draft.token), working = join(f.root, "worktree"); await mkdir(working); await writeFile(join(working, "answer.txt"), "42\n");
    doc.engine.worktreePath = working; doc.engine.workspaceId = "export-workspace"; doc.engine.agentId = "export-agent"; doc.engine.confirmationSource = "confirmed-plan"; doc.engine.confirmedPlanRevision = doc.planVersions[0].revision; doc.engine.status = "completed";
    doc.engine.result = { id: "export-result", sourceKey: "export-source", collectedAt: new Date().toISOString(), finalResponse: "42", agentStatus: "idle", changedFiles: ["answer.txt"], files: [], checks: [], diffStat: "", fingerprint: "export-fingerprint", failure: null, executionFailure: null }; await store.save(doc.engine);
    let current = await f.service.required(f.id, doc.token); current.reviews.push({ id: "review-fixture", resultId: "export-result", fingerprint: "export-fingerprint", approved: true, qualityConfirmed: true, checksAcknowledged: true, note: "fixture", at: new Date().toISOString() }); await store.put(current);
    f.service.runtime = async () => ({ fingerprint: async () => "export-fingerprint" }) as unknown as DesktopRuntime;
    const artifacts = new ProductionArtifacts(f.service), output = join(f.output, doc.planName, "export-result"); await mkdir(output, { recursive: true }); await writeFile(join(output, "answer.txt"), "external output");
    const command = { projectId: f.id, token: doc.token, resultId: "export-result", commandKey: "export-command-1", expectedRevision: current.revision };
    await assert.rejects(artifacts.export(command), /IMMUTABLE_CONFLICT/); await assert.rejects(f.service.assertSlot(), /GLOBAL_EXECUTION_BUSY/);
    const alternate = join(f.root, "alternate-output"); await mkdir(alternate); await f.projects.configure(f.id, 2, { name: "시험", baseRef: "main", outputRoot: alternate });
    await unlink(join(output, "answer.txt")); current = await artifacts.export({ ...command, commandKey: "export-command-2", expectedRevision: (await f.service.required(f.id, doc.token)).revision });
    assert.equal(current.exports[0].root, output); assert.deepEqual(await readdir(alternate), []); assert.deepEqual(await readdir(output), ["answer.txt"]); await f.service.assertSlot();
    const apply = { ...command, commandKey: "apply-export-01", expectedRevision: current.revision, paths: ["answer.txt"] }; await artifacts.apply(apply); await artifacts.apply(apply); assert.equal(await readFile(join(f.source, "answer.txt"), "utf8"), "42\n");
    await artifacts.undo(f.id, doc.token, "export-result", apply.commandKey); await assert.rejects(readFile(join(f.source, "answer.txt")), { code: "ENOENT" });
    assert.equal((await artifacts.transfers(f.id, doc.token, "export-result"))[0].state, "undone");
  } finally { await f.close(); }
});

test("managed runs pin the Git base in the v3 PLAN and refuse the source-apply route",async()=>{
  const f=await fixture(),roadmap=new Roadmaps(f.projects,f.service),artifacts=new ProductionArtifacts(f.service);
  const runs=new MilestoneRuns(roadmap,artifacts);await runs.close();
  f.service.milestoneGuard=(id,binding)=>runs.guard(id,binding);
  try {
    const map=roadmapSchema.parse({version:1,phases:[{id:"P",milestones:[{id:"M",features:[{id:"A",title:"HUD",goal:"score",outputs:["score.txt"]}]}]}]});
    const selection={phase:"P",first:"M",last:"M"};await roadmap.save(f.id,null,map);
    const scope=await roadmap.preview(f.id,selection),integration={mode:"local" as const,target:"develop",headPrefix:"feature"};
    await writeFile(join(f.source,"private.txt"),"draft");
    const run=await runs.create({projectId:f.id,runId:"managed-fixture",selection,scopeHash:scope.hash,provider:"codex/test",thinkingOptionId:"low",parent:null,integration});
    await runs.cycle();await f.service.settle();
    const doc=await f.service.required(f.id,run.nodes[0].token);
    assert.equal(doc.engine.status,"ready");assert.equal(doc.milestone?.integrationBase,scope.baseCommit);
    assert.equal(doc.engine.projectSnapshot?.baseRef,scope.baseCommit);
    assert.deepEqual(await runs.integrations.policy(f.id),integration);
    await assert.rejects(artifacts.apply({projectId:f.id,token:doc.token,expectedRevision:doc.revision,commandKey:"wrong-apply-01",resultId:"irrelevant",paths:["score.txt"]}),/MODE_LOCKED/);
    await assert.rejects(runs.integrations.configure(await runs.get(f.id,run.runId),{...integration,target:"another"}),/POLICY_LOCKED/);
    assert.equal(await readFile(join(f.source,"private.txt"),"utf8"),"draft");
  } finally {await f.close();}
});

test("milestone intents survive lost responses, pause and draft replay without a second PLAN or session",async () => {
  const f=await fixture(), roadmap=new Roadmaps(f.projects,f.service);
  const runs=new MilestoneRuns(roadmap,new ProductionArtifacts(f.service));
  await runs.close(); // Drive one durable transition at a time.
  f.service.milestoneGuard=(id,binding)=>runs.guard(id,binding);
  try {
    const map=roadmapSchema.parse({version:1,phases:[{id:"P",milestones:[{id:"M",features:[{id:"A",title:"HUD",goal:"점수 확인",outputs:["score.txt"]}]}]}]});
    const selection={phase:"P",first:"M",last:"M"};
    await roadmap.save(f.id,null,map);
    const scope=await roadmap.preview(f.id,selection), i={projectId:f.id,runId:"milestone-run-single",selection,scopeHash:scope.hash,provider:"codex/test",thinkingOptionId:"low",parent:null};
    const created=await runs.create(i);
    assert.deepEqual((await runs.create(i)).nodes,created.nodes);
    await assert.rejects(runs.create({...i,thinkingOptionId:null}),/IDEMPOTENCY_CONFLICT/);
    const pause={...i,commandKey:"milestone-pause-01",expectedRevision:created.revision,action:"pause" as const};
    await runs.control(pause); await runs.control(pause); await runs.cycle();
    assert.equal((await f.service.list(f.id)).records.length,0);
    await f.service.save({projectId:f.id,token:"manual-001",commandKey:"manual-draft-001",expectedRevision:0,input});
    const paused=await runs.get(f.id,i.runId);
    await runs.control({...pause,action:"resume",commandKey:"milestone-resume-01",expectedRevision:paused.revision});
    const realPlan=f.service.plan.bind(f.service);
    let attempts=0;
    f.service.plan=async command=>{
      if (++attempts===1) throw new Error("SIMULATED_CRASH_AFTER_DRAFT");
      const persisted=await realPlan(command);
      if (attempts===2) throw new Error("SIMULATED_LOST_PLAN_RESPONSE");
      return persisted;
    };
    await runs.cycle();
    const restored=new MilestoneRuns(roadmap,new ProductionArtifacts(f.service));
    await restored.close();
    await restored.cycle(); await f.service.settle(); await restored.cycle();
    const after=await restored.get(f.id,i.runId), node=after.nodes[0], doc=await f.service.required(f.id,node.token);
    assert.equal(after.advisors[0].status,"skipped"); assert.equal(node.status,"ready"); assert.equal(f.calls(),1);
    assert.equal(doc.engine.agentId,null); assert.equal(doc.engine.workspaceId,null);
    await assert.rejects(f.service.save({projectId:f.id,token:node.token,commandKey:"overwrite-bound-01",expectedRevision:doc.revision,input}),/MILESTONE_BOUND_REQUEST/);
    assert.deepEqual(after.nodes.map(n=>n.token),[created.nodes[0].token]); assert.equal((await f.service.list(f.id)).records.length,2);
    await writeFile(join(f.source,"docs/.orchiva/runs/corrupt-test.json"),"{");
    assert.ok((await restored.list(f.id)).some(r=>r.runId==="corrupt-test" && r.state==="invalid"));
    await assert.rejects(restored.create({...i,runId:"other-run-id"}),/MILESTONE_RUN_INVALID/);
  } finally { await f.close(); }
});

test("parallel claims persist atomically, fence old workers, and exclude v2 and manual commands until cancellation", async () => {
  const f=await fixture(goal=>content+"\nMA_VERDICT "+goal.match(/MA_VERDICT ([a-f0-9]{64})/)?.[1]+" READY\n");
  const road=new Roadmaps(f.projects,f.service), runs=new MilestoneRuns(road,new ProductionArtifacts(f.service));
  await runs.close();
  try {
    const selection={phase:"P",first:"M",last:"M"};
    const guid="a".repeat(32);
    for (const file of ["First.unity.meta","Copied.asset.meta"]) await writeFile(join(f.source,file),`guid: ${guid}\n`);
    await run("git",["-C",f.source,"add","--","First.unity.meta","Copied.asset.meta"]);
    await run("git",["-C",f.source,"-c","user.name=Fixture","-c","user.email=f@localhost","commit","-m","Two asset paths with a shared GUID"]);
    const features=[["A","First.unity"],["B","score.txt"],["C","FIRST.unity"]].map(([id,path])=>({id,title:id,goal:id,outputs:[path]}));
    await road.save(f.id,null,roadmapSchema.parse({version:1,phases:[{id:"P",milestones:[{id:"M",features}]}]}));
    const scope=await road.preview(f.id,selection);
    const spec={projectId:f.id,runId:"parallel-claim-run",scopeHash:scope.hash,selection,provider:"codex/test",thinkingOptionId:"low",parent:null,workers:2 as const};
    await assert.rejects(runs.create(spec),/LOCAL_INTEGRATION_REQUIRED/);
    await runs.create({...spec,integration:{mode:"local",target:"integration",headPrefix:"feature"}});
    await runs.cycle();await f.service.settle();await runs.cycle();
    await Promise.all([runs.cycle(),runs.cycle()]);
    let state=await runs.get(f.id,spec.runId);
    assert.deepEqual(state.nodes.filter(n=>n.lease).map(n=>n.id),["A","B"]);
    assert.match(state.nodes[2].waitReason!,/A/);
    await assert.rejects(f.service.legacyCommand("legacy-other",async()=>{}),/GLOBAL_EXECUTION_BUSY/);
    await assert.rejects(f.service.assertSlot({projectId:f.id,token:"manual-token"}),/GLOBAL_EXECUTION_BUSY/);
    await f.service.assertSlot({projectId:f.id,token:state.nodes[0].token});
    await runs.cycle();await f.service.settle();
    const doc=await f.service.required(f.id,state.nodes[0].token);
    await assert.rejects(runs.guard(f.id,{...doc.milestone!,generation:99999}),/STALE_WORKER/);
    await assert.rejects((await f.service.store(f.id)).put({...doc,milestone:{...doc.milestone!,generation:99999}}),/STALE_WORKER/);
    const keys=await featureResources(f.source,runs.integrations.repo(f.id),scope.baseCommit,{...scope.nodes[0],outputs:["Packages/a.json"]});
    assert.ok(resourceConflict(keys,["write:other.txt"]));
    assert.ok(resourceConflict(["write:assets/ui"],["read:assets/ui/hud"]));
    const copy=await featureResources(f.source,runs.integrations.repo(f.id),scope.baseCommit,{...scope.nodes[0],outputs:["Copied.asset"]});
    assert.equal(resourceConflict(state.nodes[0].lease!.resources,copy),"guid:"+guid);
    assert.ok(resourceConflict(["read:guid:"+guid],copy));
    assert.equal(resourceConflict(["read:shared"],["read:shared"]),null);
    state=await runs.get(f.id,spec.runId);
    const cancel={projectId:f.id,runId:spec.runId,commandKey:"cancel-claims",expectedRevision:state.revision,action:"cancel" as const};
    assert.equal((await runs.control(cancel)).state,"cancelled");
    assert.equal((await runs.control(cancel)).state,"cancelled"); await f.service.assertSlot();
  } finally {await f.close();}
});

test("failed workers retain their resources and independent plans follow the selected failure policy", async () => {
  for (const failurePolicy of ["pause","continue-independent"] as const) {
    const f=await fixture(goal=>{
      const revision=goal.match(/MA_VERDICT ([a-f0-9]{64})/)?.[1];
      if (!revision) throw new Error("fixture planner failed");
      return content+"\nMA_VERDICT "+revision+" READY\n";
    });
    const road=new Roadmaps(f.projects,f.service), runs=new MilestoneRuns(road,new ProductionArtifacts(f.service));
    await runs.close();
    try {
      const selection={phase:"P",first:"M",last:"M"};
      const features=["A","B","C","D"].map(id=>({id,title:id,goal:id,outputs:[id+".txt"],dependsOn:id==="D"?["A"]:[]}));
      await road.save(f.id,null,roadmapSchema.parse({version:1,phases:[{id:"P",milestones:[{id:"M",features}]}]}));
      const scope=await road.preview(f.id,selection);
      const runId="parallel-failure";
      await runs.create({projectId:f.id,runId,scopeHash:scope.hash,selection,provider:"codex/test",thinkingOptionId:"low",
        parent:null,workers:2,failurePolicy,integration:{mode:"local",target:"integration",headPrefix:"feature"}});
      for(let pass=0;pass<17;pass++){await runs.cycle();await f.service.settle();}
      const [a,b,c,d]=(await runs.get(f.id,runId)).nodes;
      assert.equal(a.status,"plan-failed");assert.equal(b.status,"plan-failed");
      assert.equal(!!a.parked,failurePolicy==="continue-independent");
      assert.equal(!!c.lease,failurePolicy==="continue-independent");
      assert.equal(d.lease,undefined);assert.match(d.waitReason!,/선행 통합 대기 A/);
      await assert.rejects(f.service.assertSlot(),/GLOBAL_EXECUTION_BUSY/);
    } finally { await f.close(); }
  }
});

test("multi-feature coordination rejects stale and conflicting verdicts before dispatch",async () => {
  for (const verdict of ["stale","BLOCKED","READY"]) {
    const f=await fixture(goal=>content+"\nMA_VERDICT "+(verdict==="stale"?"0".repeat(64):goal.match(/MA_VERDICT ([a-f0-9]{64})/)![1])+" "+(verdict==="BLOCKED"?"BLOCKED":"READY")+"\n");
    const road=new Roadmaps(f.projects,f.service), runs=new MilestoneRuns(road,new ProductionArtifacts(f.service)); await runs.close();
    try {
      const nodes=["A","B"].map(id=>({id,title:id,goal:"점수 "+(id==="A"?10:20),outputs:[id+".txt"]}));
      await road.save(f.id,null,roadmapSchema.parse({version:1,phases:[{id:"P",milestones:[{id:"M",features:nodes}]}]}));
      const selection={phase:"P",first:"M",last:"M"}, scope=await road.preview(f.id,selection);
      const run=await runs.create({projectId:f.id,runId:"milestone-verdict",selection,scopeHash:scope.hash,provider:"codex/test",thinkingOptionId:"low",parent:null});
      await runs.cycle(); await f.service.settle(); await runs.cycle();
      const outcome=await runs.get(f.id,run.runId); assert.equal(outcome.advisors[0].status,verdict==="READY"?"accepted":"blocked");
      const coord=await f.service.required(f.id,outcome.advisors[0].token);
      await assert.rejects(f.service.start({projectId:f.id,token:coord.token,expectedRevision:coord.revision,commandKey:"wrong-start-001",planHash:coord.planVersions[0].hash}),/MILESTONE_BOUND_REQUEST/);
      assert.equal((await f.service.list(f.id)).records.length,1);
    } finally { await f.close(); }
  }
});

test("pause stays responsive while a model owns the slot and manual drafts remain independent",async () => {
  let notifyStart!:()=>void, finish!:(value:string)=>void;
  const began=new Promise<void>(resolve=>{notifyStart=resolve;});
  const answer=new Promise<string>(resolve=>{finish=resolve;});
  const f=await fixture(async()=>{notifyStart();return answer;});
  const road=new Roadmaps(f.projects,f.service), runs=new MilestoneRuns(road,new ProductionArtifacts(f.service));await runs.close();
  try {
    const selection={phase:"P",first:"One",last:"One"};
    await road.save(f.id,null,roadmapSchema.parse({version:1,phases:[{id:"P",milestones:[{id:"One",features:[{id:"A",goal:"HUD",title:"HUD",outputs:["hud.txt"]}]}]}]}));
    const scope=await road.preview(f.id,selection);
    const run=await runs.create({projectId:f.id,runId:"while-planning",selection,scopeHash:scope.hash,provider:"codex/test",thinkingOptionId:"low",parent:null});
    await runs.cycle();await began;
    const paused=await runs.control({projectId:f.id,runId:run.runId,expectedRevision:run.revision,commandKey:"pause-model-01",action:"pause"});
    assert.equal(paused.state,"paused");
    const manual=await f.service.save({projectId:f.id,token:"manual-in-pause",commandKey:"draft-in-pause",expectedRevision:0,input});
    await assert.rejects(f.service.plan({projectId:f.id,token:manual.token,commandKey:"busy-in-pause",expectedRevision:manual.revision}),/GLOBAL_EXECUTION_BUSY/);
    finish(content);await f.service.settle();assert.equal((await f.service.required(f.id,run.nodes[0].token)).engine.status,"ready");
  } finally { finish(content);await f.close(); }
});
