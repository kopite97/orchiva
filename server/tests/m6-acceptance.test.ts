import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { DraftRequest } from "../application/draft-request";
import { StartFeatureRequest } from "../application/start-feature-request";
import { TrackExecution } from "../application/track-execution";
import type { LifecycleRuntime, Runtime } from "../application/ports";
import type { ExecutionResult, Feature } from "../../shared/contracts/feature-request";
import { project, commit } from "./helpers/prepared";

const feature: Feature = { title: "M6 통합 흐름", goal: "한 흐름을 끝까지 검증한다.", scope: "요청 한 건", constraints: "격리된 JSON store 사용", validation: "독립 Node 검사", completionCriteria: "검사 근거로 조건을 확인한다." };
const check = { id: "m6-check", kind: "node-test" as const, path: "m6.test.mjs", label: "M6 독립 검사" };
const result = (id: string, sourceKey: string, failed: boolean): ExecutionResult => ({
  id, sourceKey, collectedAt: new Date().toISOString(), finalResponse: failed ? "Intentional first failure." : "M6 result is ready for review.", agentStatus: "idle", changedFiles: ["m6.mjs"], diffStat: "1 file changed", fingerprint: "m6-fingerprint",
  files: [{ path: "m6.mjs", changeType: "modified", sha256: "a".repeat(64), size: 12, deleted: false, isCheckInput: false }],
  checks: [{ checkId: check.id, status: failed ? "failed" : "passed", failureKind: failed ? "assertion" : null, inputFingerprint: "b".repeat(64), truncated: false, label: check.label, command: "node --test m6.test.mjs", passed: !failed, exitCode: failed ? 1 : 0, output: failed ? "AssertionError" : "1 test passed", durationMs: 10 }],
  failure: failed ? "Independent validation failed." : null, executionFailure: null,
});

async function storeFor(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-m6-"));
  const store = new JsonRequestStore(directory); await store.open();
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store };
}

