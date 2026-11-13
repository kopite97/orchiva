import type { z } from "zod";
import { serviceStatusSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import type { RequestStore, Runtime, LifecycleRuntime } from "./ports";
import type { StartFeatureRequest } from "./start-feature-request";
import type { TrackExecution } from "./track-execution";
import { occupiesSlot } from "../domain/record-v2";
import { isPreparation } from "../domain/failure";

export type Outcome = { kind: string; error?: { message: string }; reason?: string; turnId?: string | null };
export interface RuntimeLease { runtime(): Promise<Runtime & LifecycleRuntime>; ping(): Promise<void>; close(): Promise<void> }
export const needsReconciliation = (record: RequestRecord) => occupiesSlot(record) || (!!record.agentId && !record.result && !["completed", "failed"].includes(record.status));

/** Single owner and one in-flight cycle. Hooks enqueue hints; they never block provider turns. */
export class Reconciler {
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopping?: Promise<void>;
  private lease?: RuntimeLease;
  private requested = false;
  private hints = new Map<string, Outcome | undefined>();
  private nextConnectionAttempt = 0;
  private activeCycles = 0;
  private maxConcurrentCycles = 0;
  private status: z.infer<typeof serviceStatusSchema>;
  constructor(private store: RequestStore, private starter: Pick<StartFeatureRequest, "advance">, private tracker: Pick<TrackExecution, "refresh">,
    private factory: () => RuntimeLease, private options: { intervalMs?: number; now?: () => number; report?: (status: z.infer<typeof serviceStatusSchema>) => Promise<void> } = {}) {
    this.status = { state: "starting", startedAt: this.iso(), lastSuccessAt: null, lastError: null, nextAttemptAt: null, cycles: 0, failures: 0, restoring: true };
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private iso() { return new Date(this.now()).toISOString(); }
  snapshot() { return { ...this.status, activeCycles: this.activeCycles, maxConcurrentCycles: this.maxConcurrentCycles }; }
  assertReady() { if (this.stopped || this.status.restoring || this.status.state !== "connected") throw new Error("ENVIRONMENT_NOT_READY: 실행 상태를 복원하고 있습니다."); }
  start() { this.wake(); }
  hint(agentId: string, outcome?: Outcome) { if (this.stopped) return; if (outcome || !this.hints.has(agentId)) this.hints.set(agentId, outcome); this.wake(); }
  wake() {
    if (this.stopped) return;
    if (this.running) { this.requested = true; return; }
    clearTimeout(this.timer); this.timer = undefined;
    this.running = this.cycle().finally(() => {
      this.running = undefined;
      if (this.stopped) return;
      const wait = Math.max(this.nextConnectionAttempt - this.now(), this.requested ? 0 : this.options.intervalMs ?? 5000);
      this.requested = false;
      this.timer = setTimeout(() => this.wake(), wait); this.timer.unref?.();
    });
  }
  async settle() { await this.running; }
  private async cycle() {
    if (this.now() < this.nextConnectionAttempt) return;
    this.activeCycles++;
    this.maxConcurrentCycles = Math.max(this.maxConcurrentCycles, this.activeCycles);
    try {
      this.lease ??= this.factory();
      const runtime = await this.lease.runtime();
      if (this.stopped) return;
      await this.lease.ping();
      if (this.stopped) return;
      const records = await this.store.list();
      if (!records.some(x => x.commands.some(c => isPreparation(c) && c.status === "pending"))) {
        for (const id of this.hints.keys()) if (!records.some(x => x.agentId === id)) this.hints.delete(id);
      }
      for (const record of records) {
        if (this.stopped) return;
        const hinted = !!record.agentId && this.hints.has(record.agentId);
        if (!needsReconciliation(record) && !hinted) continue;
        if (!hinted && record.observation?.nextAttemptAt && Date.parse(record.observation.nextAttemptAt) > this.now()) continue;
        const outcome = record.agentId ? this.hints.get(record.agentId) : undefined;
        if (record.agentId) this.hints.delete(record.agentId);
        // Safe preparation checkpoints may continue; uncertain external phases only hold.
        if (record.commands.some(x => isPreparation(x) && x.status === "pending")) await this.starter.advance(record.token, runtime);
        if (this.stopped) return;
        const latest = await this.store.get(record.token);
        if (latest?.agentId) await this.tracker.refresh(record.token, runtime, outcome);
      }
      this.status = { ...this.status, state: "connected", lastSuccessAt: this.iso(), lastError: null, nextAttemptAt: null, cycles: this.status.cycles + 1, failures: 0, restoring: false };
      this.nextConnectionAttempt = 0;
    } catch (error) {
      if (this.stopped) return;
      const failures = this.status.failures + 1, wait = Math.min(5000 * 2 ** (failures - 1), 30000);
      this.nextConnectionAttempt = this.now() + wait;
      this.status = { ...this.status, state: "reconnecting", failures, lastError: error instanceof Error ? error.message : String(error), nextAttemptAt: new Date(this.nextConnectionAttempt).toISOString() };
      const lease = this.lease; this.lease = undefined; await lease?.close().catch(() => undefined);
    } finally {
      this.activeCycles--;
      if (!this.stopped) await this.options.report?.(this.snapshot()).catch(() => undefined);
    }
  }
  stop(): Promise<void> {
    return this.stopping ??= (async () => {
      this.stopped = true; clearTimeout(this.timer); this.hints.clear();
      try { await this.lease?.close(); }
      finally {
        await this.running;
        this.status = { ...this.status, state: "stopped" };
        await this.options.report?.(this.snapshot()).catch(() => undefined);
      }
    })();
  }
}
