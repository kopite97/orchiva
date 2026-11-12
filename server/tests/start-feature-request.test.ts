import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StartFeatureRequest } from "../application/start-feature-request";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import type { Runtime } from "../application/ports";
import { featureSchema } from "../../shared/contracts/feature-request";
import { prepare, project, commit } from "./helpers/prepared";

const input = { token: "test-request-001", feature: { title: "Smoke", goal: "Write proof", scope: "One file", constraints: "No production access", validation: "Read file", completionCriteria: "Proof exists" } };
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-test-"));
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const store = new JsonRequestStore(directory);
  const calls: string[] = [];
  const runtime: Runtime = {
    async preflight() { await runtime.validate(); return { baseCommit: commit, projectSnapshot: project }; },
    async validate() { calls.push("validate"); },
    async createWorkspace() { calls.push("workspace"); return { id: "ws-1", directory: "test-worktree" }; },
    async writePlans() { calls.push("plans"); },
    async startAgent() { calls.push("agent"); return "agent-1"; },
  };
  const confirmed = await prepare(store, runtime, input.token, input.feature); calls.length = 0;
  return { store, calls, runtime, confirmed, app: new StartFeatureRequest(store) };
}
test("simultaneous duplicate requests create one worktree and agent, surviving reload", async t => {
  const { app, store, runtime, calls, confirmed } = await fixture(t);
  const results = await Promise.all([app.start(confirmed, runtime), app.start(confirmed, runtime)]);
  assert.equal(results[0].status, "started");
  assert.equal(results[0].agentId, results[1].agentId);
  assert.deepEqual(calls, ["validate", "workspace", "plans", "agent"]);
  await new StartFeatureRequest(store).start(confirmed, runtime);
  assert.equal(calls.length, 4);
});
test("lost agent creation response retains worktree and holds the original intent without replay", async t => {
  const { app, store, runtime, calls, confirmed } = await fixture(t);
  let first = true;
  runtime.startAgent = async record => { calls.push(`agent:${record.token}`); if (first) { first = false; throw new Error("response lost"); } return "agent-1"; };
  const failed = await app.start(confirmed, runtime);
  assert.equal(failed.status, "needs-input");
  assert.equal(failed.commands.find(x => x.kind === "start")!.status, "unknown");
  assert.equal(failed.workspaceId, "ws-1");
  const recovered = await new StartFeatureRequest(store).start(confirmed, runtime);
  assert.equal(recovered.status, "needs-input");
  assert.equal(calls.filter(x => x === "workspace").length, 1);
  assert.equal(calls.filter(x => x === `agent:${input.token}`).length, 1);
});
test("same token with changed input is rejected, including concurrent requests", async t => {
  const { app, runtime, confirmed } = await fixture(t);
  const first = app.start(confirmed, runtime);
  await assert.rejects(app.start({ ...confirmed, inputHash: "b".repeat(64) }, runtime), /different input/);
  await first;
});
test("validation prevents side effects and malformed tokens cannot escape the data directory", async t => {
  const { app, runtime, store, calls, confirmed } = await fixture(t);
  runtime.validate = async () => { throw new Error("wrong repository"); };
  await assert.rejects(app.start(confirmed, runtime), /wrong repository/);
  assert.equal((await store.list())[0].status, "ready");
  assert.deepEqual(calls, []);
  await assert.rejects(store.get("../../escape"));
  assert.equal(featureSchema.safeParse({ ...input.feature, goal: "   " }).success, false);
});
