import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { DraftRequest } from "../application/draft-request";
import { StartFeatureRequest } from "../application/start-feature-request";
import { createRequest } from "../domain/request";
import { prepare, project, commit } from "./helpers/prepared";
import { saveDraftSchema } from "../../shared/contracts/feature-request";

const feature = { title: "M2 plan", goal: "Small feature", scope: "One file", constraints: "Sandbox", validation: "Read file", completionCriteria: "Proof exists" };
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-m2-"));
  const store = new JsonRequestStore(directory); t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const state = { head: commit, project: { ...project }, workspaces: 0, agents: 0, pinned: "" };
  const runtime = { validate: async () => {}, preflight: async () => ({ baseCommit: state.head, projectSnapshot: { ...state.project } }), createWorkspace: async (record: ReturnType<typeof createRequest>) => { state.workspaces++; state.pinned = record.plans.find(x => x.revision === record.confirmedPlanRevision)!.baseCommit!; return { id: "workspace", directory: "worktree" }; }, writePlans: async () => {}, startAgent: async () => { state.agents++; return "agent"; } };
  return { store, directory, state, runtime, drafts: new DraftRequest(store), start: new StartFeatureRequest(store) };
}
test("incomplete drafts survive reload without auto-created criteria, plans, attempts or slot", async t => {
  const f = await fixture(t);
  const payload = { token: "empty-draft-001", commandKey: "empty-save-001", expectedRevision: 0, feature: { title: "Draft", goal: "", scope: "", constraints: "", validation: "", completionCriteria: "" }, criteria: [], checks: [] };
  const saved = await f.drafts.save(payload); assert.equal(saved.status, "draft");
  assert.deepEqual(saved.criteria, []); assert.deepEqual(saved.plans, []); assert.deepEqual(saved.attemptHistory, []);
  assert.deepEqual((await f.store.diagnostics()).activeTokens, []);
  await assert.rejects(f.drafts.prepare({ token: saved.token, commandKey: "empty-plan-001", expectedRevision: saved.revision }, f.runtime), /INVALID_INPUT/);
  assert.equal((await f.store.get(saved.token))!.revision, saved.revision);
  await f.store.close(); const reopened = new JsonRequestStore(f.directory); try { assert.deepEqual((await reopened.get(saved.token))!.feature, payload.feature); } finally { await reopened.close(); }
});
test("draft commands replay before revision checks and reject changed input", async t => {
  const f = await fixture(t), payload = { token: "draft-replay-001", commandKey: "draft-save-001", expectedRevision: 0, feature, criteria: [], checks: [] };
  const first = await f.drafts.save(payload); assert.equal((await f.drafts.save(payload)).revision, first.revision);
  await assert.rejects(f.drafts.save({ ...payload, feature: { ...feature, title: "Changed" } }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.drafts.save({ ...payload, commandKey: "new-save-001" }), /REVISION_CONFLICT/);
});
test("editing invalidates ready, preserves the old plan and requires a new plan revision", async t => {
  const f = await fixture(t), first = await prepare(f.store, f.runtime, "plan-edit-001", feature), ready = (await f.store.get(first.token))!;
  const edited = await f.drafts.save({ token: first.token, commandKey: "plan-edit-save-002", expectedRevision: ready.revision, feature: { ...ready.feature, scope: "Different file" }, criteria: ready.criteria, checks: ready.checks });
  assert.equal(edited.status, "draft"); assert.deepEqual(edited.plans, ready.plans);
  await assert.rejects(f.start.start(first, f.runtime), /REVISION_CONFLICT/);
  await assert.rejects(f.start.start({ ...first, expectedRevision: edited.revision }, f.runtime), /PLAN_STALE/);
  const next = await f.drafts.prepare({ token: first.token, commandKey: "plan-edit-prepare-002", expectedRevision: edited.revision }, f.runtime);
  assert.equal(next.plans.length, 2); assert.equal(next.plans[1].revision, 2); assert.notEqual(next.plans[1].inputHash, next.plans[0].inputHash);
  assert.match(next.taskPlan.content, /Different file/); assert.match(next.requestPlan.content, /criterion-1/); assert.equal(f.state.workspaces, 0);
});
test("plan rejects missing links, duplicate identities and unsafe check paths while keeping draft", async t => {
  const f = await fixture(t);
  const invalid = [
    { criteria: [{ id: "c", text: "Done", checkIds: [], manualMethod: "" }], checks: [] },
    { criteria: [{ id: "c", text: "Done", checkIds: ["missing"], manualMethod: "Read" }], checks: [] },
    { criteria: [{ id: "c", text: "Done", checkIds: ["check"], manualMethod: "" }], checks: [{ id: "check", kind: "node-test", path: "../outside", label: "Test" }] },
    { criteria: [{ id: "c", text: "Done", checkIds: [], manualMethod: "Read" }, { id: "c", text: "Other", checkIds: [], manualMethod: "Read" }], checks: [] },
    { criteria: [{ id: "c", text: "Done", checkIds: ["x"], manualMethod: "" }], checks: [{ id: "x", kind: "node-test", path: "test.mjs", label: "Test" }, { id: "x", kind: "node-test", path: "two.mjs", label: "Test" }] },
  ];
  for (const [i, value] of invalid.entries()) {
    const token = `invalid-draft-00${i}`, draft = await f.drafts.save({ token, commandKey: `${token}-save`, expectedRevision: 0, feature, ...value });
    await assert.rejects(f.drafts.prepare({ token, commandKey: `${token}-plan`, expectedRevision: draft.revision }, f.runtime), /INVALID_INPUT/);
    assert.equal((await f.store.get(token))!.status, "draft");
  }
  assert.equal(saveDraftSchema.safeParse({ token: "too-many-001", commandKey: "too-many-save", expectedRevision: 0, feature, criteria: Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, text: "x", checkIds: [], manualMethod: "read" })), checks: [] }).success, false);
});
for (const change of ["commit", "provider"] as const) test(`changing ${change} after preview rejects start without effects`, async t => {
  const f = await fixture(t), input = await prepare(f.store, f.runtime, `stale-${change}-001`, feature);
  if (change === "commit") f.state.head = "b".repeat(40); else f.state.project.provider = "codex/different";
  await assert.rejects(f.start.start(input, f.runtime), /PLAN_STALE/); assert.equal(f.state.workspaces, 0); assert.equal(f.state.agents, 0);
  assert.equal((await f.store.get(input.token))!.status, "ready");
});
test("a ref moving after confirmation cannot replace the persisted base SHA", async t => {
  const f = await fixture(t), input = await prepare(f.store, f.runtime, "pinned-start-001", feature);
  const create = f.runtime.createWorkspace; f.runtime.createWorkspace = async record => { f.state.head = "b".repeat(40); return create(record); };
  const started = await f.start.start(input, f.runtime); assert.equal(started.status, "started"); assert.equal(f.state.pinned, commit);
  const modified = structuredClone(started); modified.feature.goal = "Bypass confirmation";
  await assert.rejects(f.store.save(modified), /IMMUTABLE_EXECUTION_INPUT/);
  await assert.rejects(f.drafts.save({ token: input.token, commandKey: "after-start-save", expectedRevision: started.revision, feature, criteria: started.criteria, checks: [] }), /INVALID_STATE/);
  await f.start.start(input, f.runtime); assert.equal(f.state.workspaces, 1);
  const otherDraft = await f.drafts.save({ token: "during-execution-draft", commandKey: "during-execution-save", expectedRevision: 0, feature, criteria: [], checks: [] }); assert.equal(otherDraft.status, "draft");
});
test("legacy start cannot bypass confirmation but existing execution remains replayable", async t => {
  const f = await fixture(t);
  await assert.rejects(f.start.start({ token: "bypass-start-001", feature }, f.runtime), /PLAN_REQUIRED/);
  assert.equal(await f.store.get("bypass-start-001"), null);
  const legacy = createRequest("legacy-start-001", feature); legacy.agentId = "old-agent"; legacy.status = "completed"; legacy.confirmationSource = "poc-direct"; await f.store.save(legacy);
  assert.equal((await f.start.start({ token: legacy.token, feature }, f.runtime)).agentId, "old-agent"); assert.equal(f.state.workspaces, 0);
});
