import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { StartFeatureRequest } from "../application/start-feature-request";
import { RecoverRequest } from "../application/recover-request";
import { TrackExecution } from "../application/track-execution";
import { prepare, project, commit } from "./helpers/prepared";
import { failureView } from "../domain/failure";
import { allowedActions } from "../domain/request-view";
import { occupiesSlot } from "../domain/record-v2";
import type { Runtime, LifecycleRuntime, RecoveryRuntime, Observation, Lookup } from "../application/ports";
import type { RequestRecord } from "../../shared/contracts/feature-request";
import { refreshInputSchema } from "../../shared/contracts/feature-request";
const feature = { title: "M5", goal: "Small fix", scope: "Single module", constraints: "Sandbox", validation: "Verify", completionCriteria: "Correct result" };
test("M5 public observation cannot bypass explicit revalidation command identity", () => {
  assert.ok(refreshInputSchema.safeParse({ token: "m5-refresh-test" }).success);
  assert.ok(refreshInputSchema.safeParse({ token: "m5-refresh-test", revalidate: false }).success);
  assert.equal(refreshInputSchema.safeParse({ token: "m5-refresh-test", revalidate: true }).success, false);
});
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "orchiva-m5-")), store = new JsonRequestStore(dir);
  t.after(async () => { await store.close(); const delta = relative(tmpdir(), dir); assert.ok(delta && !delta.startsWith("..") && !isAbsolute(delta)); await rm(dir, { recursive: true, force: true }); });
  const state = { workspaces: 0, agents: 0, sends: 0, collects: 0, lookups: 0, phase: "", resourceError: "", collectionError: false, observation: { status: "ended", agentStatus: "idle", sourceKey: "turn-1", finalResponse: "Done", failure: null, seenRecovery: false } as Observation, lookup: { kind: "unknown", reason: "Uncertain" } as Lookup<{ id: string; directory?: string }> };
  const runtime: Runtime & LifecycleRuntime & RecoveryRuntime = {
    projectSnapshot: project,
    async validate() {}, async preflight() { return { baseCommit: commit, projectSnapshot: project }; },
    async createWorkspace() { state.workspaces++; if (state.phase === "workspace") throw Error("Lost workspace response"); return { id: "workspace-1", directory: "worktree-1" }; },
    async writePlans() { if (state.phase === "plans") throw Error("PLAN write failed"); },
    async startAgent() { state.agents++; if (state.phase === "agent") throw Error("Lost agent response"); return "agent-1"; },
    async verifyResources() { if (state.resourceError) throw Error(state.resourceError); },
    async observe() { return { ...state.observation }; }, async fingerprint() { return "fingerprint"; },
    async collect() { state.collects++; if (state.collectionError) throw Error("Evidence over limit"); return { id: `result-${state.collects}`, sourceKey: state.observation.sourceKey, collectedAt: new Date().toISOString(), finalResponse: "Done", agentStatus: "idle", changedFiles: [], diffStat: "", fingerprint: "fingerprint", checks: [], failure: null, executionFailure: null }; },
    async resume() { state.sends++; if (state.phase === "resume") throw Error("Lost message response"); },
    async lookupDelivery() { state.lookups++; return state.lookup; },
  };
  const input = await prepare(store, runtime, "m5-request-001", feature);
  const start = new StartFeatureRequest(store), recover = new RecoverRequest(store, start.locks), tracker = new TrackExecution(store, start.locks);
  const current = async () => (await store.get(input.token))!;
  const recoveryInput = (record: RequestRecord, key: string, target = record.commands.at(-1)!.key) => ({ token: record.token, commandKey: key, expectedRevision: record.revision, targetCommandKey: target });
  const resumeInput = (record: RequestRecord, key = "m5-resume-001") => ({ token: record.token, key, expectedRevision: record.revision, resultId: record.result?.id ?? null, instruction: "Fix the implementation only" });
  return { dir, store, state, runtime, input, start, recover, tracker, current, recoveryInput, resumeInput };
}

test("M5 confirmed PLAN failure retries the existing workspace once and survives queued retry restart", async t => {
  const f = await fixture(t); f.state.phase = "plans";
  const failed = await f.start.start(f.input, f.runtime), firstCommand = structuredClone(failed.commands.at(-1)!);
  assert.equal(failureView(failed)?.kind, "setup"); assert.ok(allowedActions(failed).includes("retry-start"));
  const input = f.recoveryInput(failed, "m5-retry-001");
  await assert.rejects(f.recover.retry(input, () => { throw Error("RESTORING"); }), /RESTORING/);
  await Promise.all([f.recover.retry(input), f.recover.retry(input)]);
  f.state.phase = ""; const restored = await new StartFeatureRequest(f.store).advance(f.input.token, f.runtime);
  assert.equal(restored.status, "started"); assert.equal(f.state.workspaces, 1); assert.equal(f.state.agents, 1); assert.equal(restored.attempt, 1);
  assert.deepEqual(restored.commands.find(x => x.key === firstCommand.key), firstCommand);
  await f.recover.retry({ ...input, expectedRevision: 0 }, () => { throw Error("RESTORING"); }); await f.start.start(f.input, f.runtime);
  assert.equal(f.state.agents, 1);
  await assert.rejects(f.recover.retry({ ...input, targetCommandKey: "changed" }), /IDEMPOTENCY_CONFLICT/);
});

