import { resumeSchema, reviewSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import type { RequestStore, LifecycleRuntime, Observation } from "./ports";
import { RequestLocks } from "./request-locks";

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
  async refresh(token: string, runtime: LifecycleRuntime, outcome?: { kind: string; error?: { message: string }; reason?: string; turnId?: string | null }, revalidate = false) {
    return this.locks.run(token, async () => {
      const record = await this.required(token);
      if (!record.agentId) return record;
      try { await this.reconcile(record, runtime, outcome, revalidate); record.observationError = null; }
      catch (error) {
        record.observationError = error instanceof Error ? error.message : String(error);
        if (record.status === "validating") { record.error = record.observationError; this.transition(record, "failed", "Evidence collection failed."); }
      }
      await this.store.save(record);
      return record;
    });
  }
  private async reconcile(record: RequestRecord, runtime: LifecycleRuntime, outcome?: { kind: string; error?: { message: string }; reason?: string; turnId?: string | null }, revalidate = false) {
    const observed = await runtime.observe(record);
    if (outcome?.turnId && observed.turnId && outcome.turnId !== observed.turnId) outcome = undefined;
    if (observed.status === "running" || observed.status === "needs-input") {
      this.transition(record, observed.status, observed.status === "needs-input" ? "Resolve the pending question or permission in Paseo." : "Codex is executing.");
      record.decision = null;
      return;
    }
    // A persisted pending send is reconciled before any result can be accepted.
    if (record.recovery?.pending) {
      if (!observed.seenRecovery) { await runtime.resume(record); record.recovery.pending = false; this.transition(record, "running", "Recovered the pending resume command."); return; }
      record.recovery.pending = false;
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
    this.transition(record, "validating", "Collecting response, changed files and independent validation results.");
    await this.store.save(record);
    record.result = await runtime.collect(record, observed);
    record.decision = null;
    record.error = record.result.failure;
    this.transition(record, record.result.failure ? "failed" : "awaiting-review", record.result.failure ?? "Validation finished. Review the stated completion criteria.");
  }
  async resume(input: unknown, runtime: LifecycleRuntime) {
    const parsed = resumeSchema.parse(input);
    return this.locks.run(parsed.token, async () => {
      const record = await this.required(parsed.token);
      if (record.recovery?.key === parsed.key) {
        if (record.recovery.instruction !== parsed.instruction) throw new Error("Recovery key belongs to different instructions.");
        return record;
      }
      if (!["failed", "needs-input", "awaiting-review"].includes(record.status) || !record.agentId) throw new Error("Only stopped tasks with an existing session can be resumed.");
      const observed = await runtime.observe(record);
      if (["running", "needs-input"].includes(observed.status)) throw new Error("Resolve the active turn or pending permission in Paseo first.");
      record.attempts.push({ attempt: record.attempt, result: record.result, error: record.error });
      record.attempt += 1;
      record.result = null; record.decision = null; record.error = null;
      record.recovery = { key: parsed.key, instruction: parsed.instruction, messageId: `orchiva-${parsed.token}-${record.attempt}`, pending: true };
      this.transition(record, "running", `Attempt ${record.attempt}: ${parsed.instruction}`);
      await this.store.save(record);
      try { await runtime.resume(record); record.recovery.pending = false; }
      catch (error) {
        record.observationError = `Resume delivery uncertain; refresh to reconcile: ${error instanceof Error ? error.message : String(error)}`;
        this.transition(record, "needs-input", "Resume delivery needs reconciliation.");
      }
      await this.store.save(record);
      return record;
    });
  }
  async review(input: unknown, runtime: LifecycleRuntime) {
    const parsed = reviewSchema.parse(input);
    return this.locks.run(parsed.token, async () => {
      const record = await this.required(parsed.token);
      if (record.decision?.resultId === parsed.resultId && record.decision.approved === parsed.approved && record.decision.note === parsed.note) return record;
      if (record.status !== "awaiting-review" || !record.result || record.result.id !== parsed.resultId) throw new Error("The result changed or is not ready for review. Refresh first.");
      const observed = await runtime.observe(record);
      if (observed.status !== "ended" || observed.sourceKey !== record.result.sourceKey) throw new Error("Agent execution changed. Refresh before reviewing.");
      if (await runtime.fingerprint(record) !== record.result.fingerprint) {
        record.result = null; this.transition(record, "validating", "Files changed since validation; refresh to validate again.");
        await this.store.save(record); throw new Error("Files changed since validation. Refresh before reviewing.");
      }
      record.decision = { approved: parsed.approved, note: parsed.note, resultId: parsed.resultId, at: new Date().toISOString() };
      record.error = parsed.approved ? null : parsed.note;
      this.transition(record, parsed.approved ? "completed" : "failed", parsed.note);
      await this.store.save(record);
      return record;
    });
  }
}
