import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { projectSchema, initialization, type DesktopProject } from "../../../shared/contracts/desktop-project";
import { DirectoryOwner } from "../../adapters/storage/directory-owner";
import { atomic, absent, bytes, digest, immutable, inside, markdownFiles, relativeFile, safePath } from "../../adapters/storage/project-files";
import { RequestLocks } from "../request-locks";
import { defaultRefs, rootMap, templates } from "./project-templates";

const entrySchema = z.object({ projectId: z.string().uuid(), sourceRoot: z.string(), name: z.string() });
type Entry = z.infer<typeof entrySchema>;
const registrySchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) });
const configFile = "docs/.orchiva/project.json";
export class Projects {
  private owner: DirectoryOwner;
  private roots = new Map<string, DirectoryOwner>();
  readonly locks = new RequestLocks();
  constructor(readonly directory: string) { this.owner = new DirectoryOwner(directory); }
  async open() { await this.owner.open(); }
  async close() { for (const owner of this.roots.values()) await owner.close(); await this.owner.close(); }
  async exclusive<T>(action: () => Promise<T>) { await this.open(); return this.locks.run("global", action); }
  private async entries() {
    try { return registrySchema.parse(JSON.parse(await readFile(join(this.directory, "projects.json"), "utf8"))).entries; }
    catch (error) { if (absent(error)) return []; throw new Error("PROJECT_REGISTRY_INVALID"); }
  }
  private async saveEntries(entries: Entry[]) { await atomic(join(this.directory, "projects.json"), JSON.stringify({ version: 1, entries }, null, 2)); }
  async entry(id: string) { const found = (await this.entries()).find(x => x.projectId === id); if (!found) throw new Error("PROJECT_NOT_REGISTERED"); return found; }
  async config(root: string): Promise<DesktopProject | null> {
    const content = await bytes(root, configFile); if (!content) return null;
    try { return projectSchema.parse(JSON.parse(content.toString("utf8"))); } catch { throw new Error("PROJECT_CONFIG_INVALID"); }
  }
  async project(id: string) {
    const entry = await this.entry(id), root = await realpath(entry.sourceRoot), config = await this.config(root);
    if (!config || config.projectId !== id) throw new Error("PROJECT_NOT_INITIALIZED");
    return { ...entry, sourceRoot: root, config };
  }
  async own(root: string) {
    const actual = await realpath(root), key = actual.toLowerCase();
    if (!this.roots.has(key)) { const owner = new DirectoryOwner(actual); await owner.open(); this.roots.set(key, owner); }
  }
  async view(entry: Entry) {
    try { const config = await this.config(entry.sourceRoot); if (config && config.projectId !== entry.projectId) throw new Error("PROJECT_ID_CHANGED"); return { ...entry, name: config?.name ?? entry.name, initialized: !!config, available: true, config, issue: null }; }
    catch (error) { return { ...entry, initialized: false, available: false, config: null, issue: absent(error) ? "PROJECT_OFFLINE" : "PROJECT_CONFIG_INVALID" }; }
  }
  async list() { return Promise.all((await this.entries()).map(x => this.view(x))); }
  async register(sourceRoot: string, name: string) {
    return this.exclusive(async () => {
      if (!isAbsolute(sourceRoot) || sourceRoot.startsWith("\\\\")) throw new Error("LOCAL_ABSOLUTE_ROOT_REQUIRED");
      const root = await realpath(sourceRoot), entries = await this.entries(), config = await this.config(root);
      const same = entries.find(x => x.sourceRoot.toLowerCase() === root.toLowerCase()); if (same) return this.view(same);
      if (entries.some(x => inside(x.sourceRoot, root) || inside(root, x.sourceRoot))) throw new Error("PROJECT_ROOT_OVERLAP");
      const duplicate = config && entries.find(x => x.projectId === config.projectId);
      if (duplicate) {
        try { await realpath(duplicate.sourceRoot); throw new Error("DUPLICATE_PROJECT_ID"); } catch (error) { if (!absent(error)) throw error; }
        duplicate.sourceRoot = root; await this.saveEntries(entries); return this.view(duplicate);
      }
      const entry = { projectId: config?.projectId ?? randomUUID(), sourceRoot: root, name };
      entries.push(entry); await this.saveEntries(entries); return this.view(entry);
    });
  }
  async preview(id: string) {
    const entry = await this.entry(id), root = await realpath(entry.sourceRoot), existing = await this.config(root);
    if (existing && existing.projectId !== id) throw new Error("PROJECT_ID_CHANGED");
    const refs = existing ? structuredClone(existing.instructionRefs) : structuredClone(defaultRefs);
    const changes: z.infer<typeof initialization>["changes"] = [], issues: string[] = [];
    const renames = new Map<string, string>();
    for (const file of await markdownFiles(root)) {
      if (file.toLowerCase() === "agents.md" || basename(file).toLowerCase() !== "agents.md") continue;
      const parent = dirname(file).replaceAll("\\", "/"), target = parent + "/" + (parent === "docs/plans" ? "plans.md" : parent === "docs/decisions" ? "decisions.md" : parent === "docs/evidence" ? "evidence.md" : "instructions.md");
      const content = await bytes(root, file), destination = await bytes(root, target);
      if (!content) continue;
      if (destination && !destination.equals(content)) { issues.push("INSTRUCTION_MIGRATION_CONFLICT: " + file + " → " + target); continue; }
      renames.set(file, target);
      changes.push({ path: file, before: digest(content), content: null, reason: "지침 이관 원본 (백업 후 제거)" });
      if (!destination) changes.push({ path: target, before: null, content: content.toString("utf8"), reason: "같은 디렉터리에서 적용 범위·상대 링크 보존" });
      if (!refs.some(x => x.path === target)) refs.push({ path: target, scope: parent + "/**", required: true });
    }
    for (const [path, content] of Object.entries(templates)) if (!changes.some(x => x.path === path) && !await bytes(root, path)) changes.push({ path, content, before: null, reason: "누락된 기본 지침/목록" });
    for (const ref of refs) ref.path = renames.get(ref.path) ?? ref.path;
    for (let index = refs.length - 1; index >= 0; index--) if (refs.findIndex(x => x.path === refs[index].path) !== index) refs.splice(index, 1);
    // Rewrite links in the actual instruction documents, relative to each file.
    for (const file of [...new Set([...refs.map(x => x.path), ...renames.values()])]) {
      const change = changes.find(x => x.path === file && x.content !== null), original = await bytes(root, file);
      const text = change?.content ?? original?.toString("utf8"); if (!text) continue;
      let content = text;
      for (const [oldPath, newPath] of renames) {
        const oldLink = relative(dirname(join(root, file)), join(root, oldPath)).replaceAll("\\", "/"), newLink = relative(dirname(join(root, file)), join(root, newPath)).replaceAll("\\", "/");
        content = content.replaceAll(`](${oldLink})`, `](${newLink})`);
      }
      if (content !== text) { if (change) change.content = content; else changes.push({ path: file, before: original ? digest(original) : null, content, reason: "이관 지침 상대 링크 갱신" }); }
    }
    let agent = (await bytes(root, "AGENTS.md"))?.toString("utf8") ?? "# 프로젝트 지침\n\n";
    for (const [oldPath, newPath] of renames) agent = agent.replaceAll(oldPath, newPath);
    // Existing instructions remain; only missing map links are appended.
    const missingRefs = refs.filter(x => !agent.includes(`](${x.path})`));
    if (missingRefs.length) agent += "\n" + rootMap(missingRefs);
    const before = await bytes(root, "AGENTS.md");
    if (!before || before.toString("utf8") !== agent) changes.push({ path: "AGENTS.md", before: before ? digest(before) : null, content: agent, reason: "기존 지침 보존 + 필수 지도 연결" });
    const config = projectSchema.parse(existing ? { ...existing, instructionRefs: refs } : { schemaVersion: 1, projectId: id, name: entry.name, revision: 1, templateVersion: 1, baseRef: "main", outputRoot: null, instructionRefs: refs });
    if (!existing || JSON.stringify(existing) !== JSON.stringify(config)) {
      if (existing) config.revision++;
      const old = await bytes(root, configFile); changes.push({ path: configFile, before: old ? digest(old) : null, content: JSON.stringify(config, null, 2), reason: "프로젝트 식별·설정" });
    }
    const fingerprint = digest(JSON.stringify({ id, root, changes, issues }));
    return { projectId: id, changes, issues, fingerprint };
  }
  async initialize(id: string, fingerprint: string, commandKey: string) {
    return this.exclusive(async () => {
      const entry = await this.entry(id); await this.own(entry.sourceRoot);
      const journalPath = await safePath(entry.sourceRoot, `docs/.orchiva/initializations/${commandKey}.json`);
      let plan: z.infer<typeof initialization>;
      try { plan = initialization.parse(JSON.parse(await readFile(journalPath, "utf8"))); if (plan.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT"); }
      catch (error) { if (!absent(error)) throw error; plan = await this.preview(id); if (plan.fingerprint !== fingerprint) throw new Error("INITIALIZATION_STALE"); if (plan.issues.length) throw new Error("INITIALIZATION_CONFLICT"); await atomic(journalPath, JSON.stringify(plan)); }
      // Write destinations first; source AGENTS files are removed only after copies exist.
      for (const change of [...plan.changes.filter(x => x.content !== null), ...plan.changes.filter(x => x.content === null)]) {
        const current = await bytes(entry.sourceRoot, change.path), currentHash = current ? digest(current) : null;
        const after = change.content === null ? null : digest(change.content);
        if (currentHash === after) continue;
        if (currentHash !== change.before) throw new Error("INITIALIZATION_EXTERNAL_CHANGE");
        if (current) await immutable(entry.sourceRoot, `docs/.orchiva/backups/initialization/${commandKey}/${change.path}.bak`, current);
        const target = await safePath(entry.sourceRoot, change.path);
        if (change.content === null) await unlink(target); else await atomic(target, change.content);
      }
      const check = await this.instructions(id); if (!check.ready) throw new Error("INITIALIZATION_INCOMPLETE");
      return this.view(entry);
    });
  }
  async configure(id: string, revision: number, values: { name: string; baseRef: string; outputRoot: string | null }) {
    return this.exclusive(async () => {
      const project = await this.project(id); await this.own(project.sourceRoot);
      if (project.config.revision !== revision) throw new Error("REVISION_CONFLICT");
      let outputRoot: string | null = null;
      if (values.outputRoot) {
        if (!isAbsolute(values.outputRoot) || values.outputRoot.startsWith("\\\\")) throw new Error("OUTPUT_ABSOLUTE_ROOT_REQUIRED");
        // Existing roots only: creating directories is an explicit user action outside registration.
        const actual = await realpath(values.outputRoot);
        if (inside(project.sourceRoot, actual) || inside(actual, project.sourceRoot)) throw new Error("SOURCE_OUTPUT_OVERLAP");
        outputRoot = relative(project.sourceRoot, actual).replaceAll("\\", "/");
      }
      const config = projectSchema.parse({ ...project.config, ...values, outputRoot, revision: revision + 1 });
      await immutable(project.sourceRoot, `docs/.orchiva/backups/settings/${revision}.json`, JSON.stringify(project.config, null, 2));
      await atomic(await safePath(project.sourceRoot, configFile), JSON.stringify(config, null, 2)); return this.view(project);
    });
  }
  async instructions(id: string) {
    const project = await this.project(id); return inspectProjectInstructions(project.sourceRoot, project.config);
  }
  async saveInstruction(id: string, file: string, expected: string | null, content: string, scope: string) {
    return this.exclusive(async () => {
      const project = await this.project(id); await this.own(project.sourceRoot); file = relativeFile(file);
      const registered = file === "AGENTS.md" || project.config.instructionRefs.some(x => x.path === file);
      if (!registered && (!file.startsWith("docs/agents/") || !file.endsWith(".md") || basename(file).toLowerCase() === "agents.md")) throw new Error("INSTRUCTION_PATH_REQUIRED");
      const old = await bytes(project.sourceRoot, file); if ((old ? digest(old) : null) !== expected) throw new Error("FILE_CHANGED");
      if (old) await immutable(project.sourceRoot, `docs/.orchiva/backups/instructions/${digest(old)}.md`, old);
      if (!registered) {
        project.config.instructionRefs.push({ path: file, scope, required: true }); project.config.revision++;
        await atomic(await safePath(project.sourceRoot, configFile), JSON.stringify(project.config, null, 2));
        // Root map is a real instruction file: show the missing link until the user saves it.
      }
      // Register first: an interrupted write remains a visible missing instruction
      // and can be retried, instead of becoming an undiscoverable orphan file.
      await atomic(await safePath(project.sourceRoot, file), content);
      return this.instructions(id);
    });
  }
  async output(id: string) { const p = await this.project(id); if (!p.config.outputRoot) throw new Error("OUTPUT_REQUIRED"); const root = await realpath(resolve(p.sourceRoot, p.config.outputRoot)); if (inside(p.sourceRoot, root) || inside(root, p.sourceRoot)) throw new Error("SOURCE_OUTPUT_OVERLAP"); return root; }
}

export async function inspectProjectInstructions(sourceRoot: string, supplied?: DesktopProject) {
    const raw = supplied ?? JSON.parse((await bytes(sourceRoot, configFile))?.toString("utf8") ?? "null");
    const project = { sourceRoot, config: projectSchema.parse(raw) }, issues: string[] = [], files = [];
    for (const ref of [{ path: "AGENTS.md", scope: "all", required: true }, ...project.config.instructionRefs]) {
      try { const content = await bytes(project.sourceRoot, ref.path); files.push({ ...ref, exists: !!content, hash: content ? digest(content) : null, content: content?.toString("utf8") ?? null, issue: content ? null : "MISSING" }); if (!content && ref.required) issues.push("MISSING: " + ref.path); }
      catch { files.push({ ...ref, exists: false, hash: null, content: null, issue: "UNREADABLE_OR_OUTSIDE" }); issues.push("UNREADABLE_OR_OUTSIDE: " + ref.path); }
    }
    const map = files[0]?.content ?? "";
    for (const ref of project.config.instructionRefs) if (ref.required && !map.includes(`](${ref.path})`)) issues.push("MAP_LINK_MISSING: " + ref.path);
    for (const file of await markdownFiles(project.sourceRoot)) if (file.toLowerCase() !== "agents.md" && basename(file).toLowerCase() === "agents.md") issues.push("NESTED_AGENTS: " + file);
    return { files, issues, ready: !issues.length, fingerprint: digest(JSON.stringify(files.map(({ path, hash, scope, required }) => ({ path, hash, scope, required })))) };
  }