test("M5 retry requires the current failed command, revision and free project slot", async t => {
  const f = await fixture(t); f.state.phase = "plans"; const r = await f.start.start(f.input, f.runtime), input = f.recoveryInput(r, "m5-retry-001");
  await assert.rejects(f.recover.retry({ ...input, expectedRevision: 0 }), /REVISION_CONFLICT/);
  await assert.rejects(f.recover.retry({ ...input, targetCommandKey: "other" }), /INVALID_STATE/);
  const other = await prepare(f.store, f.runtime, "m5-request-other", feature); await f.start.accept(other, f.runtime);
  await assert.rejects(f.recover.retry(input), /BUSY/);
  assert.equal(f.state.workspaces, 1);
});

for (const phase of ["workspace", "agent"] as const) test(`M5 uncertain ${phase} is looked up, never recreated, and only found resources advance`, async t => {
  const f = await fixture(t); f.state.phase = phase; let r = await f.start.start(f.input, f.runtime);
  assert.equal(r.status, "needs-input"); const target = r.commands.at(-1)!.key;
  await assert.rejects(f.recover.retry(f.recoveryInput(r, "m5-retry-forbidden")), /DELIVERY_UNKNOWN/);
  for (const [i, lookup] of [{ kind: "absent" }, { kind: "unknown", reason: "Incomplete inventory" }].entries()) {
    f.state.lookup = lookup as typeof f.state.lookup;
    const input = f.recoveryInput(r, `m5-reconcile-${i}`, target);
    r = await f.recover.reconcile(input, f.runtime); const calls = f.state.lookups;
    await f.recover.reconcile({ ...input, expectedRevision: 0 }, f.runtime); assert.equal(f.state.lookups, calls);
    assert.equal(occupiesSlot(r), true); assert.equal(r.commands.find(x => x.key === target)!.status, "unknown");
  }
  f.state.lookup = { kind: "found", value: phase === "workspace" ? { id: "workspace-1", directory: "worktree-1" } : { id: "agent-1" } };
  r = await f.recover.reconcile(f.recoveryInput(r, "m5-reconcile-found", target), f.runtime);
  f.state.phase = ""; if (phase === "workspace") r = await f.start.advance(r.token, f.runtime);
  assert.equal(r.agentId, "agent-1"); assert.equal(f.state.workspaces, 1); assert.equal(f.state.agents, 1); assert.equal(r.attempt, 1);
  assert.equal(r.deliveryChecks?.length, 3);
  const tampered = await f.current(); tampered.deliveryChecks![0].detail = "overwrite"; await assert.rejects(f.store.save(tampered), /IMMUTABLE_HISTORY/);
});

test("M5 lookup failure and malformed found workspace keep unknown with an immutable audit", async t => {
  const f = await fixture(t); f.state.phase = "workspace"; let r = await f.start.start(f.input, f.runtime); const target = r.commands.at(-1)!.key;
  f.runtime.lookupDelivery = async () => { throw Error("offline"); };
  r = await f.recover.reconcile(f.recoveryInput(r, "m5-offline-check", target), f.runtime); assert.equal(r.deliveryChecks![0].outcome, "unknown");
  f.runtime.lookupDelivery = async () => ({ kind: "found", value: { id: "workspace-1" } });
  r = await f.recover.reconcile(f.recoveryInput(r, "m5-bad-found-check", target), f.runtime); assert.equal(r.workspaceId, null); assert.equal(occupiesSlot(r), true);
});

test("M5 resume rejects missing concurrency fields, stale results/revisions and simultaneous new keys", async t => {
  const f = await fixture(t); await f.start.start(f.input, f.runtime); const r = await f.tracker.refresh(f.input.token, f.runtime), input = f.resumeInput(r);
  await assert.rejects(f.tracker.resume({ token: r.token, key: input.key, instruction: input.instruction }, f.runtime), /COMMAND_REQUIRED/);
  await assert.rejects(f.tracker.resume({ ...input, expectedRevision: 0 }, f.runtime), /REVISION_CONFLICT/);
  await assert.rejects(f.tracker.resume({ ...input, resultId: "old" }, f.runtime), /STALE_RESULT/);
  const outcomes = await Promise.allSettled([f.tracker.resume(input, f.runtime), f.tracker.resume({ ...input, key: "m5-resume-second" }, f.runtime)]);
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1); assert.equal(f.state.sends, 1);
  const replay = await f.tracker.resume(input, f.runtime); assert.equal(replay.attempt, 2); assert.equal(f.state.sends, 1);
  await assert.rejects(f.tracker.resume({ ...input, instruction: "different" }, f.runtime), /IDEMPOTENCY_CONFLICT/);
});

