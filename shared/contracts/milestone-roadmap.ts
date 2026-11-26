import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { hashSchema, projectId } from "./desktop-project";
import { tokenSchema } from "./feature-request";

export const itemId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
import { acceptanceProfile } from "./phase-acceptance";
const path = z.string().min(1).max(240);
export const feature = z.object({
  id: itemId, title: z.string().min(1).max(160), goal: z.string().min(1).max(4000),
  discipline: z.enum(["planning", "coding"]).default("coding"), role: itemId.default("developer"),
  dependsOn: z.array(itemId).max(100).default([]), outputs: z.array(path).min(1).max(50),
  unityTests:z.array(z.enum(["HudRulesTests.ApprovedAward","HudRulesTests.ApprovedLabel"])).min(1).max(2).optional(),
  resources: z.array(z.string().min(1).max(160)).max(40).optional(), priority:z.number().int().min(0).max(100).optional(),
  references: z.array(path).max(40).default([]), checks: z.array(path).max(8).default([]),
}).strict();
export const roadmapSchema = z.object({
  version: z.literal(1), acceptance: acceptanceProfile.optional(), engine: itemId.optional(),
  phases: z.array(z.object({ id: itemId, milestones: z.array(z.object({
    id: itemId, features: z.array(feature).max(100),
  }).strict()).max(60) }).strict()).max(30),
  evidence: z.array(z.object({ featureId: itemId, token: tokenSchema, resultId: z.string().min(1), fingerprint: z.string().min(1) }).strict()).max(100).default([]),
}).strict();
export type Roadmap = z.infer<typeof roadmapSchema>;
export type Feature = z.infer<typeof feature>;
export const selectionSchema = z.object({ phase: itemId, first: itemId, last: itemId });
export type Selection = z.infer<typeof selectionSchema>;
export const contextFile = z.object({ path, hash: hashSchema, content: z.string(), sameContentAs: path.optional() });
export const excerpt = z.object({ reference:path, path, hash:hashSchema, content:z.string() });
export const scopeSchema = z.object({
  acceptance: acceptanceProfile.optional(), projectId, revision: hashSchema, baseCommit: z.string(), selection: selectionSchema,
  milestones: z.array(itemId), nodes: z.array(feature.extend({ milestone: itemId, context: z.array(path) })),
  files: z.array(contextFile), excerpts:z.array(excerpt).optional(), external: roadmapSchema.shape.evidence,
  issues: z.array(z.string()), hash: hashSchema,
});
export type Scope = z.infer<typeof scopeSchema>;
const document = z.object({ revision: hashSchema.nullable(), roadmap: roadmapSchema });
const input = z.object({ projectId });
export const roadmapRpc = {
  "desktop.roadmap.read": defineRpc({ name: "desktop.roadmap.read", input, output: document }),
  "desktop.roadmap.save": defineRpc({ name: "desktop.roadmap.save", input: input.extend({ expectedRevision: hashSchema.nullable(), roadmap: roadmapSchema }), output: document }),
  "desktop.roadmap.preview": defineRpc({ name: "desktop.roadmap.preview", input: input.extend({ selection: selectionSchema }), output: scopeSchema }),
};
