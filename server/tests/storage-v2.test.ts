import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { createRequest } from "../domain/request";
import { legacyRecordSchema, type ExecutionResult } from "../../shared/contracts/feature-request";
import { StartFeatureRequest } from "../application/start-feature-request";
import { assertSlot } from "../application/execution-slot";
import { prepare, project, commit } from "./helpers/prepared";

const feature = { title: "Storage", goal: "Preserve", scope: "One task", constraints: "Sandbox", validation: "Tests", completionCriteria: "History retained" };
const result = (id: string): ExecutionResult => ({ id, sourceKey: "e:1", collectedAt: "2026-11-12", finalResponse: "Done", agentStatus: "idle", changedFiles: [], diffStat: "", fingerprint: "hash", checks: [], failure: null, executionFailure: null });
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-m1-"));
  const stores: JsonRequestStore[] = [];
  const store = (hooks = {}) => { const value = new JsonRequestStore(directory, hooks); stores.push(value); return value; };
  t.after(async () => { for (const value of stores) await value.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, store };
}
test("v1 migration preserves byte backup, identifiers, failed history and legacy decision; rereads are pure", async t => {
  const f = await fixture(t), record = createRequest("storage-legacy-001", feature);
  record.status = "completed"; record.agentId = "original-agent"; record.workspaceId = "original-workspace";
  record.attempt = 2; record.result = result("result-2"); record.attempts = [{ attempt: 1, result: { ...result("result-1"), failure: "Original failure" }, error: "Original failure" }];
  record.decision = { resultId: "result-2", approved: true, note: "Original review", at: "2026-11-12" };
  const raw = JSON.stringify(legacyRecordSchema.parse(record), null, 3) + "\n";
  const path = join(f.directory, `${record.token}.json`); await writeFile(path, raw);
  const store = f.store(), migrated = (await store.get(record.token))!;
  assert.deepEqual(legacyRecordSchema.parse(migrated), legacyRecordSchema.parse(record));
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.confirmationSource, "legacy-execution");
  assert.equal(migrated.results.length, 2); assert.equal(migrated.decisions[0].legacy, true);
  assert.equal(migrated.criteria[0].text, feature.completionCriteria);
  const backups = await readdir(join(f.directory, "backups/v1")); assert.equal(backups.length, 1);
  assert.equal(await readFile(join(f.directory, "backups/v1", backups[0]), "utf8"), raw);
  assert.equal(migrated.migration!.sourceSha256, createHash("sha256").update(raw).digest("hex"));
  const bytes = await readFile(path); await store.list(); await store.get(record.token); assert.deepEqual(await readFile(path), bytes);
});

for (const boundary of ["afterBackup", "beforeRename"] as const) test(`migration interrupted ${boundary} retains original and resumes from the same backup`, async t => {
  const f = await fixture(t), record = createRequest(`migration-${boundary}-001`, feature);
  const raw = JSON.stringify(legacyRecordSchema.parse(record)); const path = join(f.directory, `${record.token}.json`); await writeFile(path, raw);
  const broken = f.store({ [boundary]: async () => { throw Error("Injected stop"); } });
  await assert.rejects(broken.get(record.token), /Injected stop/); assert.equal(await readFile(path, "utf8"), raw);
  await broken.close();
  const resumed = f.store(); assert.equal((await resumed.get(record.token))!.schemaVersion, 2);
  assert.equal((await resumed.list()).length, 1); assert.equal((await readdir(join(f.directory, "backups/v1"))).length, 1);
});

test("corrupt, future and mismatched records are isolated, untouched and block new effects", async t => {
  const f = await fixture(t), store = f.store(), record = createRequest("valid-record-001", feature); record.status = "completed"; await store.save(record);
  const bad = { "future-record-001.json": '{"schemaVersion":99}', "corrupt-record-001.json": '{broken', "wrong-token-001.json": JSON.stringify({ ...record, token: "different-token-001" }) };
  for (const [name, body] of Object.entries(bad)) await writeFile(join(f.directory, name), body);
  await writeFile(join(f.directory, "ignored.json.tmp"), "partial");
  assert.equal((await store.list()).length, 1);
  const diagnostics = await store.diagnostics(); assert.equal(diagnostics.issues.length, 3); assert.ok(diagnostics.issues.some(x => x.code === "UNSUPPORTED_VERSION"));
  await assert.rejects(assertSlot(store, "new-record-001"), /STORAGE_UNHEALTHY/);
  for (const [name, body] of Object.entries(bad)) assert.equal(await readFile(join(f.directory, name), "utf8"), body);
  await assert.rejects(store.get("../../outside"));
});

test("revision conflicts and immutable history prevent stale overwrites and evidence erasure", async t => {
  const f = await fixture(t), store = f.store(), record = createRequest("revision-test-001", feature);
  record.result = result("r1"); record.status = "awaiting-review"; await store.save(record);
  const stale = (await store.get(record.token))!;
  record.result = result("r2"); await store.save(record); assert.equal(record.results.length, 2);
  stale.status = "failed"; await assert.rejects(store.save(stale), /REVISION_CONFLICT/);
  const revision = record.revision; record.observationError = "offline"; await store.save(record); assert.equal(record.revision, revision);
  const mutate = (await store.get(record.token))!; mutate.results[0].finalResponse = "fake";
  await assert.rejects(store.save(mutate), /IMMUTABLE_HISTORY/);
  const erase = (await store.get(record.token))!; erase.results = erase.results.filter(x => x.id !== "r1");
  await assert.rejects(store.save(erase), /IMMUTABLE_HISTORY/);
  await store.close(); const reloaded = f.store(); assert.equal((await reloaded.get(record.token))!.results.length, 2);
});

test("different request starts share the project lock even through different use case instances", async t => {
  const f = await fixture(t), store = f.store(); let workspaces = 0, agents = 0;
  const runtime = { preflight: async () => ({ baseCommit: commit, projectSnapshot: project }), validate: async () => {}, createWorkspace: async () => { workspaces++; return { id: "w", directory: "sandbox" }; }, writePlans: async () => {}, startAgent: async () => { agents++; return "a"; } };
  const first = await prepare(store, runtime, "concurrent-first-001", feature), second = await prepare(store, runtime, "concurrent-second-001", feature);
  const results = await Promise.allSettled([new StartFeatureRequest(store).start(first, runtime), new StartFeatureRequest(store).start(second, runtime)]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1); assert.equal(workspaces, 1); assert.equal(agents, 1);
  const rejected = results.find(x => x.status === "rejected") as PromiseRejectedResult; assert.match(String(rejected.reason), /BUSY/);
  await store.close(); const reloaded = f.store(); await assert.rejects(assertSlot(reloaded, "new-request-001"), /BUSY/);
});

test("unknown commands keep a stopped task's slot and known final states release it", async t => {
  const f = await fixture(t), store = f.store(), record = createRequest("unknown-slot-001", feature);
  record.status = "failed"; record.commands.push({ key: "key", kind: "start", payloadHash: "h", status: "unknown", phase: "agent", messageId: null, resourceIds: {}, outcomeRef: null, createdAt: "now", resolvedAt: null }); await store.save(record);
  await assert.rejects(assertSlot(store, "another-request-001"), /BUSY/);
  record.commands[0].status = "failed"; await store.save(record); await assertSlot(store, "another-request-001");
});
