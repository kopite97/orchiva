import { createHash } from "node:crypto";
import { legacyRecordSchema, recordSchema, type RequestRecord } from "../../shared/contracts/feature-request";

export function payloadHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Populate available history only. Never infer a missing old result or approval. */
export function captureHistory(record: RequestRecord, legacy = false) {
  if (["draft", "ready"].includes(record.status)) return record;
  if (!record.criteria.length) record.criteria.push({ id: "legacy", text: record.feature.completionCriteria, checkIds: [], manualMethod: record.feature.validation, legacy: true });
  if (!record.plans.length) record.plans.push({ revision: record.requestPlan.revision, inputHash: payloadHash({ feature: record.feature, checks: record.checks }), requestPlan: structuredClone(record.requestPlan), taskPlan: structuredClone(record.taskPlan), baseCommit: null, createdAt: record.createdAt });
  for (const entry of [...record.attempts, { attempt: record.attempt, result: record.result }]) {
    let attempt = record.attemptHistory.find(item => item.number === entry.attempt);
    if (!attempt) {
      attempt = { number: entry.attempt, trigger: legacy ? "legacy" : entry.attempt === 1 ? "initial" : "resume", instruction: entry.attempt === record.attempt ? record.recovery?.instruction ?? null : null, resultIds: [] };
      record.attemptHistory.push(attempt);
    }
    if (!entry.result) continue;
    const existing = record.results.find(item => item.id === entry.result!.id);
    if (existing) {
      const { attemptNumber, validationRun, legacy: origin, ...value } = existing;
      if (payloadHash(value) !== payloadHash(entry.result) || attemptNumber !== entry.attempt) throw new Error("IMMUTABLE_HISTORY: result payload changed");
    } else record.results.push({ ...structuredClone(entry.result), attemptNumber: entry.attempt, validationRun: record.results.filter(item => item.attemptNumber === entry.attempt).length + 1, legacy });
    if (!attempt.resultIds.includes(entry.result.id)) attempt.resultIds.push(entry.result.id);
  }
  if (record.decision) {
    const decision = record.decision;
    const id = `decision-${payloadHash(decision)}`;
    if (!record.decisions.some(item => item.id === id)) {
      const result = record.results.find(item => item.id === decision.resultId);
      if (!result) throw new Error("INVALID_REFERENCE: decision result missing");
      record.decisions.push({ ...decision, id, fingerprint: result.fingerprint, legacy });
    }
  }
  record.statusReason = record.commands.some(item => item.status === "unknown") || record.recovery?.pending ? "delivery-unknown" : null;
  return record;
}

export function migrateV1(value: unknown, sourceSha256: string): RequestRecord {
  const old = legacyRecordSchema.parse(value);
  const record = recordSchema.parse({ ...old, schemaVersion: 2, revision: 1, updatedAt: new Date().toISOString(), confirmationSource: "legacy-execution", migration: { from: 1, at: new Date().toISOString(), sourceSha256, missingHistory: true } });
  captureHistory(record, true);
  if (old.recovery) record.commands.push({ key: old.recovery.key, kind: "resume", payloadHash: payloadHash({ instruction: old.recovery.instruction }), status: old.recovery.pending ? "unknown" : "applied", phase: "legacy-delivery", messageId: old.recovery.messageId, resourceIds: old.agentId ? { agentId: old.agentId } : {}, outcomeRef: `attempt:${old.attempt}`, createdAt: old.createdAt, resolvedAt: null });
  captureHistory(record, true);
  return record;
}

export function occupiesSlot(record: RequestRecord) {
  return !!record.recovery?.pending || record.commands.some(item => ["pending", "unknown"].includes(item.status)) || ["planned", "creating-worktree", "writing-plan", "starting-session", "started", "running", "needs-input", "validating"].includes(record.status);
}

export function assertAppendOnly(previous: RequestRecord, next: RequestRecord) {
  if (previous.confirmationSource === "confirmed-plan" && next.confirmationSource !== "confirmed-plan") throw new Error("IMMUTABLE_EXECUTION_INPUT");
  if (previous.confirmationSource === "confirmed-plan" && payloadHash({ feature: previous.feature, criteria: previous.criteria, checks: previous.checks, confirmedPlanRevision: previous.confirmedPlanRevision, projectSnapshot: previous.projectSnapshot, requestPlan: previous.requestPlan, taskPlan: previous.taskPlan }) !== payloadHash({ feature: next.feature, criteria: next.criteria, checks: next.checks, confirmedPlanRevision: next.confirmedPlanRevision, projectSnapshot: next.projectSnapshot, requestPlan: next.requestPlan, taskPlan: next.taskPlan })) throw new Error("IMMUTABLE_EXECUTION_INPUT");
  for (const field of ["results", "decisions", "plans"] as const) {
    for (const old of previous[field]) {
      const key = "id" in old ? old.id : old.revision;
      const entry = next[field].find(item => ("id" in item ? item.id : item.revision) === key);
      if (!entry || payloadHash(entry) !== payloadHash(old)) throw new Error(`IMMUTABLE_HISTORY: ${field}`);
    }
  }
  for (const old of previous.commands) {
    const entry = next.commands.find(item => item.key === old.key);
    if (!entry || entry.kind !== old.kind || entry.payloadHash !== old.payloadHash || entry.createdAt !== old.createdAt || (old.status === "applied" && payloadHash(entry) !== payloadHash(old))) throw new Error("IMMUTABLE_HISTORY: command");
  }
  for (const old of previous.attemptHistory) {
    const entry = next.attemptHistory.find(item => item.number === old.number);
    if (!entry || old.resultIds.some(id => !entry.resultIds.includes(id)) || old.trigger !== entry.trigger || old.instruction !== entry.instruction) throw new Error("IMMUTABLE_HISTORY: attempt");
  }
}

export function validateReferences(record: RequestRecord) {
  const unique = (values: (string | number)[]) => { if (new Set(values).size !== values.length) throw new Error("INVALID_REFERENCE: duplicate identity"); };
  unique(record.results.map(x => x.id)); unique(record.decisions.map(x => x.id)); unique(record.commands.map(x => x.key));
  unique(record.attemptHistory.map(x => x.number)); unique(record.plans.map(x => x.revision));
  for (const result of record.results) {
    if (!record.attemptHistory.some(x => x.number === result.attemptNumber && x.resultIds.includes(result.id))) throw new Error("INVALID_REFERENCE: result attempt");
  }
  for (const attempt of record.attemptHistory) for (const id of attempt.resultIds) {
    if (!record.results.some(x => x.id === id && x.attemptNumber === attempt.number)) throw new Error("INVALID_REFERENCE: attempt result");
  }
  for (const decision of record.decisions) if (!record.results.some(x => x.id === decision.resultId && x.fingerprint === decision.fingerprint)) throw new Error("INVALID_REFERENCE: review result");
}
