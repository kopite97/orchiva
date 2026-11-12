import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createRequest } from "../domain/request";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { TrackExecution } from "../application/track-execution";
import { RequestLocks } from "../application/request-locks";
import { collectFiles, snapshotFiles } from "../adapters/storage/evidence";
import type { ExecutionResult } from "../../shared/contracts/feature-request";
import type { LifecycleRuntime, Observation } from "../application/ports";
const feature = { title: "M4", goal: "Goal", scope: "Scope", constraints: "Sandbox", validation: "Verify", completionCriteria: "Behavior works" };
const observation: Observation = { status: "ended", agentStatus: "idle", sourceKey: "turn-1", finalResponse: "Done", failure: null, seenRecovery: false, turnId: "turn-1" };
async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "orchiva-m4-"));
  t.after(async () => { const delta = relative(tmpdir(), path); assert.ok(delta && !delta.startsWith("..") && !isAbsolute(delta)); await rm(path, { recursive: true, force: true }); });
  return path;
}
async function reviewFixture(t: TestContext, automatic = true) {
  const dir = await directory(t), store = new JsonRequestStore(dir); t.after(() => store.close());
  const record = createRequest("m4-review-test-001", feature);
  record.criteria = [{ id: "criterion", text: "Behavior works", checkIds: automatic ? ["test"] : [], manualMethod: "Inspect behavior", legacy: false }];
  record.status = "awaiting-review"; record.agentId = "agent"; record.worktreePath = "worktree";
  const result: ExecutionResult = { id: "result-1", sourceKey: "turn-1", collectedAt: new Date().toISOString(), finalResponse: "Done", agentStatus: "idle", changedFiles: ["test.mjs"], files: [{ path: "test.mjs", changeType: "untracked", sha256: "abc", size: 1, deleted: false, isCheckInput: true }], fingerprint: "fp", diffStat: "", checks: automatic ? [{ checkId: "test", status: "passed", passed: true, label: "Test", command: "node --test", exitCode: 0, output: "pass", durationMs: 1, inputFingerprint: "abc" }] : [], failure: null, executionFailure: null, testChanges: [] };
  record.result = result; await store.save(record);
  const state = { fingerprint: "fp", observation: { ...observation }, collections: 0 };
  const runtime: LifecycleRuntime = { async observe() { return state.observation; }, async fingerprint() { return state.fingerprint; }, async collect() { state.collections++; return { ...result, id: `result-${state.collections + 1}`, fingerprint: state.fingerprint }; }, async resume() {} };
  const tracker = new TrackExecution(store, new RequestLocks());
  const input = { token: record.token, resultId: result.id, commandKey: "m4-review-command-001", expectedRevision: record.revision, approved: true, note: "Verified all criteria", criteriaReviews: [{ criterionId: "criterion", satisfied: true, evidenceRefs: automatic ? [{ kind: "check" as const, id: "test" }] : [], note: automatic ? "" : "Manually inspected the behavior" }], testChangesAcknowledged: false, testChangeNote: "" };
  return { store, record, state, runtime, tracker, input, dir };
}

test("M4 requires explicit grounded verdicts; rejects missing, duplicate, foreign and unmet criteria without writes", async t => {
  const f = await reviewFixture(t), original = await readFile(join(f.dir, `${f.record.token}.json`));
  const cases = [
    { criteriaReviews: undefined }, { criteriaReviews: [] }, { criteriaReviews: [f.input.criteriaReviews[0], f.input.criteriaReviews[0]] },
    { criteriaReviews: [{ ...f.input.criteriaReviews[0], criterionId: "foreign" }] },
    { criteriaReviews: [{ ...f.input.criteriaReviews[0], evidenceRefs: [{ kind: "check", id: "other" }] }] },
    { criteriaReviews: [{ ...f.input.criteriaReviews[0], evidenceRefs: [{ kind: "file", id: "other.txt" }] }] },
    { criteriaReviews: [{ ...f.input.criteriaReviews[0], evidenceRefs: [], note: "short" }] },
    { criteriaReviews: [{ ...f.input.criteriaReviews[0], satisfied: false }] }, { expectedRevision: undefined }, { commandKey: undefined },
  ];
  for (const patch of cases) await assert.rejects(f.tracker.review({ ...f.input, ...patch }, f.runtime), /REVIEW_REQUIRED|INVALID_REFERENCE/);
  assert.deepEqual(await readFile(join(f.dir, `${f.record.token}.json`)), original);
  const approved = await f.tracker.review(f.input, f.runtime);
  assert.equal(approved.status, "completed"); assert.deepEqual(approved.decisions[0].criteriaReviews, f.input.criteriaReviews);
  assert.equal((await f.tracker.review(f.input, f.runtime)).revision, approved.revision);
  await assert.rejects(f.tracker.review({ ...f.input, criteriaReviews: [{ ...f.input.criteriaReviews[0], note: "Changed" }] }, f.runtime), /IDEMPOTENCY_CONFLICT/);
});

