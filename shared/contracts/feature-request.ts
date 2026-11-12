import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
const field = z.string().trim().min(1).max(12000);
export const featureSchema = z.object({ title: field.max(160), goal: field, scope: field, constraints: field, validation: field, completionCriteria: field });
export const tokenSchema = z.string().regex(/^[a-zA-Z0-9-]{8,80}$/);
const relativePath = z.string().min(1).max(200).refine(value => !value.includes("..") && !/^[\\/]|[:\x00-\x1f]/.test(value), "Use a worktree-relative path without '..'.");
export const checkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node-test"), path: relativePath, label: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("file-contains"), path: relativePath, text: z.string().min(1).max(4000), label: z.string().min(1).max(200) }),
]);
export const startSchema = z.object({ token: tokenSchema, feature: featureSchema, checks: z.array(checkSchema).max(8).default([]) });
export const statusSchema = z.enum(["planned", "creating-worktree", "writing-plan", "starting-session", "started", "running", "needs-input", "validating", "awaiting-review", "completed", "failed"]);
export const resultSchema = z.object({
  id: z.string(), sourceKey: z.string(), collectedAt: z.string(), finalResponse: z.string(), agentStatus: z.string(),
  changedFiles: z.array(z.string()), diffStat: z.string(), fingerprint: z.string(),
  checks: z.array(z.object({ label: z.string(), command: z.string(), passed: z.boolean(), exitCode: z.number().nullable(), output: z.string(), durationMs: z.number() })),
  failure: z.string().nullable(), executionFailure: z.string().nullable().default(null),
});
const planSchema = z.object({ id: z.string(), ownerType: z.enum(["request", "task"]), ownerId: z.string(), revision: z.number(), content: z.string() });
export const legacyRecordSchema = z.object({
  token: tokenSchema, id: z.string(), taskId: z.string(), createdAt: z.string(), feature: featureSchema,
  status: statusSchema, error: z.string().nullable(), requestPlan: planSchema, taskPlan: planSchema,
  workspaceId: z.string().nullable(), worktreePath: z.string().nullable(), agentId: z.string().nullable(),
  checks: z.array(checkSchema).default([]), attempt: z.number().int().positive().default(1),
  result: resultSchema.nullable().default(null),
  attempts: z.array(z.object({ attempt: z.number(), result: resultSchema.nullable(), error: z.string().nullable() })).default([]),
  events: z.array(z.object({ at: z.string(), status: statusSchema, detail: z.string() })).default([]),
  observationError: z.string().nullable().default(null),
  recovery: z.object({ key: tokenSchema, instruction: z.string(), messageId: z.string(), pending: z.boolean() }).nullable().default(null),
  decision: z.object({ approved: z.boolean(), note: z.string(), at: z.string(), resultId: z.string() }).nullable().default(null),
});
export const commandSchema = z.object({
  key: z.string().min(1), kind: z.enum(["start", "resume", "review", "revalidate"]), payloadHash: z.string(),
  status: z.enum(["pending", "applied", "failed", "unknown"]), phase: z.string(),
  messageId: z.string().nullable().default(null), resourceIds: z.record(z.string(), z.string()).default({}),
  outcomeRef: z.string().nullable().default(null), createdAt: z.string(), resolvedAt: z.string().nullable().default(null),
});
export const storedResultSchema = resultSchema.extend({ attemptNumber: z.number().int().positive(), validationRun: z.number().int().positive(), legacy: z.boolean() });
export const storedDecisionSchema = z.object({ id: z.string(), resultId: z.string(), approved: z.boolean(), note: z.string(), at: z.string(), fingerprint: z.string(), legacy: z.boolean() });
export const recordSchema = legacyRecordSchema.extend({
  schemaVersion: z.literal(2).default(2), revision: z.number().int().nonnegative().default(0), updatedAt: z.string().default(""),
  criteria: z.array(z.object({ id: z.string(), text: z.string(), checkIds: z.array(z.string()), manualMethod: z.string(), legacy: z.boolean() })).default([]),
  plans: z.array(z.object({ revision: z.number().int().positive(), inputHash: z.string(), requestPlan: planSchema, taskPlan: planSchema, baseCommit: z.string().nullable(), createdAt: z.string() })).default([]),
  confirmationSource: z.enum(["legacy-execution", "poc-direct", "confirmed-plan"]).nullable().default(null),
  confirmedPlanRevision: z.number().int().positive().nullable().default(null),
  projectSnapshot: z.object({ repositoryPath: z.string(), baseRef: z.string(), provider: z.string(), maxActiveTasks: z.literal(1) }).nullable().default(null),
  results: z.array(storedResultSchema).default([]), decisions: z.array(storedDecisionSchema).default([]),
  attemptHistory: z.array(z.object({ number: z.number().int().positive(), trigger: z.enum(["initial", "resume", "legacy"]), instruction: z.string().nullable(), resultIds: z.array(z.string()) })).default([]),
  commands: z.array(commandSchema).default([]), statusReason: z.string().nullable().default(null),
  migration: z.object({ from: z.literal(1), at: z.string(), sourceSha256: z.string(), missingHistory: z.literal(true) }).nullable().default(null),
});
export type Feature = z.infer<typeof featureSchema>;
export type RequestRecord = z.infer<typeof recordSchema>;
export const startRpc = defineRpc({ name: "request.start", input: startSchema, output: recordSchema });
export const listRpc = defineRpc({ name: "request.list", input: z.object({}), output: z.array(recordSchema) });
export const configRpc = defineRpc({ name: "project.read", input: z.object({}), output: z.object({ name: z.string(), repositoryPath: z.string(), baseRef: z.string(), provider: z.string() }) });
export type Check = z.infer<typeof checkSchema>;
export type ExecutionResult = z.infer<typeof resultSchema>;
export const resumeSchema = z.object({ token: tokenSchema, key: tokenSchema, instruction: z.string().trim().min(1).max(12000), expectedRevision: z.number().int().nonnegative().optional() });
export const resumeRpc = defineRpc({ name: "request.resume", input: resumeSchema, output: recordSchema });
export const reviewSchema = z.object({ token: tokenSchema, resultId: z.string(), approved: z.boolean(), note: z.string().trim().min(1).max(4000), commandKey: tokenSchema.optional(), expectedRevision: z.number().int().nonnegative().optional() });
export const reviewRpc = defineRpc({ name: "request.review", input: reviewSchema, output: recordSchema });
export const refreshRpc = defineRpc({ name: "request.refresh", input: z.object({ token: tokenSchema, revalidate: z.boolean().optional() }), output: recordSchema });
export const storageDiagnosticsSchema = z.object({ records: z.number(), bytes: z.number(), results: z.number(), decisions: z.number(), issues: z.array(z.object({ file: z.string(), code: z.string() })), activeTokens: z.array(z.string()) });
export const diagnosticsRpc = defineRpc({ name: "storage.diagnostics", input: z.object({}), output: storageDiagnosticsSchema });
export const revalidateSchema = z.object({ token: tokenSchema, resultId: z.string(), commandKey: tokenSchema, expectedRevision: z.number().int().nonnegative() });
export const revalidateRpc = defineRpc({ name: "request.revalidate", input: revalidateSchema, output: recordSchema });