test("M6 acceptance preserves draft, confirmed plan, failure history, same-session recovery and explicit review", async t => {
  const { store } = await storeFor(t); let workspaceCreates = 0, agentCreates = 0, planWrites = 0, sends = 0, collections = 0, sourceKey = "turn-1", fingerprint = "m6-fingerprint";
  const runtime: Runtime & LifecycleRuntime = {
    projectSnapshot: project,
    preflight: async () => ({ baseCommit: commit, projectSnapshot: project }), validate: async () => {},
    createWorkspace: async () => { workspaceCreates++; return { id: "m6-workspace", directory: "C:/isolated/m6" }; },
    writePlans: async () => { planWrites++; }, startAgent: async () => { agentCreates++; return "m6-agent"; },
    verifyResources: async () => {}, observe: async () => ({ status: "ended", agentStatus: "idle", sourceKey, finalResponse: "M6 response", failure: null, seenRecovery: true }),
    collect: async (_record, observation) => { collections++; return result(`m6-result-${collections}`, observation.sourceKey, collections === 1); },
    fingerprint: async () => fingerprint, resume: async () => { sends++; sourceKey = "turn-2"; },
  };
  const drafts = new DraftRequest(store), starter = new StartFeatureRequest(store), tracker = new TrackExecution(store, starter.locks), token = "m6-acceptance-flow-001";
  const criteria = [{ id: "completion", text: feature.completionCriteria, checkIds: [check.id], manualMethod: "", legacy: false }];
  const draft = await drafts.save({ token, commandKey: "m6-save-001", expectedRevision: 0, feature, criteria, checks: [check] });
  const replayedDraft = await drafts.save({ token, commandKey: "m6-save-001", expectedRevision: 0, feature, criteria, checks: [check] });
  assert.equal(replayedDraft.revision, draft.revision); assert.equal(replayedDraft.commands.filter(x => x.kind === "save-draft").length, 1);

  const firstPlan = await drafts.prepare({ token, commandKey: "m6-plan-001", expectedRevision: draft.revision }, runtime);
  const staleInput = { token, commandKey: "m6-start-stale-001", expectedRevision: firstPlan.revision, planRevision: 1, inputHash: firstPlan.plans[0].inputHash };
  const editedFeature = { ...feature, goal: "수정된 목표로 새 계획을 만든다." };
  const edited = await drafts.save({ token, commandKey: "m6-save-002", expectedRevision: firstPlan.revision, feature: editedFeature, criteria, checks: [check] });
  await assert.rejects(starter.start(staleInput, runtime), /REVISION_CONFLICT/);
  assert.equal(workspaceCreates, 0); assert.equal(agentCreates, 0);

  const planned = await drafts.prepare({ token, commandKey: "m6-plan-002", expectedRevision: edited.revision }, runtime);
  const startInput = { token, commandKey: "m6-start-001", expectedRevision: planned.revision, planRevision: planned.plans.at(-1)!.revision, inputHash: planned.plans.at(-1)!.inputHash };
  const accepted = await starter.accept(startInput, runtime);
  assert.equal(accepted.status, "planned"); assert.equal(workspaceCreates, 0); assert.equal(agentCreates, 0);
  await starter.advance(token, runtime);
  await starter.advance(token, runtime);
  assert.equal(workspaceCreates, 1); assert.equal(agentCreates, 1); assert.equal(planWrites, 1);

  const failed = await tracker.refresh(token, runtime);
  assert.equal(failed.status, "failed"); assert.equal(failed.results.length, 1); assert.equal(failed.attempt, 1);
  const failedResult = failed.result!;
  const recovered = await tracker.refresh(token, runtime, undefined, true, { commandKey: "m6-revalidate-001", resultId: failedResult.id, expectedRevision: failed.revision });
  assert.equal(recovered.status, "awaiting-review"); assert.equal(recovered.results.length, 2); assert.equal(recovered.attempt, 1);
  const freshResult = recovered.result!;
  fingerprint = "changed-after-validation";
  await assert.rejects(tracker.review({ token, commandKey: "m6-review-stale-001", expectedRevision: recovered.revision, resultId: freshResult.id, approved: true, note: "Stale review must be rejected.", criteriaReviews: [{ criterionId: "completion", satisfied: true, evidenceRefs: [{ kind: "check", id: check.id }], note: "" }] }, runtime), /STALE_RESULT/);
  fingerprint = "m6-fingerprint";
  const rejected = await tracker.review({ token, commandKey: "m6-review-reject-001", expectedRevision: recovered.revision, resultId: freshResult.id, approved: false, note: "Please document the expected edge case before completion.", criteriaReviews: [{ criterionId: "completion", satisfied: false, evidenceRefs: [{ kind: "check", id: check.id }], note: "" }] }, runtime);
  assert.equal(rejected.status, "failed"); assert.equal(rejected.decisions.length, 1);

  const resumeInput = { token, key: "m6-resume-001", instruction: "Add the missing edge-case note, keep the original check, then report back.", expectedRevision: rejected.revision, resultId: freshResult.id };
  const resumed = await tracker.resume(resumeInput, runtime);
  assert.equal(resumed.status, "running"); assert.equal(resumed.attempt, 2); assert.equal(sends, 1);
  const replayedResume = await tracker.resume(resumeInput, runtime);
  assert.equal(replayedResume.attempt, 2); assert.equal(sends, 1);
  const secondAttempt = await tracker.refresh(token, runtime);
  assert.equal(secondAttempt.status, "awaiting-review"); assert.equal(secondAttempt.results.length, 3); assert.equal(secondAttempt.attemptHistory.length, 2);
  assert.equal(secondAttempt.results[0].id, failedResult.id); assert.equal(secondAttempt.results[1].id, freshResult.id);
  const completed = await tracker.review({ token, commandKey: "m6-review-approve-001", expectedRevision: secondAttempt.revision, resultId: secondAttempt.result!.id, approved: true, note: "The corrected result and independent check satisfy the criterion.", criteriaReviews: [{ criterionId: "completion", satisfied: true, evidenceRefs: [{ kind: "check", id: check.id }], note: "" }] }, runtime);
  assert.equal(completed.status, "completed"); assert.equal(completed.decisions.length, 2); assert.equal(completed.decisions[0].approved, false); assert.equal(completed.decisions[1].approved, true);
  assert.equal(workspaceCreates, 1); assert.equal(agentCreates, 1); assert.equal(sends, 1);
  const comparison = await tracker.inspect(token, completed.result!.id, runtime);
  assert.equal(comparison.matches, true); assert.equal(collections, 3);
});