test("M5 uncertain resume found by original identity resolves without a second message or attempt", async t => {
  const f = await fixture(t); await f.start.start(f.input, f.runtime); let r = await f.tracker.refresh(f.input.token, f.runtime); const first = r.results[0];
  f.state.phase = "resume"; const resume = f.resumeInput(r); r = await f.tracker.resume(resume, f.runtime);
  assert.equal(r.recovery?.pending, true); assert.equal(r.attempt, 2);
  f.state.lookup = { kind: "found", value: { id: r.recovery!.messageId } };
  r = await new RecoverRequest(f.store, f.start.locks).reconcile(f.recoveryInput(r, "m5-resume-reconcile", resume.key), f.runtime);
  assert.equal(r.recovery?.pending, false); assert.equal(f.state.sends, 1); assert.equal(r.attempt, 2); assert.deepEqual(r.results[0], first);
  await f.tracker.resume(resume, f.runtime); assert.equal(f.state.sends, 1);
});

test("M5 missing resources block sends before attempt allocation; network errors do not become execution failure", async t => {
  const f = await fixture(t); await f.start.start(f.input, f.runtime); let r = await f.tracker.refresh(f.input.token, f.runtime), input = f.resumeInput(r);
  const before = await readFile(join(f.dir, `${r.token}.json`));
  f.state.resourceError = "Connection unavailable"; await assert.rejects(f.tracker.resume(input, f.runtime), /Connection/); assert.deepEqual(await readFile(join(f.dir, `${r.token}.json`)), before);
  f.state.resourceError = "RESOURCE_MISSING: worktree removed"; await assert.rejects(f.tracker.resume(input, f.runtime), /RESOURCE_MISSING/);
  r = await f.current(); assert.equal(failureView(r)?.kind, "resource-missing"); assert.equal(r.attempt, 1); assert.equal(f.state.sends, 0); assert.ok(!allowedActions(r).includes("resume")); assert.equal(r.results.length, 1);
});

test("M5 a collection failure with no result can revalidate without a new attempt and replay its command", async t => {
  const f = await fixture(t); await f.start.start(f.input, f.runtime); f.state.collectionError = true;
  let r = await f.tracker.refresh(f.input.token, f.runtime); assert.equal(r.result, null); assert.equal(failureView(r)?.kind, "verification-system"); assert.ok(allowedActions(r).includes("revalidate"));
  assert.equal(r.observationError, null); assert.equal(r.observation?.consecutiveFailures, 0);
  const input = { commandKey: "m5-validation-retry", expectedRevision: r.revision, resultId: null };
  f.state.collectionError = false; r = await f.tracker.refresh(r.token, f.runtime, undefined, true, input);
  assert.equal(r.status, "awaiting-review"); assert.equal(r.attempt, 1); assert.equal(r.results.length, 1);
  await f.tracker.refresh(r.token, f.runtime, undefined, true, input); assert.equal(f.state.collects, 2);
});

test("M5 read-only failure classification distinguishes execution, assertion, validator and review rejection", async t => {
  const f = await fixture(t); await f.start.start(f.input, f.runtime); const r = await f.tracker.refresh(f.input.token, f.runtime);
  r.status = "failed"; r.failure = null; r.result!.executionFailure = "Canceled"; assert.equal(failureView(r)?.kind, "execution");
  r.result!.executionFailure = null; assert.equal(failureView(r)?.kind, "validation");
  r.result!.checks = [{ label: "Error", passed: false, status: "error", command: "test", exitCode: null, output: "failed to start", durationMs: 1 }]; assert.equal(failureView(r)?.kind, "verification-system");
  r.decision = { approved: false, note: "Needs correction", at: "now", resultId: r.result!.id }; assert.equal(failureView(r)?.kind, "review-rejected");
});

test("M5 successful resume never collects the previous turn as the new attempt", async t => {
  const f = await fixture(t); await f.start.start(f.input, f.runtime); let r = await f.tracker.refresh(f.input.token, f.runtime);
  r = await f.tracker.resume(f.resumeInput(r), f.runtime);
  r = await f.tracker.refresh(r.token, f.runtime); assert.equal(r.result, null); assert.equal(r.status, "started"); assert.equal(f.state.collects, 1);
  f.state.observation.sourceKey = "turn-2";
  r = await f.tracker.refresh(r.token, f.runtime); assert.equal(r.status, "awaiting-review"); assert.equal(r.attempt, 2); assert.equal(r.results.length, 2);
});

test("M5 a foreign found message cannot resolve the pending resume", async t => {
  const f = await fixture(t); await f.start.start(f.input, f.runtime); let r = await f.tracker.refresh(f.input.token, f.runtime);
  f.state.phase = "resume"; const input = f.resumeInput(r); r = await f.tracker.resume(input, f.runtime);
  f.state.lookup = { kind: "found", value: { id: "foreign-message" } };
  r = await f.recover.reconcile(f.recoveryInput(r, "m5-foreign-message", input.key), f.runtime);
  assert.equal(r.deliveryChecks!.at(-1)!.outcome, "unknown"); assert.equal(r.recovery?.pending, true); assert.equal(f.state.sends, 1);
});
