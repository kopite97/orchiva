import { readFile, readdir, realpath, mkdir, rename, lstat } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DirectoryOwner } from "./directory-owner";
import { atomic, digest, absent } from "./project-files";
import { Projects } from "../../application/desktop/projects";
import { ProductionStore } from "./production-store";
import { ConversationStore } from "./conversation-store";
import { recordSchema } from "../../../shared/contracts/feature-request";
import { occupiesSlot, validateReferences } from "../../domain/record-v2";
import { activeConversationTurn } from "../../domain/conversation";

export const deploymentDataFormat = "orchiva-v2-v3-conversation-v1-media-v1";
const optionsSchema = z.object({ NodePath: z.string(), SourceRoot: z.string(), DataHome: z.string(), PaseoHome: z.string(), Endpoint: z.string().regex(/^127\.0\.0\.1:\d{4,5}$/), IsolationRoot: z.string(), PaseoCliPath: z.string() }).strict();
const profileSchema = z.object({ SchemaVersion: z.literal(1), InstallRoot: z.string(), Options: optionsSchema }).strict();
const journalSchema = z.object({ version: z.literal(1), id: z.string().uuid(), target: z.string(), packageHash: z.string().regex(/^[a-f0-9]{64}$/), beforeProfile: z.string(), afterProfile: z.string(), beforeConfig: z.string(), afterConfig: z.string(), createdAt: z.string() }).strict();
const same = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
async function bounded(path: string) { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("UPDATE_LINK_REJECTED"); if (stat.size > 2 * 1024 * 1024) throw new Error("UPDATE_FILE_TOO_LARGE"); return readFile(path, "utf8"); }
async function canonical(path: string) { const actual = await realpath(path); if (!same(actual, path) || (await lstat(path)).isSymbolicLink()) throw new Error("UPDATE_LINK_REJECTED"); return actual; }
function validateProfile(root: string, text: string) {
  const p = profileSchema.parse(JSON.parse(text)), o = p.Options;
  if (!same(root, o.IsolationRoot) || !same(o.DataHome, join(root, "data")) || !same(o.PaseoHome, join(root, "paseo")) ||
      !same(o.SourceRoot, join(p.InstallRoot, "runtime", "plugin")) || !same(o.NodePath, join(p.InstallRoot, "runtime", "node.exe")) ||
      !same(o.PaseoCliPath, join(p.InstallRoot, "runtime", "paseo", "node_modules", "@getpaseo", "cli", "bin", "paseo"))) throw new Error("UPDATE_PROFILE_PATH_CHANGED");
  const port = Number(o.Endpoint.split(":")[1]); if (port < 1024 || port > 65535 || port === 6767) throw new Error("UPDATE_ENDPOINT_INVALID");
  return p;
}
type VerifyPackage = (directory: string) => Promise<unknown>;

