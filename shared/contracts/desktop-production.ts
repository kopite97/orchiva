import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { recordSchema, tokenSchema } from "./feature-request";
import { projectId, commandKey, hashSchema } from "./desktop-project";
import { mediaSpec } from "./desktop-media";

export const productionInput = z.object({ title: z.string().max(160), goal: z.string().max(12000), scope: z.string().max(12000), constraints: z.string().max(12000), discipline: z.enum(["planning", "coding", "art", "sound", "effect"]), media: mediaSpec.optional(), mode: z.enum(["new", "modify"]), parentToken: tokenSchema.nullable(), parentResultId: z.string().nullable(), provider: z.string().regex(/^codex\/.+$/), thinkingOptionId: z.string().nullable(), outputPath: z.string().max(200), validationProfile: z.enum(["files", "node-test"]).default("files") });
export const planVersion = z.object({ revision: z.number().int().positive(), path: z.string(), content: z.string(), hash: hashSchema, inputHash: hashSchema, snapshotId: hashSchema, createdAt: z.string(), origin: z.enum(["ai", "external", "legacy"]) });
const journal = z.object({ key: commandKey, kind: z.string(), payloadHash: hashSchema, state: z.enum(["pending", "applied", "failed", "unknown"]), phase: z.string(), outcome: z.string().nullable(), at: z.string() });
export const productionSchema = z.object({
  schemaVersion: z.literal(3), projectId, token: tokenSchema, revision: z.number().int().positive(), input: productionInput,
  planName: z.string(), planVersions: z.array(planVersion), engine: recordSchema,
  journals: z.array(journal), planning: z.object({ key: commandKey, agentId: z.string().nullable(), directory: z.string(), snapshotId: hashSchema, prompt: z.string(), state: z.enum(["pending", "running", "unknown", "failed", "complete"]), error: z.string().nullable() }).nullable(),
  documentIntent: z.object({ path: z.string(), before: hashSchema.nullable(), content: z.string() }).nullable(),
  legacy: z.object({ sourceHash: hashSchema, importedAt: z.string(), archiveOnly: z.literal(true) }).nullable(),
  reviews: z.array(z.object({ id: z.string(), resultId: z.string(), fingerprint: z.string(), approved: z.boolean(), qualityConfirmed: z.boolean(), checksAcknowledged: z.boolean(), note: z.string(), at: z.string() })),
  exports: z.array(z.object({ resultId: z.string(), root: z.string(), manifestHash: hashSchema, at: z.string() })),
});
export type Production = z.infer<typeof productionSchema>;
export type ProductionInput = z.infer<typeof productionInput>;
const id = { projectId, token: tokenSchema };
const command = { ...id, commandKey, expectedRevision: z.number().int().positive() };
export const modelList = z.object({ models: z.array(z.object({ provider: z.string(), label: z.string(), levels: z.array(z.object({ id: z.string(), label: z.string() })) })), ready: z.boolean(), issue: z.string().nullable() });
const transferResult = z.object({ key: z.string(), state: z.enum(["applying", "applied", "undoing", "undone"]), paths: z.array(z.string()), completed: z.array(z.string()), restored: z.array(z.string()) });
export const productionRpc = {
  "desktop.requests.media-preview": defineRpc({ name: "desktop.requests.media-preview", input: z.object({ ...id, resultId: z.string(), path: z.string(), offset: z.number().int().min(0).max(32 * 1024 * 1024) }).strict(), output: z.object({ path: z.string(), mime: z.string(), sha256: hashSchema, size: z.number(), offset: z.number(), content: z.string(), spec: mediaSpec }) }),
  "desktop.models": defineRpc({ name: "desktop.models", input: z.object({ projectId }).strict(), output: modelList }),
  "desktop.requests.list": defineRpc({ name: "desktop.requests.list", input: z.object({ projectId }).strict(), output: z.object({ records: z.array(z.object({ token: tokenSchema, input: z.object({ title: z.string() }), engine: z.object({ status: z.string(), result: z.object({ id: z.string() }).nullable() }), legacy: z.boolean() })), issues: z.array(z.string()) }) }),
  "desktop.requests.get": defineRpc({ name: "desktop.requests.get", input: z.object(id).strict(), output: productionSchema }),
  "desktop.requests.save": defineRpc({ name: "desktop.requests.save", input: z.object({ ...id, commandKey, expectedRevision: z.number().int().nonnegative(), input: productionInput }).strict(), output: productionSchema }),
  "desktop.requests.plan": defineRpc({ name: "desktop.requests.plan", input: z.object(command).strict(), output: productionSchema }),
  "desktop.requests.sync-plan": defineRpc({ name: "desktop.requests.sync-plan", input: z.object(command).strict(), output: productionSchema }),
  "desktop.requests.start": defineRpc({ name: "desktop.requests.start", input: z.object({ ...command, planHash: hashSchema }).strict(), output: productionSchema }),
  "desktop.requests.observe": defineRpc({ name: "desktop.requests.observe", input: z.object(id).strict(), output: productionSchema }),
  "desktop.requests.stop": defineRpc({ name: "desktop.requests.stop", input: z.object(command).strict(), output: productionSchema }),
  "desktop.requests.attention": defineRpc({ name: "desktop.requests.attention", input: z.object(id).strict(), output: z.array(z.object({ id: z.string(), hash: hashSchema, kind: z.string(), title: z.string(), details: z.string(), actions: z.array(z.object({ id: z.string(), label: z.string(), behavior: z.enum(["allow", "deny"]) })) })) }),
  "desktop.requests.permission": defineRpc({ name: "desktop.requests.permission", input: z.object({ ...command, requestId: z.string(), requestHash: hashSchema, actionId: z.string(), behavior: z.enum(["allow", "deny"]) }).strict(), output: productionSchema }),
  "desktop.requests.resume": defineRpc({ name: "desktop.requests.resume", input: z.object({ ...command, resultId: z.string().nullable(), instruction: z.string().min(1).max(12000) }).strict(), output: productionSchema }),
  "desktop.requests.revalidate": defineRpc({ name: "desktop.requests.revalidate", input: z.object({ ...command, resultId: z.string().nullable() }).strict(), output: productionSchema }),
  "desktop.requests.reconcile": defineRpc({ name: "desktop.requests.reconcile", input: z.object({ ...command, targetCommandKey: z.string() }).strict(), output: productionSchema }),
  "desktop.requests.retry": defineRpc({ name: "desktop.requests.retry", input: z.object({ ...command, targetCommandKey: z.string() }).strict(), output: productionSchema }),
  "desktop.requests.review": defineRpc({ name: "desktop.requests.review", input: z.object({ ...command, resultId: z.string(), approved: z.boolean(), qualityConfirmed: z.boolean(), checksAcknowledged: z.boolean(), note: z.string().max(4000) }).strict(), output: productionSchema }),
  "desktop.requests.export": defineRpc({ name: "desktop.requests.export", input: z.object({ ...command, resultId: z.string() }).strict(), output: productionSchema }),
  "desktop.requests.diff": defineRpc({ name: "desktop.requests.diff", input: z.object({ ...id, resultId: z.string() }).strict(), output: z.object({ files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable(), current: z.string().nullable(), conflict: z.boolean(), beforeText: z.string().nullable(), afterText: z.string().nullable() })) }) }),
  "desktop.requests.apply": defineRpc({ name: "desktop.requests.apply", input: z.object({ ...command, resultId: z.string(), paths: z.array(z.string()).min(1).max(300) }).strict(), output: transferResult }),
  "desktop.requests.undo": defineRpc({ name: "desktop.requests.undo", input: z.object({ ...id, resultId: z.string(), transferKey: commandKey }).strict(), output: transferResult }),
  "desktop.requests.transfers": defineRpc({ name: "desktop.requests.transfers", input: z.object({ ...id, resultId: z.string() }).strict(), output: z.array(transferResult) }),
  "desktop.requests.import-legacy": defineRpc({ name: "desktop.requests.import-legacy", input: z.object({ projectId, token: tokenSchema, commandKey }).strict(), output: productionSchema }),
} as const;
