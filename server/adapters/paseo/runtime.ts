import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join, resolve, dirname, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RequestRecord } from "../../../shared/contracts/feature-request";
import type { Runtime, LifecycleRuntime, Observation } from "../../application/ports";
import { assertSandbox, assertWorktree, git, type ProjectConfig } from "../../config/project-config";
import { collectEvidence, snapshot } from "../storage/evidence";
import { findMessage } from "./reconciliation";
import { createPinnedWorkspace } from "./pinned-workspace";
import { checkSchema } from "../../../shared/contracts/feature-request";
const execute = promisify(execFile);
function recoveryMessage(record: RequestRecord) {
  if (!record.recovery) throw new Error("Missing recovery checkpoint.");
  return `Resume task ${record.taskId} in the SAME worktree. Read .orchiva/plans/${record.taskPlan.id}.md again. Do not push, merge, or access other repositories.\nRecovery instructions:\n${record.recovery.instruction}\nIndependent checks: ${JSON.stringify(record.checks)}`;
}
export class PaseoRuntime implements Runtime, LifecycleRuntime {
  get projectSnapshot() { return { repositoryPath: this.config.repositoryPath, baseRef: this.config.baseRef, provider: this.config.provider, maxActiveTasks: 1 as const }; }
  constructor(private paseo: PluginHandlerContext["paseo"], private config: ProjectConfig) {}
  async validate() { await assertSandbox(this.config); }
  async preflight(checks: RequestRecord["checks"]) {
    await this.validate();
    await this.paseo.agents.list();
    try { await execute("where.exe", ["codex"], { windowsHide: true, timeout: 10000 }); }
    catch { throw new Error("ENVIRONMENT_NOT_READY: daemon 환경에서 Codex 실행 경로를 찾을 수 없습니다."); }
    const root = await realpath(this.config.repositoryPath);
    for (const raw of checks) {
      const check = checkSchema.parse(raw);
      let ancestor = resolve(root, check.path);
      while (true) {
        try { const actual = (await realpath(ancestor)).toLowerCase(); if (actual !== root.toLowerCase() && !actual.startsWith(root.toLowerCase() + sep)) throw new Error("INVALID_INPUT: 검사 경로가 저장소 밖을 가리킵니다."); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; const parent = dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent; }
      }
      try { await execute("git", ["-C", root, "check-ignore", "--no-index", "-q", "--", check.path], { windowsHide: true, timeout: 10000 }); }
      catch (error) { if ((error as { code?: number }).code === 1) continue; throw error; }
      throw new Error(`INVALID_INPUT: ignored 검사 경로: ${check.path}`);
    }
    return { baseCommit: await git(root, "rev-parse", "--verify", `${this.config.baseRef}^{commit}`), projectSnapshot: this.projectSnapshot };
  }
  async createWorkspace(record: RequestRecord) {
    const plan = record.plans.find(item => item.revision === record.confirmedPlanRevision);
    if (record.confirmationSource !== "confirmed-plan" || !plan?.baseCommit) throw new Error("PLAN_REQUIRED");
    const workspace = await createPinnedWorkspace(this.paseo, this.config, { key: `orchiva-workspace-${record.token}`, title: `${record.taskId}: ${record.feature.title}`, branch: `orchiva/${record.taskId.toLowerCase()}`, commit: plan.baseCommit });
    return { id: workspace.id, directory: workspace.directory! };
  }
  async writePlans(record: RequestRecord) {
    if (!record.worktreePath) throw new Error("No worktree path.");
    await assertWorktree(this.config, record.worktreePath);
    const directory = join(record.worktreePath, ".orchiva", "plans");
    await mkdir(directory, { recursive: true });
    for (const plan of [record.requestPlan, record.taskPlan]) {
      const path = join(directory, `${plan.id}.md`);
      try { await writeFile(path, plan.content, { encoding: "utf8", flag: "wx" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (await readFile(path, "utf8") !== plan.content) throw new Error(`Existing plan differs: ${plan.id}. Review before retrying.`); }
    }
  }
  async startAgent(record: RequestRecord) {
    if (!record.workspaceId || !record.worktreePath) throw new Error("No workspace.");
    await assertWorktree(this.config, record.worktreePath);
    const agent = await this.paseo.workspaces.ref(record.workspaceId).agents.create({
      idempotencyKey: `orchiva-agent-${record.token}`, title: `${record.taskId}: ${record.feature.title}`,
      config: { provider: this.config.provider },
      prompt: `Read .orchiva/plans/${record.taskPlan.id}.md and .orchiva/plans/${record.requestPlan.id}.md first, then execute the task. Stay inside this PoC sandbox worktree. Do not push or merge. Report validation evidence and completion criteria. Orchiva will independently run these checks: ${JSON.stringify(record.checks)}. Node tests run with read-only worktree filesystem access and without subprocess permissions.` });
    return agent.id;
  }
  async observe(record: RequestRecord): Promise<Observation> {
    if (!record.agentId) throw new Error("No agent to observe.");
    const agent = this.paseo.agents.ref(record.agentId);
    if (!await agent.refresh()) return { status: "failed", agentStatus: "missing", sourceKey: "missing", finalResponse: "", failure: "The saved Paseo agent is missing.", seenRecovery: false };
    if (agent.cwd && record.worktreePath && agent.cwd.toLowerCase() !== record.worktreePath.toLowerCase()) throw new Error("Agent is attached to a different worktree.");
    const base = { agentStatus: agent.status ?? "unknown", sourceKey: "", finalResponse: "", failure: null, seenRecovery: false };
    if (agent.pendingPermissions?.length) return { ...base, status: "needs-input" };
    if (agent.activeTurn || agent.status === "running" || agent.status === "initializing") return { ...base, status: "running" };
    const timeline = await agent.timeline.refetch({ direction: "tail", limit: 100 });
    const entries = timeline.entries;
    const lastUser = entries.filter(entry => entry.item.type === "user_message").at(-1);
    const answer = entries.filter(entry => entry.item.type === "assistant_message" && (!lastUser || entry.seqEnd > lastUser.seqEnd)).at(-1);
    const failure = agent.status === "error" ? agent.lastError ?? "Provider failed." : !answer ? "No final response after the latest request; execution may have been interrupted." : null;
    const recovery = record.recovery?.pending ? await findMessage(agent.timeline, record.recovery.messageId, recoveryMessage(record)) : null;
    return { status: failure ? "failed" : "ended", agentStatus: agent.status ?? "unknown",
      sourceKey: `${timeline.epoch}:${timeline.window.maxSeq}`,
      finalResponse: answer?.item.type === "assistant_message" ? answer.item.text : "", failure,
      turnId: answer?.turnId ?? lastUser?.turnId,
      seenRecovery: recovery?.kind === "found",
    };
  }
  async collect(record: RequestRecord, observation: Observation) { return collectEvidence(record, this.config, observation); }
  async fingerprint(record: RequestRecord) { return (await snapshot(record, this.config)).fingerprint; }
  async resume(record: RequestRecord) {
    if (!record.agentId || !record.worktreePath || !record.recovery) throw new Error("Missing recovery checkpoint.");
    await assertWorktree(this.config, record.worktreePath);
    await this.paseo.agents.ref(record.agentId).send(
      recoveryMessage(record),
      { messageId: record.recovery.messageId, activeTurnBehavior: "steer" },
    );
  }
}
