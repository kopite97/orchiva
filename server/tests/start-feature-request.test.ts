import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StartFeatureRequest } from "../application/start-feature-request";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import type { Runtime } from "../application/ports";
import { featureSchema } from "../../shared/contracts/feature-request";

const input = { token: "test-request-001", feature: { title: "Smoke", goal: "Write proof", scope: "One file", constraints: "No production access", validation: "Read file", completionCriteria: "Proof exists" } };
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonRequestStore(directory);
  const calls: string[] = [];
  const runtime: Runtime = {
    async validate() { calls.push("validate"); },
    async createWorkspace() { calls.push("workspace"); return { id: "ws-1", directory: "test-worktree" }; },
    async writePlans() { calls.push("plans"); },
    async startAgent() { calls.push("agent"); return "agent-1"; },
  };
  return { store, calls, runtime, app: new StartFeatureRequest(store) };
}
test("simultaneous duplicate requests create one worktree and agent, surviving reload", async t => {
  const { app, store, runtime, calls } = await fixture(t);
  const results = await Promise.all([app.start(input, runtime), app.start(input, runtime)]);
  assert.equal(results[0].status, "started");
  assert.equal(results[0].agentId, results[1].agentId);
  assert.deepEqual(calls, ["validate", "workspace", "plans", "agent"]);
  await new StartFeatureRequest(store).start(input, runtime);
  assert.equal(calls.length, 4);
});
test("failed agent creation retains worktree and retries with the original request identity", async t => {
  const { app, store, runtime, calls } = await fixture(t);
  let first = true;
  runtime.startAgent = async record => { calls.push(`agent:${record.token}`); if (first) { first = false; throw new Error("response lost"); } return "agent-1"; };
  const failed = await app.start(input, runtime);
  assert.equal(failed.status, "failed");
  assert.equal(failed.workspaceId, "ws-1");
  const recovered = await new StartFeatureRequest(store).start(input, runtime);
  assert.equal(recovered.status, "started");
  assert.equal(calls.filter(x => x === "workspace").length, 1);
  assert.equal(calls.filter(x => x === `agent:${input.token}`).length, 2);
});
test("same token with changed input is rejected, including concurrent requests", async t => {
  const { app, runtime } = await fixture(t);
  const first = app.start(input, runtime);
  await assert.rejects(app.start({ ...input, feature: { ...input.feature, goal: "Changed" } }, runtime), /different input/);
  await first;
});
test("validation prevents side effects and malformed tokens cannot escape the data directory", async t => {
  const { app, runtime, store, calls } = await fixture(t);
  runtime.validate = async () => { throw new Error("wrong repository"); };
  await assert.rejects(app.start(input, runtime), /wrong repository/);
  assert.equal((await store.list()).length, 0);
  assert.deepEqual(calls, []);
  await assert.rejects(store.get("../../escape"));
  assert.equal(featureSchema.safeParse({ ...input.feature, goal: "   " }).success, false);
});
