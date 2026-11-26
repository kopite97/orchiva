import { z } from "zod";
import { commandKey, hashSchema, projectId } from "./desktop-project";

const path = z.string().min(1).max(240);
export const acceptanceProfile = z.object({
  version: z.literal(1),
  pipeline: z.literal("unity-level-v1"),
  roles: z.array(z.object({
    role: z.string().regex(/^[A-Za-z][\w-]{0,63}$/),
    tool: z.enum(["planning", "coding", "level", "qa", "art", "sound", "vfx"]),
    outputs: z.array(path).min(1).max(50),
    checks: z.array(path).min(1).max(8)
  }).strict()).min(1).max(32)
}).strict();
export const phaseDecision = z.object({
  projectId, runId:commandKey, phase:z.string(), next:z.string().nullable(), basis:hashSchema,
  sha:z.string(), buildHash:hashSchema, playerHash:hashSchema, attempt:z.string().uuid(),
  verdict:z.enum(["approve","reject"]), note:z.string().trim().min(1).max(2000),
  roadmapRevision:hashSchema,
  sources:z.array(z.object({featureId:z.string(),token:commandKey,resultId:z.string(),fingerprint:z.string()})).max(300),
  at:z.string(), commandKey
});
export const decidePhase = phaseDecision.pick({projectId:true,runId:true,basis:true,verdict:true,note:true,commandKey:true});
export const phaseReview = z.object({
  eligible:z.boolean(), reason:z.string(), basis:hashSchema.optional(), sha:z.string().optional(),
  buildHash:hashSchema.optional(), playerHash:hashSchema.optional(), next:z.string().nullable(),
  level:z.object({name:z.string(),moves:z.number(),collected:z.number(),cleared:z.boolean()}).optional(),
  artifact:z.string().optional(), elapsedMs:z.number(), calls:z.number(), decisions:z.array(phaseDecision)
});
export type PhaseReview=z.infer<typeof phaseReview>;
export type PhaseDecision=z.infer<typeof phaseDecision>;
