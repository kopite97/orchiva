import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { maintainDeployment, deploymentDataFormat } from "../adapters/storage/deployment-maintenance";
import { digest } from "../adapters/storage/project-files";
import { DirectoryOwner } from "../adapters/storage/directory-owner";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orchiva-update-")), profile = join(root, "profile"), target = join(root, "new"), old = join(root, "old");
  for (const p of [join(profile, "data", "requests"), join(profile, "paseo"), target, old]) await mkdir(p, { recursive: true });
  const server = createServer(); await new Promise<void>(ok => server.listen(0, "127.0.0.1", ok)); const port = (server.address() as { port: number }).port; await new Promise<void>(ok => server.close(() => ok()));
  const options = { NodePath: join(old, "runtime", "node.exe"), SourceRoot: join(old, "runtime", "plugin"), DataHome: join(profile, "data"), PaseoHome: join(profile, "paseo"), Endpoint: `127.0.0.1:${port}`, IsolationRoot: profile, PaseoCliPath: join(old, "runtime", "paseo", "node_modules", "@getpaseo", "cli", "bin", "paseo") };
  const original = JSON.stringify({ SchemaVersion: 1, InstallRoot: old, Options: options });
  const manifest = JSON.stringify({ schemaVersion: 1, profileVersion: 1, platform: "win-x64", dataFormat: deploymentDataFormat });
  await writeFile(join(profile, "profile.json"), original); await writeFile(join(target, "orchiva-package.json"), manifest);
  await writeFile(join(profile, "paseo", "config.json"), JSON.stringify({ version: 1, daemon: { listen: options.Endpoint }, plugins: { "orchiva-plugin": { source: "directory", path: options.SourceRoot } }, preserved: "custom-setting" }));
  const input = { mode: "switch" as const, profileRoot: profile, target, expectedProfileHash: digest(original), expectedPackageHash: digest(manifest) };
  return { root, profile, target, input, port, original };
}
test("update interrupted between config and profile recovers forward, keeping original settings and journal", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(maintainDeployment(f.input, async () => {}, async phase => { if (phase === "config") throw new Error("injected-crash"); }), /injected-crash/);
  assert.equal(await readFile(join(f.profile, "profile.json"), "utf8"), f.original);
  await assert.rejects(maintainDeployment(f.input, async () => {}), /UPDATE_RECOVERY_REQUIRED/);
  const result = await maintainDeployment({ ...f.input, mode: "recover" }, async () => {});
  assert.equal(result.recovered, true);
  assert.equal(JSON.parse(await readFile(join(f.profile, "profile.json"), "utf8")).InstallRoot, f.target);
  assert.equal(JSON.parse(await readFile(join(f.profile, "paseo", "config.json"), "utf8")).preserved, "custom-setting");
  const journal = JSON.parse(await readFile(join(f.profile, "updates", `${result.id}.json`), "utf8")); assert.equal(journal.beforeProfile, f.original);
});
test("update refuses live port, app owner, changed profile/package and invalid data without rewriting", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const busy = createServer(); await new Promise<void>(ok => busy.listen(f.port, "127.0.0.1", ok));
  await assert.rejects(maintainDeployment(f.input, async () => {}), /UPDATE_RUNTIME_RUNNING/); await new Promise<void>(ok => busy.close(() => ok()));
  const owner = new DirectoryOwner(f.profile); await owner.open(); await assert.rejects(maintainDeployment(f.input, async () => {}), /STORE_OWNED/); await owner.close();
  await assert.rejects(maintainDeployment({ ...f.input, expectedProfileHash: "0".repeat(64) }, async () => {}), /UPDATE_PROFILE_CHANGED/);
  await assert.rejects(maintainDeployment({ ...f.input, expectedPackageHash: "0".repeat(64) }, async () => {}), /UPDATE_PACKAGE_CHANGED/);
  await writeFile(join(f.profile, "data", "requests", "corrupt.json"), "{}");
  await assert.rejects(maintainDeployment(f.input, async () => {})); assert.equal(await readFile(join(f.profile, "profile.json"), "utf8"), f.original);
});
test("recovery rejects externally edited config and tampered journal", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(maintainDeployment(f.input, async () => {}, async phase => { if (phase === "intent") throw new Error("stop"); }), /stop/);
  const pending = join(f.profile, "update-pending.json"), original = await readFile(pending, "utf8"), journal = JSON.parse(original);
  const changed = JSON.parse(journal.afterConfig); changed.unrequested = true; journal.afterConfig = JSON.stringify(changed); await writeFile(pending, JSON.stringify(journal));
  await assert.rejects(maintainDeployment({ ...f.input, mode: "recover" }, async () => {}), /UPDATE_JOURNAL_INVALID/);
  await writeFile(pending, original); await writeFile(join(f.profile, "paseo", "config.json"), "{}");
  await assert.rejects(maintainDeployment({ ...f.input, mode: "recover" }, async () => {}), /UPDATE_CONFIG_CONFLICT/);
  assert.equal(await readFile(join(f.profile, "paseo", "config.json"), "utf8"), "{}");
});

test("update rejects a linked journal archive before changing either configuration", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const config = await readFile(join(f.profile, "paseo", "config.json"), "utf8");
  await symlink(f.target, join(f.profile, "updates"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(maintainDeployment(f.input, async () => {}), /UPDATE_LINK_REJECTED/);
  assert.equal(await readFile(join(f.profile, "profile.json"), "utf8"), f.original);
  assert.equal(await readFile(join(f.profile, "paseo", "config.json"), "utf8"), config);
  await assert.rejects(readFile(join(f.profile, "update-pending.json")), { code: "ENOENT" });
});
