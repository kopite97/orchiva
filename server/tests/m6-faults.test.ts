import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, rename as fsRename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { createRequest } from "../domain/request";
import type { Feature } from "../../shared/contracts/feature-request";

const feature: Feature = { title: "M6 fault fixture", goal: "Preserve atomic writes", scope: "One isolated JSON record", constraints: "No external effect", validation: "Parse the saved record", completionCriteria: "Old or new complete JSON survives." };

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-m6-fault-"));
  const store = new JsonRequestStore(directory); await store.open();
  t.after(async () => { await store.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); });
  const record = createRequest("m6-atomic-worker-001", feature); record.status = "draft"; await store.save(record); await store.close();
  return { directory, token: record.token, originalTitle: record.feature.title };
}

async function killAtOwnedBoundary(directory: string, token: string, boundary: "before-rename" | "after-rename") {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/m6/fault-worker.mjs", directory, token, boundary], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = ""; child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  const stage = await Promise.race([
    new Promise<string>((resolve, reject) => { child.once("message", message => resolve((message as { boundary: string }).boundary)); child.once("error", reject); child.once("exit", code => reject(new Error(`Worker exited before ${boundary} (${code}): ${stderr}`))); }),
    delay(10_000).then(() => { throw new Error(`Worker did not reach ${boundary}: ${stderr}`); }),
  ]);
  assert.equal(stage, boundary);
  child.kill();
  const exit = await Promise.race([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal }))),
    delay(5000).then(() => { throw new Error(`Owned fault worker did not exit after kill: ${stderr}`); }),
  ]);
  return { exit, stderr };
}

for (const boundary of ["before-rename", "after-rename"] as const) {
  test(`M6 owned writer termination at ${boundary} leaves a whole recoverable record`, async t => {
    const f = await fixture(t), target = join(f.directory, `${f.token}.json`), originalBytes = await readFile(target);
    const { exit, stderr } = await killAtOwnedBoundary(f.directory, f.token, boundary);
    assert.ok(exit.code !== 0 || exit.signal !== null, `Worker unexpectedly exited normally: ${stderr}`);
    const raw = await readFile(target, "utf8"), parsed = JSON.parse(raw);
    if (boundary === "before-rename") {
      assert.deepEqual(Buffer.from(raw), originalBytes); assert.equal(parsed.feature.title, f.originalTitle);
      const temps = (await readdir(f.directory)).filter(name => name.endsWith(".tmp")); assert.equal(temps.length, 1);
      assert.equal(JSON.parse(await readFile(join(f.directory, temps[0]), "utf8")).feature.title, "M6 before-rename");
    } else {
      assert.equal(parsed.feature.title, "M6 after-rename"); assert.equal((await readdir(f.directory)).filter(name => name.endsWith(".tmp")).length, 0);
    }
    const reopened = new JsonRequestStore(f.directory); await reopened.open();
    try { assert.equal((await reopened.get(f.token))!.feature.title, boundary === "before-rename" ? f.originalTitle : "M6 after-rename"); }
    finally { await reopened.close(); }
  });
}

test("M6 atomic store retries short EPERM/EBUSY rename locks without losing the request", async t => {
  const f = await fixture(t); let renameCalls = 0;
  const resilient = new JsonRequestStore(f.directory, { rename: async (source, target) => {
    renameCalls++;
    if (renameCalls <= 2) throw Object.assign(new Error("simulated Windows file lock"), { code: "EPERM" });
    await fsRename(source, target);
  } });
  await resilient.open();
  try {
    const record = await resilient.get(f.token); record!.feature.title = "M6 transient lock recovered";
    await resilient.save(record!);
    assert.equal(renameCalls, 3);
    assert.equal((await resilient.get(f.token))!.feature.title, "M6 transient lock recovered");
    assert.equal((await readdir(f.directory)).filter(name => name.endsWith(".tmp")).length, 0);
  } finally { await resilient.close(); }
});

test("M6 atomic store keeps old JSON and temp evidence after persistent EPERM", async t => {
  const f = await fixture(t), target = join(f.directory, `${f.token}.json`), original = await readFile(target); let renameCalls = 0;
  const locked = new JsonRequestStore(f.directory, { rename: async () => { renameCalls++; throw Object.assign(new Error("persistent Windows file lock"), { code: "EPERM" }); } });
  await locked.open();
  try {
    const record = await locked.get(f.token); record!.feature.title = "M6 rename still locked";
    await assert.rejects(locked.save(record!), error => (error as NodeJS.ErrnoException).code === "EPERM");
    assert.equal(renameCalls, 5);
    assert.deepEqual(await readFile(target), original);
    const temps = (await readdir(f.directory)).filter(name => name.endsWith(".tmp")); assert.equal(temps.length, 1);
    assert.equal(JSON.parse(await readFile(join(f.directory, temps[0]), "utf8")).feature.title, "M6 rename still locked");
  } finally { await locked.close(); }
});
