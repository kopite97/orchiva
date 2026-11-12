import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RequestRecord } from "../../../shared/contracts/feature-request";
import type { Runtime, LifecycleRuntime, Observation } from "../../application/ports";
import { assertSandbox, assertWorktree, type ProjectConfig } from "../../config/project-config";
import { collectEvidence, snapshot } from "../storage/evidence";
import { findMessage } from "./reconciliation";
function recoveryMessage(record: RequestRecord) {
  if (!record.recovery) throw new Error("Missing recovery checkpoint.");
  return `Resume task ${record.taskId} in the SAME worktree. Read .orchiva/plans/${record.taskPlan.id}.md again. Do not push, merge, or access other repositories.\nRecovery instructions:\n${record.recovery.instruction}\nIndependent checks: ${JSON.stringify(record.checks)}`;
}
export class PaseoRuntime implements Runtime, LifecycleRuntime {
  constructor(private paseo: PluginHandlerContext["paseo"], private config: ProjectConfig) {}
  async validate() { await assertSandbox(this.config); }
  async createWorkspace(record: RequestRecord) {
    const workspace = await this.paseo.workspaces.create({ idempotencyKey: `orchiva-workspace-${record.token}`, title: `${record.taskId}: ${record.feature.title}`,
      source: { kind: "worktree", cwd: this.config.repositoryPath, action: "branch-off", refName: this.config.baseRef, branchName: `orchiva/${record.taskId.toLowerCase()}` } });
    if (!workspace.directory) throw new Error("Paseo returned no worktree directory.");
    await assertWorktree(this.config, workspace.directory);
    return { id: workspace.id, directory: workspace.directory };
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
