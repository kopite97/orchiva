import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrackExecution } from "../application/track-execution";
import { RequestLocks } from "../application/request-locks";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { createRequest } from "../domain/request";
import { recordSchema } from "../../shared/contracts/feature-request";
import type { LifecycleRuntime, Observation } from "../application/ports";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-lifecycle-"));
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const store = new JsonRequestStore(directory), locks = new RequestLocks();
  const record = createRequest("lifecycle-test-001", { title: "Lifecycle", goal: "Small feature", scope: "One module", constraints: "Sandbox", validation: "Tests pass", completionCriteria: "Expected behavior" });
  record.agentId = "agent-1"; record.workspaceId = "workspace-1"; record.worktreePath = "sandbox-worktree"; record.status = "started";
  await store.save(record);
  const state = { observation: { status: "running", agentStatus: "running", sourceKey: "turn-1", finalResponse: "Done", failure: null, seenRecovery: false, turnId: "turn-1" } as Observation, passed: true, fingerprint: "hash-1", sends: 0, uncertain: false, collections: 0 };
  const runtime: LifecycleRuntime = {
    async observe() { return { ...state.observation }; },
    async collect(_, observation) {
      state.collections++;
      return { id: `result-${state.collections}`, sourceKey: observation.sourceKey, finalResponse: observation.finalResponse, agentStatus: observation.agentStatus, collectedAt: new Date().toISOString(), changedFiles: ["feature.mjs"], diffStat: "1 file", fingerprint: state.fingerprint,
        checks: [{ label: "test", command: "node --test", passed: state.passed, exitCode: state.passed ? 0 : 1, output: state.passed ? "pass" : "assertion failed", durationMs: 5 }], executionFailure: observation.failure, failure: observation.failure ?? (state.passed ? null : "Test failed") };
    },
    async fingerprint() { return state.fingerprint; },
    async resume() { state.sends++; if (state.uncertain) throw new Error("lost connection"); state.observation = { ...state.observation, status: "running", agentStatus: "running" }; },
  };
  return { record, store, locks, state, runtime, tracker: new TrackExecution(store, locks) };
}
test("tracks running and permission states; a completed turn requires evidence and explicit review", async t => {
  const f = await fixture(t);
  assert.equal((await f.tracker.refresh(f.record.token, f.runtime)).status, "running");
  f.state.observation.status = "needs-input";
  assert.equal((await f.tracker.refresh(f.record.token, f.runtime)).status, "needs-input");
  f.state.observation.status = "ended";
  const result = await f.tracker.refresh(f.record.token, f.runtime);
  assert.equal(result.status, "awaiting-review");
  assert.equal(result.result?.checks[0]?.exitCode, 0);
  const decision = { token: f.record.token, resultId: result.result!.id, approved: true, note: "Expected behavior verified", expectedRevision: result.revision, commandKey: "approve-criteria-001", criteriaReviews: result.criteria.map(c => ({ criterionId: c.id, satisfied: true, evidenceRefs: [], note: "Expected behavior independently verified" })) };
  assert.equal((await f.tracker.review(decision, f.runtime)).status, "completed");
  await f.tracker.refresh(f.record.token, f.runtime, { kind: "completed" });
  assert.equal((await f.store.get(f.record.token))?.status, "completed");
  assert.equal(f.state.collections, 1);
});
test("failed tests cannot be approved; recovery retains session and worktree and preserves failed evidence", async t => {
  const f = await fixture(t);
  f.state.observation.status = "ended"; f.state.passed = false;
  const failed = await f.tracker.refresh(f.record.token, f.runtime);
  assert.equal(failed.status, "failed");
  await assert.rejects(f.tracker.review({ token: failed.token, resultId: failed.result!.id, approved: true, note: "Ignore failed test" }, f.runtime), /not ready/);
  const input = { token: failed.token, key: "recovery-key-001", instruction: "Fix the failing implementation" };
  await Promise.all([f.tracker.resume(input, f.runtime), f.tracker.resume(input, f.runtime)]);
  assert.equal(f.state.sends, 1);
  const resumed = (await f.store.get(failed.token))!;
  assert.equal(resumed.attempt, 2); assert.equal(resumed.agentId, failed.agentId); assert.equal(resumed.worktreePath, failed.worktreePath);
  assert.equal(resumed.attempts[0]?.result?.checks[0]?.passed, false);
  f.state.observation = { ...f.state.observation, status: "ended", sourceKey: "turn-2", turnId: "turn-2" }; f.state.passed = true;
  const passed = await new TrackExecution(f.store, f.locks).refresh(failed.token, f.runtime);
  assert.equal(passed.status, "awaiting-review");
  assert.equal(passed.result?.checks[0]?.passed, true);
});
test("review rejects stale results and changed worktree contents", async t => {
  const f = await fixture(t); f.state.observation.status = "ended";
  const result = await f.tracker.refresh(f.record.token, f.runtime);
  await assert.rejects(f.tracker.review({ token: result.token, resultId: "old", approved: true, note: "Reviewed" }, f.runtime), /changed/);
  f.state.fingerprint = "changed";
  await assert.rejects(f.tracker.review({ token: result.token, resultId: result.result!.id, approved: true, note: "Reviewed" }, f.runtime), /Files changed/);
  assert.equal((await f.store.get(result.token))?.status, "awaiting-review");
});
test("missed hooks are reconciled after restart; canceled turns fail and stale turn events do not corrupt new results", async t => {
  const f = await fixture(t); f.state.observation.status = "ended";
  assert.equal((await new TrackExecution(f.store, f.locks).refresh(f.record.token, f.runtime, { kind: "canceled", reason: "Canceled", turnId: "turn-1" })).status, "failed");
  f.state.observation.sourceKey = "turn-2"; f.state.observation.turnId = "turn-2";
  assert.equal((await f.tracker.refresh(f.record.token, f.runtime, { kind: "failed", error: { message: "Old failure" }, turnId: "turn-1" })).status, "awaiting-review");
});
test("uncertain resume is reconciled from delivered message without a duplicate send", async t => {
  const f = await fixture(t); f.state.observation.status = "ended"; f.state.passed = false;
  await f.tracker.refresh(f.record.token, f.runtime); f.state.uncertain = true;
  await f.tracker.resume({ token: f.record.token, key: "uncertain-key-001", instruction: "Fix" }, f.runtime);
  const pending = (await f.store.get(f.record.token))!;
  assert.equal(pending.recovery?.pending, true);
  f.state.observation.seenRecovery = true; f.state.observation.sourceKey = "turn-2"; f.state.passed = true;
  const recovered = await new TrackExecution(f.store, f.locks).refresh(f.record.token, f.runtime);
  assert.equal(recovered.status, "awaiting-review"); assert.equal(f.state.sends, 1);
});
test("old PoC records acquire lifecycle defaults without losing original data", () => {
  const record = createRequest("migration-test-001", { title: "Old", goal: "Goal", scope: "Scope", constraints: "Constraints", validation: "Validation", completionCriteria: "Criteria" });
  const { checks, result, attempts, events, attempt, recovery, decision, observationError, ...old } = record;
  const migrated = recordSchema.parse(old);
  assert.equal(migrated.attempt, 1); assert.deepEqual(migrated.checks, []); assert.equal(migrated.result, null); assert.equal(migrated.id, old.id);
});

