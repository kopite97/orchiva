import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { StartFeatureRequest } from "../application/start-feature-request";
import { TrackExecution } from "../application/track-execution";
import { Reconciler } from "../application/reconcile";
import { prepare, project, commit } from "./helpers/prepared";
import { createRequest } from "../domain/request";
import { requestPage, allowedActions } from "../domain/request-view";
import type { LifecycleRuntime, Observation } from "../application/ports";
import { beginCommand } from "../application/execution-slot";

const feature = { title: "M3", goal: "Observe", scope: "One file", constraints: "Sandbox", validation: "Proof", completionCriteria: "File exists" };
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-m3-")), store = new JsonRequestStore(directory);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const starter = new StartFeatureRequest(store), tracker = new TrackExecution(store, starter.locks);
  const counts = { workspaces: 0, agents: 0, collected: 0, observed: 0, closed: 0 };
  const runtime = {
    projectSnapshot: project, validate: async () => {}, preflight: async () => ({ baseCommit: commit, projectSnapshot: project }),
    createWorkspace: async () => { counts.workspaces++; return { id: "workspace", directory: "worktree" }; }, writePlans: async () => {}, startAgent: async () => { counts.agents++; return "agent"; },
    observe: async (): Promise<Observation> => { counts.observed++; return { status: "ended", agentStatus: "idle", sourceKey: "turn-1", finalResponse: "Done", failure: null, seenRecovery: false }; },
    collect: async (_: unknown, observed: Observation) => { counts.collected++; return { id: `result-${counts.collected}`, sourceKey: observed.sourceKey, collectedAt: new Date().toISOString(), finalResponse: "Done", agentStatus: "idle", changedFiles: ["proof.md"], diffStat: "", fingerprint: "hash", checks: [], failure: observed.failure, executionFailure: observed.failure }; },
    fingerprint: async () => "hash", resume: async () => {},
  };
  const input = await prepare(store, runtime, "m3-request-001", feature);
  const lease = () => ({ runtime: async () => runtime, ping: async () => {}, close: async () => { counts.closed++; } });
  return { directory, store, starter, tracker, runtime, counts, input, lease };
}
test("accepted start returns before effects; a new worker restores the saved plan exactly once", async t => {
  const f = await fixture(t), accepted = await f.starter.accept(f.input, f.runtime);
  assert.equal(accepted.status, "planned"); assert.equal(f.counts.agents, 0); assert.equal(f.counts.workspaces, 0);
  const restarted = new StartFeatureRequest(f.store);
  await Promise.all([restarted.advance(f.input.token, f.runtime), restarted.advance(f.input.token, f.runtime)]);
  assert.equal(f.counts.workspaces, 1); assert.equal(f.counts.agents, 1);
  const replay = await restarted.accept(f.input, f.runtime, () => { throw Error("restoring"); }); assert.equal(replay.agentId, "agent");
});
for (const phase of ["workspace", "agent"]) test(`restart in uncertain ${phase} phase holds the original slot without sending`, async t => {
  const f = await fixture(t), record = await f.starter.accept(f.input, f.runtime);
  record.commands.at(-1)!.phase = phase; record.status = phase === "agent" ? "starting-session" : "creating-worktree";
  await f.store.save(record); const restored = await new StartFeatureRequest(f.store).advance(record.token, f.runtime);
  assert.equal(restored.status, "needs-input"); assert.equal(restored.commands.at(-1)!.status, "unknown");
  assert.deepEqual((await f.store.diagnostics()).activeTokens, [record.token]); assert.equal(f.counts.agents + f.counts.workspaces, 0);
});
test("known workspace and pending PLAN writes resume without recreating a workspace", async t => {
  const f = await fixture(t), record = await f.starter.accept(f.input, f.runtime);
  record.workspaceId = "workspace"; record.worktreePath = "worktree"; record.commands.at(-1)!.phase = "plans"; record.status = "writing-plan";
  await f.store.save(record); await f.starter.advance(record.token, f.runtime);
  assert.equal(f.counts.workspaces, 0); assert.equal(f.counts.agents, 1);
});
test("loop restores and collects without hooks; duplicate hooks do not rerun checks", async t => {
  const f = await fixture(t); await f.starter.accept(f.input, f.runtime);
  const loop = new Reconciler(f.store, f.starter, f.tracker, f.lease, { intervalMs: 60000 }); t.after(() => loop.stop());
  assert.throws(() => loop.assertReady(), /ENVIRONMENT/); loop.start(); await loop.settle(); loop.assertReady();
  assert.equal((await f.store.get(f.input.token))!.status, "awaiting-review");
  loop.hint("agent", { kind: "completed" }); loop.hint("agent", { kind: "completed" }); await loop.settle();
  assert.equal(f.counts.collected, 1); assert.equal(f.counts.agents, 1);
  await loop.stop(); const observations = f.counts.observed; loop.wake(); loop.hint("agent"); await loop.settle(); assert.equal(f.counts.observed, observations); assert.equal(f.counts.closed, 1);
});
test("connection backoff replaces one lease and recovers without overlapping cycles", async t => {
  const f = await fixture(t); let now = Date.now(), connects = 0, fail = true;
  const loop = new Reconciler(f.store, f.starter, f.tracker, () => { connects++; return { ...f.lease(), ping: async () => { if (fail) throw Error("offline"); } }; }, { now: () => now, intervalMs: 60000 }); t.after(() => loop.stop());
  loop.start(); loop.wake(); await loop.settle(); assert.equal(connects, 1); assert.equal(loop.snapshot().state, "reconnecting");
  assert.equal(Date.parse(loop.snapshot().nextAttemptAt!) - now, 5000); loop.wake(); await loop.settle(); assert.equal(connects, 1);
  now += 5000; loop.wake(); await loop.settle(); assert.equal(connects, 2); assert.equal(Date.parse(loop.snapshot().nextAttemptAt!) - now, 10000);
  fail = false; now += 10000; loop.wake(); await loop.settle(); assert.equal(connects, 3); assert.equal(loop.snapshot().state, "connected"); assert.equal(f.counts.closed, 2);
});
test("dispose during connection closes the lease and never starts observation", async t => {
  const f = await fixture(t); await f.starter.accept(f.input, f.runtime);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const loop = new Reconciler(f.store, f.starter, f.tracker, () => ({ runtime: async () => { await gate; return f.runtime; }, ping: async () => {}, close: async () => { f.counts.closed++; release(); } }));
  loop.start(); await Promise.all([loop.stop(), loop.stop()]); assert.equal(f.counts.closed, 1); assert.equal(f.counts.observed, 0); assert.equal(f.counts.agents, 0);
});
test("observation errors during interrupted validation preserve state, result and revision", async t => {
  const f = await fixture(t), record = await f.starter.start(f.input, f.runtime);
  record.status = "validating"; await f.store.save(record); const revision = record.revision, updatedAt = record.updatedAt;
  const offline: LifecycleRuntime = { ...f.runtime, observe: async () => { throw Error("transport unavailable"); } };
  const failedObservation = await f.tracker.refresh(record.token, offline);
  assert.equal(failedObservation.status, "validating"); assert.equal(failedObservation.revision, revision); assert.equal(failedObservation.updatedAt, updatedAt);
  assert.equal(failedObservation.observation?.consecutiveFailures, 1); assert.equal(f.counts.collected, 0);
  const restored = await f.tracker.refresh(record.token, f.runtime); assert.equal(restored.status, "awaiting-review"); assert.equal(f.counts.collected, 1);
});
test("observation backoff skips an offline request and completed records remain byte-identical", async t => {
  const f = await fixture(t); await f.starter.start(f.input, f.runtime);
  await f.tracker.refresh(f.input.token, { ...f.runtime, observe: async () => { throw Error("offline"); } });
  const terminal = createRequest("m3-completed-001", feature); terminal.status = "completed"; terminal.agentId = "old-agent"; await f.store.save(terminal);
  const bytes = await readFile(join(f.directory, `${terminal.token}.json`));
  const loop = new Reconciler(f.store, f.starter, f.tracker, f.lease, { intervalMs: 60000 }); t.after(() => loop.stop()); loop.start(); await loop.settle();
  assert.equal(f.counts.observed, 0); assert.deepEqual(await readFile(join(f.directory, `${terminal.token}.json`)), bytes);
});
test("summary pages filter and paginate with stable ties and omit plans, evidence and logs", () => {
  const records = Array.from({ length: 45 }, (_, n) => { const r = createRequest(`m3-page-${String(n).padStart(3, "0")}`, feature); r.updatedAt = "2026-11-12T00:00:00.000Z"; r.status = n < 2 ? "running" : n < 5 ? "draft" : "completed"; return r; });
  const first = requestPage(records, {}), second = requestPage(records, { cursor: first.nextCursor }), third = requestPage(records, { cursor: second.nextCursor });
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [20, 20, 5]); assert.equal(new Set([...first.items, ...second.items, ...third.items].map(x => x.token)).size, 45);
  assert.equal(first.active.length, 2); assert.equal(requestPage(records, { filter: "draft" }).total, 3); assert.equal(requestPage(records, { filter: "completed" }).total, 40);
  assert.ok(!("requestPlan" in first.items[0])); assert.ok(!("result" in first.items[0])); assert.throws(() => requestPage(records, { cursor: "bad" }), /INVALID_CURSOR/);
  assert.deepEqual(allowedActions(records[3]), ["edit"]);
});
test("interrupted revalidation survives observation failure then resolves its original command", async t => {
  const f = await fixture(t); await f.starter.start(f.input, f.runtime);
  const first = await f.tracker.refresh(f.input.token, f.runtime), originalId = first.result!.id;
  beginCommand(first, "m3-revalidate-interrupted", "revalidate", { resultId: originalId }); await f.store.save(first);
  const offline = await f.tracker.refresh(first.token, { ...f.runtime, observe: async () => { throw Error("offline"); } });
  assert.equal(offline.commands.at(-1)!.status, "pending"); assert.equal(offline.result!.id, originalId);
  const restored = await f.tracker.refresh(first.token, f.runtime);
  assert.equal(restored.commands.at(-1)!.status, "applied"); assert.notEqual(restored.result!.id, originalId); assert.equal(restored.results.length, 2);
  assert.equal(restored.commands.at(-1)!.outcomeRef, restored.result!.id); assert.equal(restored.attempt, 1);
});
test("wakes during an in-flight observation never overlap and preserve a late turn outcome", async t => {
  const f = await fixture(t); await f.starter.start(f.input, f.runtime);
  let release!: () => void, entered!: () => void, active = 0, peak = 0;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const observe = f.runtime.observe;
  f.runtime.observe = async () => { active++; peak = Math.max(peak, active); entered(); await gate; active--; return observe(); };
  const loop = new Reconciler(f.store, f.starter, f.tracker, f.lease, { intervalMs: 60000 }); t.after(() => loop.stop());
  loop.start(); await started; loop.hint("agent", { kind: "canceled", reason: "User stopped the turn" }); loop.wake();
  assert.equal(peak, 1); release(); await loop.settle(); loop.wake(); await loop.settle();
  assert.equal(peak, 1); const final = (await f.store.get(f.input.token))!; assert.equal(final.status, "failed"); assert.match(final.result!.failure!, /User stopped/);
  assert.equal(final.results.length, 2); // Late authoritative cancellation preserves the prior collected version.
});
test("a close failure still drains the cycle and leaves the coordinator terminal", async t => {
  const f = await fixture(t);
  const loop = new Reconciler(f.store, f.starter, f.tracker, () => ({ ...f.lease(), close: async () => { f.counts.closed++; throw Error("close failed"); } }), { intervalMs: 60000 });
  loop.start(); await loop.settle(); await assert.rejects(loop.stop(), /close failed/);
  assert.equal(loop.snapshot().state, "stopped"); loop.wake(); await loop.settle(); assert.equal(f.counts.closed, 1);
});