test("M4 no-check approval requires concrete manual evidence even with a file reference", async t => {
  const f = await reviewFixture(t, false);
  await assert.rejects(f.tracker.review({ ...f.input, criteriaReviews: [{ ...f.input.criteriaReviews[0], note: "", evidenceRefs: [{ kind: "file", id: "test.mjs" }] }] }, f.runtime), /manual evidence/);
  assert.equal((await f.tracker.review(f.input, f.runtime)).status, "completed");
});

test("M4 stale session/revision/result/fingerprint and unknown delivery preserve selected evidence", async t => {
  const f = await reviewFixture(t);
  await assert.rejects(f.tracker.review({ ...f.input, expectedRevision: 0 }, f.runtime), /REVISION_CONFLICT/);
  await assert.rejects(f.tracker.review({ ...f.input, resultId: "old" }, f.runtime), /STALE_RESULT/);
  f.state.observation = { ...observation, status: "running" };
  await assert.rejects(f.tracker.review(f.input, f.runtime), /execution changed/);
  f.state.observation = { ...observation, sourceKey: "turn-2" };
  await assert.rejects(f.tracker.review(f.input, f.runtime), /execution changed/);
  f.state.observation = observation; f.state.fingerprint = "edited";
  await assert.rejects(f.tracker.review(f.input, f.runtime), /STALE_RESULT/);
  assert.deepEqual((await f.store.get(f.record.token))!.result, f.record.result);
  const pending = (await f.store.get(f.record.token))!; pending.recovery = { pending: true, key: "pending-key-001", messageId: "message", instruction: "Fix" }; await f.store.save(pending);
  await assert.rejects(f.tracker.review({ ...f.input, expectedRevision: pending.revision }, f.runtime), /DELIVERY_UNKNOWN/);
});

test("M4 defensive checks reject failed/error/skipped results even under an inconsistent review status", async t => {
  for (const status of ["failed", "error", "skipped"] as const) {
    const f = await reviewFixture(t), record = (await f.store.get(f.record.token))!;
    record.result = { ...record.result!, id: `result-${status}`, checks: [{ ...record.result!.checks[0], status, passed: false }] }; await f.store.save(record);
    await assert.rejects(f.tracker.review({ ...f.input, resultId: record.result.id, expectedRevision: record.revision }, f.runtime), /failed evidence/);
  }
});

test("M4 test changes require explicit acknowledgement and reason; completion inspection is read-only", async t => {
  const f = await reviewFixture(t), r = (await f.store.get(f.record.token))!;
  r.result = { ...r.result!, id: "result-2", testChanges: [{ checkId: "test", path: "test.mjs", baselineResultId: "result-1", before: "abc", after: "def" }] }; await f.store.save(r);
  const input = { ...f.input, resultId: "result-2", expectedRevision: r.revision };
  await assert.rejects(f.tracker.review(input, f.runtime), /TEST_CHANGE_REQUIRED/);
  await assert.rejects(f.tracker.review({ ...input, testChangesAcknowledged: true, testChangeNote: "short" }, f.runtime), /TEST_CHANGE_REQUIRED/);
  const approved = await f.tracker.review({ ...input, testChangesAcknowledged: true, testChangeNote: "Reviewed the intentional check change" }, f.runtime);
  const bytes = await readFile(join(f.dir, `${r.token}.json`)); f.state.fingerprint = "edited-after-completion";
  assert.equal((await f.tracker.inspect(r.token, "result-2", f.runtime)).matches, false);
  assert.deepEqual(await readFile(join(f.dir, `${r.token}.json`)), bytes);
  assert.equal(approved.decisions[0].testChangesAcknowledged, true); assert.equal(approved.results.length, 2);
});

