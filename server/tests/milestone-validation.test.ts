import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "../config/project-config";
import { immutable, digest } from "../adapters/storage/project-files";
import { collectFiles } from "../adapters/storage/evidence";
import { createRequest } from "../domain/request";
import { validateOutputs, validateSnapshot } from "../application/desktop/milestone-validation";
import type { InputSnapshot } from "../application/desktop/snapshots";
import type { Binding } from "../../shared/contracts/milestone-run";

test("both HUD implementations pass the same frozen test; changed validators, undeclared outputs and missing checks fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchiva-hud-check-"));
  await git(root, "init", "-b", "main");
  const fixture = [
    { path: "checks/hud.test.cjs", content: "require('node:assert/strict').equal(require('../hud.cjs'), 'SCORE 10');" },
    { path: ".gitignore", content: "ignored.txt\n" }
  ];
  for (const f of fixture) await immutable(root, f.path, f.content);
  await git(root, "add", "."); await git(root, "-c", "user.name=fixture", "-c", "user.email=test@test.invalid", "commit", "-m", "fixture");
  const snapshot: InputSnapshot = {
    version: 1, baseCommit: await git(root, "rev-parse", "HEAD"), projectRevision: 1, instructionFingerprint: "test", inputHash: "input", fingerprint: "baseline",
    files: fixture.map(f => ({ path: f.path, hash: digest(f.content), base64: Buffer.from(f.content).toString("base64") }))
  };
  const check = { path: fixture[0].path, hash: digest(fixture[0].content) };
  const bound: Binding = { scopeHash: digest("scope"), runId: "fixture-run", item: "A", milestone: "M", inputs: [], checks: [check], outputs: ["hud.cjs"], coordinator: false };
  validateSnapshot(bound, snapshot);
  assert.throws(() => validateSnapshot({ ...bound, checks: [{ ...check, hash: digest("new") }] }, snapshot), /INPUT_CHANGED/);
  const record = createRequest("fixture-node", { title: "HUD", goal: "HUD", scope: "HUD", constraints: "keep checks", validation: "Node", completionCriteria: "HUD" }, [{ id: "auto-1", kind: "node-test", path: check.path, label: "HUD" }]);
  record.worktreePath = root;
  for (const p of [record.requestPlan, record.taskPlan]) await immutable(root, ".orchiva/plans/" + p.id + ".md", p.content);
  await immutable(root, "docs/.orchiva/input-snapshot.json", JSON.stringify({ fingerprint: snapshot.fingerprint }));
  async function verify() {
    const result = await collectFiles({ ...record, checks: [] }, { status: "ended", agentStatus: "idle", sourceKey: "one", finalResponse: "", failure: null, seenRecovery: false });
    const { snapshotFiles } = await import("../adapters/storage/evidence");
    result.fingerprint = (await snapshotFiles(root, record.checks)).fingerprint;
    await validateOutputs(bound, snapshot, record, result);
    return result;
  }
  for (const implementation of ["module.exports='SCORE 10'", "module.exports=['SCORE',10].join(' ')"]) {
    await writeFile(join(root, "hud.cjs"), implementation); const result = await verify(); assert.equal(result.failure, null); assert.ok(result.checks[0].passed);
  }
  record.checks = []; await assert.rejects(verify(), /CHECK_MISSING/);
  record.checks = [{ id: "auto-1", kind: "node-test", path: check.path, label: "HUD" }];
  await writeFile(join(root, check.path), "throw Error('changed check')"); await assert.rejects(verify(), /SCOPE_VIOLATION/);
  await writeFile(join(root, check.path), fixture[0].content);
  await writeFile(join(root, "ignored.txt"), "outside permitted scope"); await assert.rejects(verify(), /SCOPE_VIOLATION/);
});
