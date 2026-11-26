import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { commandKey, hashSchema, projectId } from "./desktop-project";
import { itemId, scopeSchema, selectionSchema } from "./milestone-roadmap";

import { settings } from "./milestone-integration";

import { decidePhase, phaseReview } from "./phase-acceptance";
export const unityProfileId=z.literal("hud-win64-v1");
export const unityCheck=z.enum(["HudRulesTests.ApprovedAward","HudRulesTests.ApprovedLabel"]);
export const unityEvidence=z.object({
  attempt:z.string().uuid(),feature:itemId,milestone:itemId,sha:z.string().regex(/^[a-f0-9]{40}$/),kind:z.enum(["plan","integration"]),
  status:z.enum(["running","passed","failed","blocked"]),reason:z.string(),directory:z.string(),playerHash:hashSchema.optional(),hud:z.string().optional()
});
export type UnityEvidence=z.infer<typeof unityEvidence>;
const file = z.object({ path: z.string(), hash: hashSchema.nullable() });
export const binding = z.object({
  runId: commandKey, milestone: itemId, item: itemId, scopeHash: hashSchema, coordinator: z.boolean(),
  unityProfile:unityProfileId.optional(), readPaths:z.array(z.string()).optional(), generation:z.number().int().positive().optional(), integrationBase:z.string().regex(/^[a-f0-9]{40}$/).optional(), sectionOnly:z.array(z.string()).optional(), brief: z.string().max(240000).optional(), outputs: z.array(z.string()), checks: z.array(z.object({ path: z.string(), hash: hashSchema })), inputs: z.array(file),
});
export type Binding = z.infer<typeof binding>;
const node = z.object({
  lease:z.object({generation:z.number().int().positive(),base:z.string().regex(/^[a-f0-9]{40}$/),resources:z.array(z.string()),inputs:z.array(file),at:z.string()}).optional(),
  worker:z.object({workspace:z.string().nullable(),session:z.string().nullable(),started:z.string().nullable(),ended:z.string().nullable()}).optional(),
  parked:z.literal(true).optional(), waitReason:z.string().optional(), integrationSha:z.string().optional(),
  id: itemId, milestone: itemId, token: commandKey, status: z.string(), resultId: z.string().nullable(),
  fingerprint: z.string().nullable(), files: z.array(file), transfers: z.array(commandKey)
});
const advisor = z.object({
  milestone: itemId, token: commandKey, status: z.enum(["pending", "skipped", "accepted", "blocked"]), report: z.string(), planHash: hashSchema.nullable(),
  priorHandoffs:z.array(z.object({token:commandKey,revision:hashSchema,planHash:hashSchema,verdict:z.enum(["accepted","blocked"])})).optional(),
  handoff: z.object({ token: commandKey, revision: hashSchema, verdict: z.enum(["accepted", "blocked"]), report: z.string(), planHash: hashSchema }).optional()
});
export const runView = z.object({
  unityProfile:unityProfileId.optional(), unityEvidence:z.array(unityEvidence).optional(),
  workers:z.literal(2).optional(), failurePolicy:z.enum(['pause','continue-independent']).optional(), integration:settings.optional(), integrationInitial:z.string().regex(/^[a-f0-9]{40}$/).optional(),
  projectId, runId: commandKey, revision: z.number().int().positive(), scopeHash: hashSchema, parent: commandKey.nullable(),
  selection: selectionSchema, state: z.enum(["active", "paused", "completed", "cancelled"]), reason: z.string(), nodes: z.array(node), advisors: z.array(advisor)
});
export const runRecord = runView.extend({
  version: z.literal(1), scope: scopeSchema, provider: z.string(), thinkingOptionId: z.string().nullable(),
  history: z.array(z.object({ at: z.string(), event: z.string() })), commands: z.array(z.object({ key: commandKey, hash: hashSchema }))
});
export type Run = z.infer<typeof runRecord>;
const base = z.object({ projectId, runId: commandKey });
export const createRun = base.extend({ unityProfile:unityProfileId.optional(),workers:z.literal(2).optional(), failurePolicy:z.enum(['pause','continue-independent']).optional(), integration:settings.optional(), selection: selectionSchema, scopeHash: hashSchema, provider: z.string().regex(/^codex\/.+$/), thinkingOptionId: z.string().nullable(), parent: commandKey.nullable().default(null) });
export const controlRun = base.extend({ commandKey, expectedRevision: z.number().int().positive(), action: z.enum(["pause", "resume", "cancel"]) });
export const requestUnity=base.extend({feature:itemId,kind:z.enum(["plan","integration"]),expectedSha:z.string().regex(/^[a-f0-9]{40}$/),commandKey});
export const runRpc = {
  "desktop.runs.phase":defineRpc({name:"desktop.runs.phase",input:base,output:phaseReview}),
  "desktop.runs.decide":defineRpc({name:"desktop.runs.decide",input:decidePhase,output:phaseReview}),
  "desktop.runs.unity":defineRpc({name:"desktop.runs.unity",input:requestUnity,output:unityEvidence}),
  "desktop.runs.create": defineRpc({ name: "desktop.runs.create", input: createRun, output: runView }),
  "desktop.runs.get": defineRpc({ name: "desktop.runs.get", input: base, output: runView }),
  "desktop.runs.list": defineRpc({ name: "desktop.runs.list", input: z.object({ projectId }), output: z.array(z.union([runView.pick({runId:true,state:true,selection:true}),z.object({runId:z.string(),state:z.literal("invalid"),issue:z.literal("MILESTONE_RUN_INVALID")})])) }),
  "desktop.runs.control": defineRpc({ name: "desktop.runs.control", input: controlRun, output: runView }),
};
