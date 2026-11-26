import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { projectId, commandKey, hashSchema } from "./desktop-project";
import { itemId } from "./milestone-roadmap";

const branchName = (limit: number) => z.string().min(1).max(limit).regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/).refine(s => !s.endsWith("/") && !s.includes("//"));
const branch = branchName(150);
export const settings = z.object({
  mode: z.enum(["local", "github"]), target: branch, headPrefix: branch.default("feature"),
  github: z.object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), repoId: z.number().int().positive(), base: branch,
    checks: z.array(z.string().trim().min(1).max(100)).max(20)
  }).optional()
}).strict().refine(p => p.mode !== "github" || !!p.github?.checks.length, "Required checks missing");
export type Settings = z.infer<typeof settings>;
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const remote = z.object({
  body: z.string(), lastBody: z.string().nullable(), remoteBody: z.string().nullable(), issue: z.number().nullable(), pr: z.number().nullable(),
  base: sha.nullable(), head: sha.nullable(), merge: sha.nullable(),
  protectedChecks: z.array(z.string().min(1)).min(1).optional(),
  refresh: z.object({ base: sha, head: sha }).optional(),
  gate: z.object({ mode: z.enum(["owner", "independent"]).optional(), actor: z.number().int(), reviewers: z.array(z.string()), head: sha, base: sha, checks: z.array(z.string()), at: z.string() }).optional(), lastError: z.string().optional(), versions: z.array(z.object({ hash: hashSchema, at: z.string(), origin: z.enum(["local", "github"]) })).optional(), phase: z.string(), pending: z.string().nullable()
});
export type Remote = z.infer<typeof remote>;
const entry = z.object({
  feature: itemId, token: commandKey, result: z.string(), fingerprint: z.string(), manifest: hashSchema, planHash: hashSchema, review: z.string(),
  base: sha, head: sha.nullable(), integrated: sha.nullable(), branch: branchName(320), remote: remote.optional()
});
export type Entry = z.infer<typeof entry>;
export const integrationRecord = z.object({ version: z.literal(1), projectId, runId: commandKey, scopeHash: hashSchema, initial: sha, settings, entries: z.array(entry) });
export type Integration = z.infer<typeof integrationRecord>;
const run = z.object({ projectId, runId: commandKey });
export const publication = run.extend({ feature: itemId, action: z.enum(["publish", "observe", "merge", "owner-merge", "refresh-base", "adopt", "overwrite"]), body: z.string().trim().min(1).max(24000), observedHash: hashSchema.optional(), expectedHead: sha.optional() });
export const integrationRpc = {
  "desktop.integration.policy": defineRpc({ name: "desktop.integration.policy", input: z.object({ projectId }), output: settings.nullable() }),
  "desktop.integration.get": defineRpc({ name: "desktop.integration.get", input: run, output: integrationRecord.nullable() }),
  "desktop.integration.configure": defineRpc({ name: "desktop.integration.configure", input: run.extend({ settings }), output: integrationRecord }),
  "desktop.integration.advance": defineRpc({ name: "desktop.integration.advance", input: run, output: integrationRecord }),
  "desktop.integration.sync": defineRpc({ name: "desktop.integration.sync", input: publication, output: integrationRecord }),
};
