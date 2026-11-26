import type { PaseoApi } from "@getpaseo/client";
import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { RequestRecord } from "../../../shared/contracts/feature-request";
import type { Production } from "../../../shared/contracts/desktop-production";
import type { InputSnapshot } from "../../application/desktop/snapshots";
import { Projects } from "../../application/desktop/projects";
import { safePath, bytes, atomic, digest, immutable } from "../storage/project-files";
import { generateProceduralMedia } from "../media/procedural-media";
import { inspectPng, inspectWav } from "../media/inspect-media";
import { collectFiles, snapshotFiles } from "../storage/evidence";
import { mediaBudget } from "../../../shared/contracts/desktop-media";
import { PaseoRuntime } from "./runtime";
import { assertWorktree, type ProjectConfig } from "../../config/project-config";
import type { Runtime, LifecycleRuntime, RecoveryRuntime, Observation } from "../../application/ports";

import { validateOutputs } from "../../application/desktop/milestone-validation";


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
  private media(record: RequestRecord) { return this.document.input.media ? generateProceduralMedia(this.document.input.media).map(f => ({ ...f, path: `media/${record.token}/${f.name}` })) : []; }
  async collect(record: RequestRecord, observation: Observation) {
    if (this.document.milestone) return this.collectMilestone(record, observation);
    const media = this.media(record); if (!media.length) return this.base.collect(record, observation);
    await this.base.verifyResources(record);
    const result = await collectFiles(record, observation, { mediaPaths: media.map(f => f.path) });
    for (const file of media) {
      let detail = "", passed = false;
      try {
        const content = await bytes(record.worktreePath!, file.path, mediaBudget.perFile);
        if (!content || digest(content) !== digest(file.data)) throw new Error("MEDIA_OUTPUT_CHANGED");
        detail = JSON.stringify(file.mime === "image/png" ? inspectPng(content) : file.mime === "audio/wav" ? inspectWav(content) : JSON.parse(content.toString("utf8"))); passed = true;
      } catch (error) { detail = error instanceof Error ? error.message : "MEDIA_VALIDATION_FAILED"; }
      result.checks.push({ checkId: "media-" + file.name, label: "임시 생성 규격: " + file.name, command: "media-inspect-v1", status: passed ? "passed" : "failed", passed, exitCode: passed ? 0 : 1, output: detail, durationMs: 0 });
      if (!passed) result.failure ??= "MEDIA_VALIDATION_FAILED";
    }
    if ((await snapshotFiles(record.worktreePath!, record.checks, media.map(f => f.path))).fingerprint !== result.fingerprint) result.failure ??= "MEDIA_FILE_CHANGED";
    return result;
  }
  private async collectMilestone(record: RequestRecord, observation: Observation) {
    const bound = this.document.milestone;
    if (!bound) return this.base.collect(record,observation);
    const result = await this.base.collect({ ...record, checks: [] }, observation);
    const snapshot = await snapshotFiles(record.worktreePath!, record.checks);
    Object.assign(result, { files:snapshot.files, fingerprint:snapshot.fingerprint, changedFiles:snapshot.changedFiles });
    try { await validateOutputs(bound,this.snapshot,record,result); }
    catch (error) { result.failure = error instanceof Error ? error.message : "MILESTONE_VALIDATION_FAILED"; }
    return result;
  }
  async fingerprint(record: RequestRecord) {
    const media = this.media(record); if (!media.length) return this.base.fingerprint(record);
    await this.base.verifyResources(record); return (await snapshotFiles(record.worktreePath!, record.checks, media.map(f => f.path))).fingerprint;
  }
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
    for (const file of this.media(record)) await immutable(record.worktreePath!, file.path, file.data);
  }
  async startAgent(record: RequestRecord) {
    if (!record.workspaceId || !record.worktreePath) throw new Error("WORKSPACE_REQUIRED");
    await assertWorktree(this.config, record.worktreePath);
    const agent = await this.api.workspaces.ref(record.workspaceId).agents.create({
      idempotencyKey: `orchiva-agent-${record.token}`, title: `${record.taskId}: ${record.feature.title}`, labels: { orchivaRequest: record.token },
      config: { provider: this.document.input.provider, modeId: "auto", ...(this.document.input.thinkingOptionId ? { thinkingOptionId: this.document.input.thinkingOptionId } : {}) },
      prompt: `Read AGENTS.md and the instructions applicable to your paths, then .orchiva/plans/${record.requestPlan.id}.md and .orchiva/plans/${record.taskPlan.id}.md. Execute only this approved PLAN inside this worktree. Do not commit, push, merge, create subagents or access the original repository or other projects. Do not create unrequested README or instruction documents. Preserve docs/.orchiva/input-snapshot.json and the supplied instructions. Report changed output files and verification results. Independent verification profile: ${JSON.stringify(record.checks)}.${this.document.input.media ? ` Temporary procedural assets were already generated from the exact approved numeric spec at media/${record.token}/. Inspect and report them, do not change or replace them, and do not claim an AI image/music model or engine-native particle asset was generated. Report any mismatch between the free-text goal and the limited preset honestly. Spec: ${JSON.stringify(this.document.input.media)}` : ""}`,
    });
    return agent.id;
  }
}
export async function desktopModels(api: PaseoApi, cwd: string) {
  const result = await api.providers.listModels("codex", { cwd });
  return { models: (result.models ?? []).filter(x => x.isSelectable !== false).map(x => ({ provider: `codex/${x.id}`, label: x.label, levels: (x.thinkingOptions ?? []).map(v => ({ id: v.id, label: v.label })) })), ready: !result.error && (result.models ?? []).length > 0, issue: result.error ? "MODEL_CATALOG_UNAVAILABLE" : null };
}