test("unknown recovery after restart neither resends nor permits a replacement instruction", async t => {
  const f = await fixture(t); f.state.observation.status = "ended"; f.state.passed = false;
  await f.tracker.refresh(f.record.token, f.runtime); f.state.uncertain = true;
  await f.tracker.resume({ token: f.record.token, key: "unknown-key-001", instruction: "Fix" }, f.runtime);
  const checkpoint = (await f.store.get(f.record.token))!;
  const tracker = new TrackExecution(f.store, f.locks);
  for (let i = 0; i < 2; i++) {
    const record = await tracker.refresh(f.record.token, f.runtime);
    assert.equal(record.status, "needs-input"); assert.equal(record.recovery?.pending, true);
    assert.equal(record.attempt, checkpoint.attempt); assert.deepEqual(record.attempts, checkpoint.attempts);
  }
  await assert.rejects(tracker.resume({ token: f.record.token, key: "replacement-key-001", instruction: "Try again" }, f.runtime), /pending recovery/);
  assert.equal(f.state.sends, 1);
});

test("explicit refresh reruns checks but preserves a known canceled execution", async t => {
  const f = await fixture(t); f.state.observation.status = "ended"; f.state.passed = false;
  await f.tracker.refresh(f.record.token, f.runtime);
  f.state.passed = true;
  assert.equal((await f.tracker.refresh(f.record.token, f.runtime)).status, "failed");
  assert.equal((await f.tracker.refresh(f.record.token, f.runtime, undefined, true)).status, "awaiting-review");
  await f.tracker.refresh(f.record.token, f.runtime, { kind: "canceled", reason: "User stopped the task" });
  const refreshed = await f.tracker.refresh(f.record.token, f.runtime, undefined, true);
  assert.equal(refreshed.status, "failed");
  assert.equal(refreshed.result?.failure, "User stopped the task");
});

