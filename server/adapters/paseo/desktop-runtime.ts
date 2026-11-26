import type { PaseoApi } from "@getpaseo/client";
import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { RequestRecord } from "../../../shared/contracts/feature-request";
import type { Production } from "../../../shared/contracts/desktop-production";
import type { InputSnapshot } from "../../application/desktop/snapshots";
import { Projects } from "../../application/desktop/projects";
import { safePath, bytes, atomic, digest } from "../storage/project-files";
import { PaseoRuntime } from "./runtime";
import { assertWorktree, type ProjectConfig } from "../../config/project-config";
import type { Runtime, LifecycleRuntime, RecoveryRuntime, Observation } from "../../application/ports";

import { validateOutputs } from "../../application/desktop/milestone-validation";
import { snapshotFiles } from "../storage/evidence";

export class DesktopRuntime implements Runtime, LifecycleRuntime, RecoveryRuntime {
  readonly base: PaseoRuntime;
  constructor(private api: PaseoApi, private config: ProjectConfig, readonly document: Production, private snapshot: InputSnapshot) { this.base = new PaseoRuntime(api, config); }
  get projectSnapshot() { return this.base.projectSnapshot; }
  validate() { return this.base.validate(); }
  preflight(checks: RequestRecord["checks"]) { return this.base.preflight(checks); }
  createWorkspace(record: RequestRecord) { return this.base.createWorkspace(record); }
  verifyResources(record: RequestRecord) { return this.base.verifyResources(record); }
  lookupDelivery(record: RequestRecord, command: RequestRecord["commands"][number]) { return this.base.lookupDelivery(record, command); }
  observe(record: RequestRecord) { return this.base.observe(record); }
  async collect(record: RequestRecord, observation: Observation) {
    const bound = this.document.milestone;
    if (!bound) return this.base.collect(record,observation);
    const result = await this.base.collect({ ...record, checks: [] }, observation);
    const snapshot = await snapshotFiles(record.worktreePath!, record.checks);
    Object.assign(result, { files:snapshot.files, fingerprint:snapshot.fingerprint, changedFiles:snapshot.changedFiles });
    try { await validateOutputs(bound,this.snapshot,record,result); }
    catch (error) { result.failure = error instanceof Error ? error.message : "MILESTONE_VALIDATION_FAILED"; }
    return result;
  }
  fingerprint(record: RequestRecord) { return this.base.fingerprint(record); }
  resume(record: RequestRecord) { return this.base.resume(record); }
  async writePlans(record: RequestRecord) {
    await this.base.verifyResources(record);
    // Idempotent initial input overlay; never copy the source's later edits.
    const marker = "docs/.orchiva/input-snapshot.json";
    const markerBytes = await bytes(record.worktreePath!, marker);
    if (!markerBytes) {
      for (const file of this.snapshot.files) {
        const target = await safePath(record.worktreePath!, file.path);
        if (file.base64 === null) { if (await bytes(record.worktreePath!, file.path)) await unlink(target); }
        else { await mkdir(dirname(target), { recursive: true }); await atomic(target, Buffer.from(file.base64, "base64")); }
      }
      await atomic(await safePath(record.worktreePath!, marker), JSON.stringify({ fingerprint: this.snapshot.fingerprint }));
    } else if (JSON.parse(markerBytes.toString("utf8")).fingerprint !== this.snapshot.fingerprint) throw new Error("INPUT_SNAPSHOT_MISMATCH");
    await this.base.writePlans(record);
  }
  async startAgent(record: RequestRecord) {
    if (!record.workspaceId || !record.worktreePath) throw new Error("WORKSPACE_REQUIRED");
    await assertWorktree(this.config, record.worktreePath);
    const agent = await this.api.workspaces.ref(record.workspaceId).agents.create({
      idempotencyKey: `orchiva-agent-${record.token}`, title: `${record.taskId}: ${record.feature.title}`, labels: { orchivaRequest: record.token },
      config: { provider: this.document.input.provider, modeId: "auto", ...(this.document.input.thinkingOptionId ? { thinkingOptionId: this.document.input.thinkingOptionId } : {}) },
      prompt: `Read AGENTS.md and the instructions applicable to your paths, then .orchiva/plans/${record.requestPlan.id}.md and .orchiva/plans/${record.taskPlan.id}.md. Execute only this approved PLAN inside this worktree. Do not commit, push, merge, create subagents or access the original repository or other projects. Do not create unrequested README or instruction documents. Preserve docs/.orchiva/input-snapshot.json and the supplied instructions. Report changed output files and verification results. Independent verification profile: ${JSON.stringify(record.checks)}.`,
    });
    return agent.id;
  }
}
export async function desktopModels(api: PaseoApi, cwd: string) {
  const result = await api.providers.listModels("codex", { cwd });
  return { models: (result.models ?? []).filter(x => x.isSelectable !== false).map(x => ({ provider: `codex/${x.id}`, label: x.label, levels: (x.thinkingOptions ?? []).map(v => ({ id: v.id, label: v.label })) })), ready: !result.error && (result.models ?? []).length > 0, issue: result.error ? "MODEL_CATALOG_UNAVAILABLE" : null };
}
