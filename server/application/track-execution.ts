import { resumeSchema, reviewSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import type { RequestStore, LifecycleRuntime, Observation } from "./ports";
import { RequestLocks } from "./request-locks";
import { assertSlot, assertRevision, beginCommand, finishCommand, previousCommand } from "./execution-slot";
import { payloadHash } from "../domain/record-v2";
import { randomUUID } from "node:crypto";
class CollectionFailure extends Error {}

export class TrackExecution {
  constructor(private store: RequestStore, private locks: RequestLocks) {}
  private transition(record: RequestRecord, status: RequestRecord["status"], detail: string) {
    if (record.status !== status) record.events = [...record.events, { at: new Date().toISOString(), status, detail }].slice(-100);
    record.status = status;
  }
  private async required(token: string) {
    const record = await this.store.get(token);
    if (!record) throw new Error("Request not found.");
    return record;
  }
  async refresh(token: string, runtime: LifecycleRuntime, outcome?: { kind: string; error?: { message: string }; reason?: string; turnId?: string | null }, revalidate = false, input?: { commandKey: string; resultId: string; expectedRevision: number }) {
    return this.store.exclusive(() => this.locks.run(token, async () => {
      const record = await this.required(token);
      // The PoC button combines observation and revalidation. Pending delivery
      // still needs observation, never a second validation/send command.
      if (!input && revalidate && (!record.agentId || record.recovery?.pending || record.commands.some(item => ["pending", "unknown"].includes(item.status)) || ["started", "running", "needs-input"].includes(record.status))) revalidate = false;
      let command: RequestRecord["commands"][number] | undefined;
      const interruptedValidation = !input && record.commands.find(x => x.kind === "revalidate" && x.status === "pending");
      if (interruptedValidation) { command = interruptedValidation; revalidate = true; }
      else if (revalidate) {
        const key = input?.commandKey ?? `revalidate-${randomUUID()}`;
        const payload = { resultId: input?.resultId ?? record.result?.id ?? null };
        if (previousCommand(record, key, "revalidate", payload)) return record;
        assertRevision(record, input?.expectedRevision);
        if (input && (!record.agentId || !["awaiting-review", "failed"].includes(record.status))) throw new Error("INVALID_STATE: no stopped result to revalidate");
        if (input && record.result?.id !== input.resultId) throw new Error("STALE_RESULT");
        if (record.status !== "completed") {
          if (record.recovery?.pending || record.commands.some(item => ["pending", "unknown"].includes(item.status))) throw new Error("DELIVERY_UNKNOWN");
          await assertSlot(this.store, token);
          command = beginCommand(record, key, "revalidate", payload);
          await this.store.save(record);
        }
      }
      if (!record.agentId) return record;
      if (record.status === "completed") return record;
      const attemptedAt = new Date().toISOString();
      let succeeded = false;
      try {
        await this.reconcile(record, runtime, outcome, revalidate); record.observationError = null;
        succeeded = true;
        record.observation = { lastAttemptAt: attemptedAt, lastSuccessAt: new Date().toISOString(), consecutiveFailures: 0, nextAttemptAt: null, error: null };
      }
      catch (error) {
        if (command && (error instanceof CollectionFailure || (error instanceof Error && error.message.startsWith("INVALID_STATE")))) { command.status = "failed"; command.phase = "validation-failed"; command.resolvedAt = new Date().toISOString(); }
        record.observationError = error instanceof Error ? error.message : String(error);
        const failures = (record.observation?.consecutiveFailures ?? 0) + 1;
        record.observation = { lastAttemptAt: attemptedAt, lastSuccessAt: record.observation?.lastSuccessAt ?? null, consecutiveFailures: failures, nextAttemptAt: new Date(Date.now() + Math.min(5000 * 2 ** (failures - 1), 30000)).toISOString(), error: record.observationError };
      }
      if (succeeded && command?.status === "pending" && record.result) finishCommand(command, record.result.id);
      await this.store.save(record);
      return record;
    }));
  }
  private async reconcile(record: RequestRecord, runtime: LifecycleRuntime, outcome?: { kind: string; error?: { message: string }; reason?: string; turnId?: string | null }, revalidate = false) {
    const observed = await runtime.observe(record);
    if (revalidate && ["running", "needs-input"].includes(observed.status)) throw new Error("INVALID_STATE: stop the active turn before revalidation");
    if (outcome?.turnId && observed.turnId && outcome.turnId !== observed.turnId) outcome = undefined;
    if (observed.status === "running" || observed.status === "needs-input") {
      this.transition(record, observed.status, observed.status === "needs-input" ? "Resolve the pending question or permission in Paseo." : "Codex is executing.");
      record.decision = null;
      return;
    }
    // A persisted pending send is reconciled before any result can be accepted.
    if (record.recovery?.pending) {
      if (!observed.seenRecovery) {
        this.transition(record, "needs-input", "Recovery delivery is unconfirmed; automatic resend is disabled.");
        throw new Error("Recovery delivery is unconfirmed. Preserve this checkpoint and reconcile the original message before continuing.");
      }
      record.recovery.pending = false;
      const command = record.commands.find(item => item.key === record.recovery!.key);
      if (command && command.status !== "applied") finishCommand(command, `attempt:${record.attempt}`);
    }
    if (record.result?.sourceKey === observed.sourceKey) {
      if ((!revalidate || record.status === "completed") && ["completed", "awaiting-review", "failed"].includes(record.status) && (!outcome || outcome.kind === "completed" || record.result.failure)) return;
      // Rechecking tests must not erase a known cancellation or provider failure.
      observed.failure ??= record.result.executionFailure;
    }
    if (outcome && outcome.kind !== "completed") {
      observed.failure = outcome.error?.message ?? outcome.reason ?? "Execution was interrupted.";
      observed.status = "failed";
    }
    await assertSlot(this.store, record.token);
    this.transition(record, "validating", "Collecting response, changed files and independent validation results.");
    await this.store.save(record);
    try { record.result = await runtime.collect(record, observed); }
    catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      this.transition(record, "failed", "Evidence collection failed.");
      throw new CollectionFailure(record.error);
    }
    record.decision = null;
    record.error = record.result.failure;
    this.transition(record, record.result.failure ? "failed" : "awaiting-review", record.result.failure ?? "Validation finished. Review the stated completion criteria.");
  }
  async resume(input: unknown, runtime: LifecycleRuntime) {
    const parsed = resumeSchema.parse(input);
    return this.store.exclusive(() => this.locks.run(parsed.token, async () => {
      const record = await this.required(parsed.token);
      if (previousCommand(record, parsed.key, "resume", { instruction: parsed.instruction })) return record;
      assertRevision(record, parsed.expectedRevision);
      if (record.recovery?.key === parsed.key) {
        if (record.recovery.instruction !== parsed.instruction) throw new Error("Recovery key belongs to different instructions.");
        return record;
      }
      if (record.recovery?.pending) throw new Error("Resolve the pending recovery delivery before sending another instruction.");
      if (record.commands.some(item => ["pending", "unknown"].includes(item.status))) throw new Error("DELIVERY_UNKNOWN: reconcile the pending command first");
      if (!["failed", "needs-input", "awaiting-review"].includes(record.status) || !record.agentId) throw new Error("Only stopped tasks with an existing session can be resumed.");
      const observed = await runtime.observe(record);
      if (["running", "needs-input"].includes(observed.status)) throw new Error("Resolve the active turn or pending permission in Paseo first.");
      await assertSlot(this.store, record.token);
      record.attempts.push({ attempt: record.attempt, result: record.result, error: record.error });
      record.attempt += 1;
      record.result = null; record.decision = null; record.error = null;
      record.recovery = { key: parsed.key, instruction: parsed.instruction, messageId: `orchiva-${parsed.token}-${record.attempt}`, pending: true };
      const command = beginCommand(record, parsed.key, "resume", { instruction: parsed.instruction });
      command.phase = "message"; command.messageId = record.recovery.messageId; command.resourceIds = { agentId: record.agentId };
      this.transition(record, "running", `Attempt ${record.attempt}: ${parsed.instruction}`);
      await this.store.save(record);
      try { await runtime.resume(record); record.recovery.pending = false; finishCommand(command, `attempt:${record.attempt}`); }
      catch (error) {
        command.status = "unknown";
        record.observationError = `Resume delivery uncertain; refresh to reconcile: ${error instanceof Error ? error.message : String(error)}`;
        this.transition(record, "needs-input", "Resume delivery needs reconciliation.");
      }
      await this.store.save(record);
      return record;
    }));
  }
  async review(input: unknown, runtime: LifecycleRuntime) {
    const parsed = reviewSchema.parse(input);
    return this.store.exclusive(() => this.locks.run(parsed.token, async () => {
      const record = await this.required(parsed.token);
      const payload = { resultId: parsed.resultId, approved: parsed.approved, note: parsed.note };
      const key = parsed.commandKey ?? `review-${payloadHash(payload)}`;
      if (previousCommand(record, key, "review", payload)) return record;
      if (record.decision?.resultId === parsed.resultId && record.decision.approved === parsed.approved && record.decision.note === parsed.note) return record;
      assertRevision(record, parsed.expectedRevision);
      if (record.recovery?.pending || record.commands.some(item => ["unknown", "pending"].includes(item.status))) throw new Error("DELIVERY_UNKNOWN");
      if (record.status !== "awaiting-review" || !record.result || record.result.id !== parsed.resultId) throw new Error("The result changed or is not ready for review. Refresh first.");
      const observed = await runtime.observe(record);
      if (observed.status !== "ended" || observed.sourceKey !== record.result.sourceKey) throw new Error("Agent execution changed. Refresh before reviewing.");
      if (await runtime.fingerprint(record) !== record.result.fingerprint) {
        await assertSlot(this.store, record.token);
        record.result = null; this.transition(record, "validating", "Files changed since validation; refresh to validate again.");
        await this.store.save(record); throw new Error("Files changed since validation. Refresh before reviewing.");
      }
      record.decision = { approved: parsed.approved, note: parsed.note, resultId: parsed.resultId, at: new Date().toISOString() };
      const command = beginCommand(record, key, "review", payload);
      finishCommand(command, parsed.resultId);
      record.error = parsed.approved ? null : parsed.note;
      this.transition(record, parsed.approved ? "completed" : "failed", parsed.note);
      await this.store.save(record);
      return record;
    }));
  }
}