/** Offline, explicit switch. Stores keep ownership for the entire transaction. */
export async function maintainDeployment(input: { mode: "switch" | "recover"; profileRoot: string; target: string; expectedProfileHash?: string; expectedPackageHash: string }, verify: VerifyPackage, fault?: (phase: string) => Promise<void>) {
  const root = await canonical(input.profileRoot), target = await canonical(input.target);
  const profileFile = join(root, "profile.json"), pendingFile = join(root, "update-pending.json");
  const manifestText = await readFile(join(target, "orchiva-package.json"), "utf8"), manifest = JSON.parse(manifestText);
  if (digest(manifestText) !== input.expectedPackageHash) throw new Error("UPDATE_PACKAGE_CHANGED");
  if (manifest.schemaVersion !== 1 || manifest.profileVersion !== 1 || manifest.dataFormat !== deploymentDataFormat || manifest.platform !== "win-x64") throw new Error("UPDATE_FORMAT_UNSUPPORTED");
  await verify(target);
  const owners: DirectoryOwner[] = []; const projects = new Projects(join(root, "data", "desktop"));
  const portGuard = createServer(socket => socket.destroy()); let listening = false;
  const own = async (directory: string) => { const owner = new DirectoryOwner(directory); owners.push(owner); await owner.open(); };
  try {
    await own(root); // Same OS endpoint as the desktop's ProfileUseLease.
    const currentProfile = await bounded(profileFile);
    let journal: z.infer<typeof journalSchema>;
    if (input.mode === "recover") {
      journal = journalSchema.parse(JSON.parse(await bounded(pendingFile)));
      if (!same(journal.target, target) || journal.packageHash !== input.expectedPackageHash) throw new Error("UPDATE_RECOVERY_TARGET_CHANGED");
    } else {
      try { await lstat(pendingFile); throw new Error("UPDATE_RECOVERY_REQUIRED"); } catch (error) { if (!absent(error)) throw error; }
      if (digest(currentProfile) !== input.expectedProfileHash) throw new Error("UPDATE_PROFILE_CHANGED");
      const before = validateProfile(root, currentProfile);
      await canonical(before.Options.DataHome); await canonical(before.Options.PaseoHome);
      const config = await bounded(join(root, "paseo", "config.json")), parsed = JSON.parse(config);
      if (parsed.daemon?.listen !== before.Options.Endpoint || !same(parsed.plugins?.["orchiva-plugin"]?.path ?? "", before.Options.SourceRoot)) throw new Error("UPDATE_CONFIG_CHANGED");
      const after = structuredClone(before); after.InstallRoot = target;
      after.Options.NodePath = join(target, "runtime", "node.exe"); after.Options.SourceRoot = join(target, "runtime", "plugin");
      after.Options.PaseoCliPath = join(target, "runtime", "paseo", "node_modules", "@getpaseo", "cli", "bin", "paseo");
      parsed.plugins["orchiva-plugin"].path = after.Options.SourceRoot;
      journal = { version: 1, id: randomUUID(), target, packageHash: input.expectedPackageHash, beforeProfile: currentProfile, afterProfile: JSON.stringify(after, null, 2), beforeConfig: config, afterConfig: JSON.stringify(parsed, null, 2), createdAt: new Date().toISOString() };
    }
    const before = validateProfile(root, journal.beforeProfile), after = validateProfile(root, journal.afterProfile);
    const expectedProfile = structuredClone(before); expectedProfile.InstallRoot = target;
    Object.assign(expectedProfile.Options, { NodePath: join(target, "runtime", "node.exe"), SourceRoot: join(target, "runtime", "plugin"), PaseoCliPath: join(target, "runtime", "paseo", "node_modules", "@getpaseo", "cli", "bin", "paseo") });
    const expectedConfig = JSON.parse(journal.beforeConfig);
    if (expectedConfig.daemon?.listen !== before.Options.Endpoint || !same(expectedConfig.plugins?.["orchiva-plugin"]?.path ?? "", before.Options.SourceRoot)) throw new Error("UPDATE_JOURNAL_INVALID");
    expectedConfig.plugins["orchiva-plugin"].path = expectedProfile.Options.SourceRoot;
    if (JSON.stringify(expectedProfile) !== JSON.stringify(after) || JSON.stringify(expectedConfig) !== JSON.stringify(JSON.parse(journal.afterConfig))) throw new Error("UPDATE_JOURNAL_INVALID");
    if (!same(after.InstallRoot, target) || before.Options.Endpoint !== after.Options.Endpoint ||
        ![journal.beforeProfile, journal.afterProfile].includes(currentProfile)) throw new Error("UPDATE_PROFILE_CONFLICT");
    await canonical(before.Options.DataHome); await canonical(before.Options.PaseoHome);
    await new Promise<void>((ok, fail) => { portGuard.once("error", () => fail(new Error("UPDATE_RUNTIME_RUNNING"))); portGuard.listen({ host: "127.0.0.1", port: Number(before.Options.Endpoint.split(":")[1]), exclusive: true }, () => { listening = true; ok(); }); });
    await own(join(root, "data", "requests"));
    // No migration on update: old/future/corrupt data is held for the original app.
    for (const file of (await readdir(join(root, "data", "requests"))).filter(file => file.endsWith(".json"))) {
      const doc = recordSchema.parse(JSON.parse(await bounded(join(root, "data", "requests", file)))); validateReferences(doc);
      if (doc.schemaVersion !== 2 || file !== `${doc.token}.json` || occupiesSlot(doc)) throw new Error("UPDATE_ACTIVE_OR_INVALID_RECORD");
    }
    await projects.open();
    for (const p of await projects.list()) {
      if (!p.available) throw new Error("UPDATE_PROJECT_UNAVAILABLE"); if (!p.initialized) continue;
      await projects.own(p.sourceRoot);
      const production = await new ProductionStore(p.sourceRoot, p.projectId, async () => {}).diagnostics();
      const conversations = await new ConversationStore(p.sourceRoot, p.projectId, async () => {}).all();
      if (production.issues.length || production.activeTokens.length || conversations.issues.length || conversations.records.some(doc => doc.turns.some(activeConversationTurn))) throw new Error("UPDATE_ACTIVE_OR_INVALID_RECORD");
    }
    const configFile = join(root, "paseo", "config.json"), currentConfig = await bounded(configFile);
    if (![journal.beforeConfig, journal.afterConfig].includes(currentConfig)) throw new Error("UPDATE_CONFIG_CONFLICT");
    const afterConfig = JSON.parse(journal.afterConfig);
    if (afterConfig.daemon?.listen !== after.Options.Endpoint || !same(afterConfig.plugins?.["orchiva-plugin"]?.path ?? "", after.Options.SourceRoot)) throw new Error("UPDATE_JOURNAL_INVALID");
    const history = join(root, "updates"); await mkdir(history, { recursive: true }); await canonical(history);
    // Publish a complete, flushed intent before either configuration is changed.
    // The profile owner excludes concurrent maintenance and desktop startup.
    if (input.mode === "switch") await atomic(pendingFile, JSON.stringify(journal, null, 2));
    await fault?.("intent");
    if (currentConfig !== journal.afterConfig) await atomic(configFile, journal.afterConfig);
    await fault?.("config");
    if (currentProfile !== journal.afterProfile) await atomic(profileFile, journal.afterProfile);
    await fault?.("profile");
    await rename(pendingFile, join(history, `${journal.id}.json`));
    return { id: journal.id, target, dataPreserved: true, profileHash: digest(journal.afterProfile), recovered: input.mode === "recover" };
  } finally {
    await projects.close();
    for (const owner of owners.reverse()) await owner.close();
    if (listening) await new Promise<void>(ok => portGuard.close(() => ok()));
  }
}
