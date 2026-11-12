import { recoveryCommandSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import type { RequestStore, RecoveryRuntime, Lookup } from "./ports";
import { RequestLocks } from "./request-locks";
import { assertRevision, assertSlot, beginCommand, finishCommand, previousCommand } from "./execution-slot";
import { isPreparation, retryablePreparation } from "../domain/failure";
import { randomUUID } from "node:crypto";

export class RecoverRequest {
  constructor(private store: RequestStore, private locks: RequestLocks) {}
  async retry(input: unknown, beforeAccept?: () => void) {
    const parsed = recoveryCommandSchema.parse(input);
    return this.store.exclusive(() => this.locks.run(parsed.token, async () => {
      const record = await this.required(parsed.token), payload = { targetCommandKey: parsed.targetCommandKey };
      if (previousCommand(record, parsed.commandKey, "retry-start", payload)) return record;
      beforeAccept?.();
      assertRevision(record, parsed.expectedRevision);
      if (record.commands.some(x => ["unknown", "pending"].includes(x.status)) || record.recovery?.pending) throw new Error("DELIVERY_UNKNOWN");
      const previous = retryablePreparation(record);
      if (!previous || previous.key !== parsed.targetCommandKey) throw new Error("INVALID_STATE: only confirmed preparation failures can be retried");
      await assertSlot(this.store, record.token);
      const command = beginCommand(record, parsed.commandKey, "retry-start", payload);
      command.phase = record.workspaceId ? "plans" : "accepted";
      if (record.workspaceId) command.resourceIds.workspaceId = record.workspaceId;
      record.error = null; record.failure = null; record.observationError = null;
      this.transition(record, "planned", "확인된 준비 단계부터 재시도합니다. 기존 리소스와 계획을 유지합니다.");
      await this.store.save(record); return record;
    }));
  }
  async reconcile(input: unknown, runtime: RecoveryRuntime) {
    const parsed = recoveryCommandSchema.parse(input);
    return this.store.exclusive(() => this.locks.run(parsed.token, async () => {
      const record = await this.required(parsed.token), payload = { targetCommandKey: parsed.targetCommandKey };
      if (previousCommand(record, parsed.commandKey, "reconcile", payload)) return record;
      assertRevision(record, parsed.expectedRevision);
      const target = record.commands.find(x => x.key === parsed.targetCommandKey);
      if (!target || target.status !== "unknown" || (!isPreparation(target) && target.kind !== "resume")) throw new Error("INVALID_STATE: no uncertain delivery to reconcile");
      await assertSlot(this.store, record.token);
      let found: Lookup<{ id: string; directory?: string }>;
      try { found = await runtime.lookupDelivery(record, target); }
      catch { found = { kind: "unknown", reason: "외부 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 대조하세요." }; }
      if (found.kind === "found") {
        const expected = target.kind === "resume" ? record.recovery?.messageId : target.phase === "workspace" ? record.workspaceId : record.agentId;
        if (expected && found.value.id !== expected) found = { kind: "unknown", reason: "원래 리소스·메시지 식별자와 다릅니다." };
      }
      if (found.kind === "found" && isPreparation(target) && target.phase === "workspace" && !found.value.directory) found = { kind: "unknown", reason: "Worktree 경로가 없어 리소스를 연결할 수 없습니다." };
      if (found.kind === "found" && !((isPreparation(target) && ["workspace", "agent", "done"].includes(target.phase)) || (target.kind === "resume" && record.recovery?.pending && record.recovery.key === target.key))) found = { kind: "unknown", reason: "저장된 전달 checkpoint와 대조 결과가 일치하지 않습니다." };
      const id = randomUUID(), detail = found.kind === "found" ? "원래 생성·전송 식별자와 외부 근거가 일치합니다." : found.kind === "absent" ? "대조 범위에서 찾지 못했습니다. 미전송을 보장하지 않으므로 자동 재전송과 슬롯 해제를 하지 않습니다." : found.reason;
      (record.deliveryChecks ??= []).push({ id, commandKey: target.key, at: new Date().toISOString(), outcome: found.kind, detail, resourceId: found.kind === "found" ? found.value.id : null });
      if (found.kind === "found") {
        record.failure = null; record.error = null; record.observationError = null; delete record.observation;
        if (isPreparation(target) && target.phase === "workspace") {
          record.workspaceId = found.value.id; record.worktreePath = found.value.directory!;
          target.resourceIds.workspaceId = found.value.id; target.status = "pending"; target.phase = "plans";
          this.transition(record, "writing-plan", "기존 Worktree를 확인했습니다. 안전한 준비 단계부터 이어갑니다.");
        } else {
          if (target.kind === "resume") { record.recovery!.pending = false; finishCommand(target, `attempt:${record.attempt}`); }
          else { record.agentId = found.value.id; target.resourceIds.agentId = found.value.id; finishCommand(target, record.taskId); }
          this.transition(record, "started", "기존 세션·전송을 확인했습니다. 재전송 없이 상태를 관측합니다.");
        }
      }
      const command = beginCommand(record, parsed.commandKey, "reconcile", payload); finishCommand(command, id);
      await this.store.save(record); return record;
    }));
  }
  private async required(token: string) { const record = await this.store.get(token); if (!record) throw new Error("NOT_FOUND"); return record; }
  private transition(record: RequestRecord, status: RequestRecord["status"], detail: string) { record.status = status; record.events = [...record.events, { at: new Date().toISOString(), status, detail }].slice(-100); }
}
