import type { RequestRecord } from "../../shared/contracts/feature-request";
import type { RequestStore } from "./ports";
import { payloadHash } from "../domain/record-v2";

/** Caller holds project, then request lock. Slot is derived from durable requests. */
export async function assertSlot(store: RequestStore, token: string) {
  const state = await store.diagnostics();
  if (state.issues.length) throw new Error("STORAGE_UNHEALTHY: resolve invalid records before starting effects");
  const occupied = state.activeTokens.filter(item => item !== token);
  if (occupied.length) throw new Error(`BUSY: ${occupied.join(", ")}`);
}
export function assertRevision(record: RequestRecord, revision?: number) {
  if (revision !== undefined && record.revision !== revision) throw new Error("REVISION_CONFLICT");
}
export function previousCommand(record: RequestRecord, key: string, kind: RequestRecord["commands"][number]["kind"], payload: unknown) {
  const command = record.commands.find(item => item.key === key);
  if (command && (command.kind !== kind || command.payloadHash !== payloadHash(payload))) throw new Error("IDEMPOTENCY_CONFLICT: key belongs to different input");
  return command;
}
export function beginCommand(record: RequestRecord, key: string, kind: RequestRecord["commands"][number]["kind"], payload: unknown) {
  const command: RequestRecord["commands"][number] = { key, kind, payloadHash: payloadHash(payload), status: "pending", phase: "accepted", messageId: null, resourceIds: {}, outcomeRef: null, createdAt: new Date().toISOString(), resolvedAt: null };
  record.commands.push(command); return command;
}
export function finishCommand(command: RequestRecord["commands"][number], outcomeRef: string) {
  command.status = "applied"; command.phase = "done"; command.outcomeRef = outcomeRef; command.resolvedAt = new Date().toISOString();
}
