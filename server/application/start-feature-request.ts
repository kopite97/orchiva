import { startSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import type { RequestStore, Runtime } from "./ports";
import { RequestLocks } from "./request-locks";
import { assertSlot, assertRevision, beginCommand, finishCommand, previousCommand } from "./execution-slot";
import { draftHash, validatePlanInput } from "../domain/request-plan";
import { payloadHash } from "../domain/record-v2";
export class StartFeatureRequest {
  constructor(private store: RequestStore, readonly locks = new RequestLocks()) {}
  async start(input: unknown, runtime: Runtime): Promise<RequestRecord> {
    const parsed = startSchema.parse(input);
    return this.store.exclusive(() => this.locks.run(parsed.token, () => this.execute(parsed, runtime)));
  }
  private async execute(input: ReturnType<typeof startSchema.parse>, runtime: Runtime) {
    const record = await this.store.get(input.token);
    if ("feature" in input) {
      if (record && (payloadHash(record.feature) !== payloadHash(input.feature) || payloadHash(record.checks) !== payloadHash(input.checks))) throw new Error("IDEMPOTENCY_CONFLICT: different input");
      if (record && !["draft", "ready"].includes(record.status) && (record.agentId || record.confirmationSource)) return record;
      throw new Error("PLAN_REQUIRED: 초안을 저장하고 계획을 확인한 뒤 실행하세요.");
    }
    if (!record) throw new Error("PLAN_REQUIRED");
    const key = input.commandKey, payload = { planRevision: input.planRevision, inputHash: input.inputHash };
    if (previousCommand(record, key, "start", payload)) return record;
    assertRevision(record, input.expectedRevision);
    const plan = record.plans.at(-1);
    if (record.status !== "ready" || !plan?.baseCommit || plan.revision !== input.planRevision || plan.inputHash !== input.inputHash || draftHash(record) !== input.inputHash) throw new Error("PLAN_STALE: 계획을 다시 확인하세요.");
    validatePlanInput(record);
    if (payloadHash(record.requestPlan) !== payloadHash(plan.requestPlan) || payloadHash(record.taskPlan) !== payloadHash(plan.taskPlan)) throw new Error("PLAN_STALE: 저장된 계획 원문이 다릅니다.");
    await assertSlot(this.store, input.token);
    if (!runtime.preflight) throw new Error("ENVIRONMENT_NOT_READY");
    const current = await runtime.preflight(record.checks);
    if (current.baseCommit !== plan.baseCommit || payloadHash(current.projectSnapshot) !== payloadHash(plan.projectSnapshot)) throw new Error("PLAN_STALE: 기준 커밋 또는 프로젝트 설정이 바뀌었습니다. 계획을 다시 생성하세요.");
    record.projectSnapshot = current.projectSnapshot;
    record.confirmationSource = "confirmed-plan"; record.confirmedPlanRevision = plan.revision; record.status = "planned";
    const command = beginCommand(record, key, "start", payload);
    record.error = null;
    await this.store.save(record);
    try {
      if (!record.workspaceId) {
        command.phase = "workspace";
        record.status = "creating-worktree"; await this.store.save(record);
        const workspace = await runtime.createWorkspace(record);
        record.workspaceId = workspace.id; record.worktreePath = workspace.directory;
        command.resourceIds.workspaceId = workspace.id;
      }
      command.phase = "plans";
      record.status = "writing-plan"; await this.store.save(record);
      await runtime.writePlans(record);
      command.phase = "agent";
      record.status = "starting-session"; await this.store.save(record);
      record.agentId ??= await runtime.startAgent(record);
      command.resourceIds.agentId = record.agentId;
      finishCommand(command, record.taskId);
      record.status = "started"; await this.store.save(record);
    } catch (error) {
      const uncertain = ["workspace", "agent", "done"].includes(command.phase);
      command.status = uncertain ? "unknown" : "failed";
      record.status = uncertain ? "needs-input" : "failed";
      record.error = error instanceof Error ? error.message : String(error);
      await this.store.save(record);
    }
    return record;
  }
}