async function evidenceFixture(t: TestContext) {
  const root = await directory(t);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { windowsHide: true, stdio: "pipe" });
  git("init"); await writeFile(join(root, "tracked.txt"), "base"); await writeFile(join(root, "same.test.mjs"), "console.log('baseline');"); git("add", "."); git("-c", "user.name=Orchiva Test", "-c", "user.email=test@localhost", "commit", "-m", "fixture");
  const record = createRequest("m4-evidence-test-001", feature, [{ id: "test", kind: "node-test", path: "same.test.mjs", label: "Node" }]); record.worktreePath = root;
  return { root, record, git };
}

test("M4 captures unmodified check inputs, untracked/deleted files and first-input baseline across validations", async t => {
  const { root, record } = await evidenceFixture(t);
  await writeFile(join(root, "new.txt"), "new"); await rm(join(root, "tracked.txt"));
  await writeFile(join(root, " leading.txt"), "leading space");
  const first = await collectFiles(record, observation); assert.equal(first.checks[0].status, "passed");
  assert.equal(first.files!.find(x => x.path === "same.test.mjs")!.changeType, "check-input");
  assert.equal(first.files!.find(x => x.path === "tracked.txt")!.deleted, true);
  assert.equal(first.files!.find(x => x.path === "new.txt")!.changeType, "untracked");
  assert.ok(first.files!.some(x => x.path === " leading.txt"));
  record.results = [{ ...first, attemptNumber: 1, validationRun: 1, legacy: false }];
  await writeFile(join(root, "same.test.mjs"), "console.log('new assertions');");
  const second = await collectFiles(record, observation); assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(second.testChanges!.length, 1); assert.equal(second.testChanges![0].baselineResultId, first.id);
  assert.equal(second.testChanges![0].before, first.checks[0].inputFingerprint);
  assert.equal((await snapshotFiles(root, record.checks)).fingerprint, second.fingerprint);
});

test("M4 distinguishes assertion failure, validator error, ignored inputs, missing files and budget skips", async t => {
  const { root, record } = await evidenceFixture(t);
  await writeFile(join(root, "same.test.mjs"), "import assert from 'node:assert/strict'; assert.equal(1,2);");
  assert.equal((await collectFiles(record, observation)).checks[0].status, "failed");
  await writeFile(join(root, "same.test.mjs"), "invalid javascript !!!!");
  assert.equal((await collectFiles(record, observation)).checks[0].status, "error");
  await writeFile(join(root, ".gitignore"), "same.test.mjs\n");
  const ignored = await collectFiles(record, observation); assert.equal(ignored.checks[0].status, "error"); assert.match(ignored.checks[0].output, /Ignored/);
  await rm(join(root, ".gitignore")); await rm(join(root, "same.test.mjs"));
  assert.equal((await collectFiles(record, observation)).checks[0].status, "error");
  assert.equal((await collectFiles(record, observation, { budgetMs: 0 })).checks[0].status, "skipped");
  record.checks = [{ id: "text", kind: "file-contains", path: "tracked.txt", text: "missing", label: "Text" }];
  assert.equal((await collectFiles(record, observation)).checks[0].status, "failed");
});

test("M4 distinguishes timeouts, output truncation and collection limits", async t => {
  const { root, record } = await evidenceFixture(t);
  await writeFile(join(root, "same.test.mjs"), "while(true) {}");
  const timeout = await collectFiles(record, observation, { checkTimeoutMs: 60 }); assert.equal(timeout.checks[0].status, "error"); assert.equal(timeout.checks[0].failureKind, "timeout");
  await writeFile(join(root, "same.test.mjs"), "console.log('x'.repeat(20000));");
  const truncated = await collectFiles(record, { ...observation, finalResponse: "y".repeat(33000) });
  assert.equal(truncated.checks[0].truncated, true); assert.equal(truncated.checks[0].output.length, 16000); assert.equal(truncated.truncation?.finalResponse, true); assert.equal(truncated.failure, null);
  await writeFile(join(root, "huge.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(collectFiles(record, observation), /2 MiB/);
});

test("M4 tracked check ignore rules outside the worktree invalidate the review fingerprint", async t => {
  const { root, record } = await evidenceFixture(t);
  const before = await snapshotFiles(root, record.checks);
  await writeFile(join(root, ".git", "info", "exclude"), "same.test.mjs\n");
  const after = await snapshotFiles(root, record.checks);
  assert.deepEqual(after.files, before.files);
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.equal((await collectFiles(record, observation)).checks[0].status, "error");
});