test("revalidation and resume preserve rejected decisions and all result versions", async t => {
  const f = await fixture(t); f.state.observation.status = "ended";
  const first = await f.tracker.refresh(f.record.token, f.runtime);
  const decision = { token: first.token, resultId: first.result!.id, approved: false, note: "Needs refinement", commandKey: "review-history-001", expectedRevision: first.revision, criteriaReviews: first.criteria.map(c => ({ criterionId: c.id, satisfied: false, evidenceRefs: [], note: "Expected behavior needs refinement" })) };
  await f.tracker.review(decision, f.runtime);
  const second = await f.tracker.refresh(first.token, f.runtime, undefined, true);
  assert.equal(second.results.length, 2); assert.equal(second.decisions.length, 1);
  assert.equal(second.decisions[0].resultId, first.result!.id); assert.equal(second.decisions[0].approved, false);
  await f.tracker.resume({ token: first.token, key: "resume-history-001", instruction: "Refine" }, f.runtime);
  f.state.observation = { ...f.state.observation, status: "ended", sourceKey: "turn-2" };
  await f.tracker.refresh(first.token, f.runtime);
  await f.tracker.resume({ token: first.token, key: "resume-history-002", instruction: "Refine more" }, f.runtime);
  const before = (await f.store.get(first.token))!;
  // Old command replay wins over revision mismatch and cannot resend or change the current decision.
  const replay = await f.tracker.resume({ token: first.token, key: "resume-history-001", instruction: "Refine", expectedRevision: 0 }, f.runtime);
  assert.equal(replay.attempt, 3); assert.equal(f.state.sends, 2); assert.deepEqual(replay.results, before.results);
  await assert.rejects(f.tracker.resume({ token: first.token, key: "resume-history-001", instruction: "Changed" }, f.runtime), /IDEMPOTENCY_CONFLICT/);
  await f.tracker.review(decision, f.runtime); assert.equal((await f.store.get(first.token))!.revision, before.revision);
  assert.equal((await f.store.get(first.token))!.attemptHistory.length, 3);
});

test("stale review revision is rejected before mutation and original result survives fingerprint failure", async t => {
  const f = await fixture(t); f.state.observation.status = "ended";
  const record = await f.tracker.refresh(f.record.token, f.runtime);
  await assert.rejects(f.tracker.review({ token: record.token, resultId: record.result!.id, approved: true, note: "Review", expectedRevision: 0 }, f.runtime), /REVISION_CONFLICT/);
  f.state.fingerprint = "edited";
  await assert.rejects(f.tracker.review({ token: record.token, resultId: record.result!.id, approved: true, note: "Review" }, f.runtime), /Files changed/);
  const after = (await f.store.get(record.token))!; assert.deepEqual(after.result, record.result); assert.equal(after.results[0].id, record.result!.id);
});

test("revalidation command replay returns its original result reference without a second validation", async t => {
  const f = await fixture(t); f.state.observation.status = "ended";
  const record = await f.tracker.refresh(f.record.token, f.runtime);
  const input = { commandKey: "revalidate-command-001", resultId: record.result!.id, expectedRevision: record.revision };
  const validated = await f.tracker.refresh(record.token, f.runtime, undefined, true, input);
  assert.equal(f.state.collections, 2);
  const command = validated.commands.find(x => x.key === input.commandKey)!;
  assert.equal(command.status, "applied"); assert.equal(command.outcomeRef, validated.result!.id);
  await f.tracker.refresh(record.token, f.runtime, undefined, true, input);
  assert.equal(f.state.collections, 2);
  await assert.rejects(f.tracker.refresh(record.token, f.runtime, undefined, true, { ...input, resultId: "different" }), /IDEMPOTENCY_CONFLICT/);
});

test("legacy refresh button observes pending recovery and running tasks without creating validation commands", async t => {
  const f = await fixture(t);
  const running = await f.tracker.refresh(f.record.token, f.runtime, undefined, true);
  assert.equal(running.status, "running"); assert.equal(running.commands.length, 0);
  f.state.observation.status = "ended";
  await f.tracker.refresh(f.record.token, f.runtime);
  f.state.uncertain = true;
  await f.tracker.resume({ token: f.record.token, key: "button-pending-001", instruction: "Fix" }, f.runtime);
  f.state.observation.seenRecovery = true; f.state.observation.sourceKey = "next";
  const reconciled = await f.tracker.refresh(f.record.token, f.runtime, undefined, true);
  assert.equal(reconciled.recovery?.pending, false); assert.equal(reconciled.status, "awaiting-review");
  assert.equal(reconciled.commands.length, 1); assert.equal(reconciled.commands[0].status, "applied"); assert.equal(f.state.sends, 1);
});
