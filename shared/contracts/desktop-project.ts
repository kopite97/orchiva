import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";

export const projectId = z.string().uuid();
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const commandKey = z.string().regex(/^[a-zA-Z0-9-]{8,80}$/);
export const projectSchema = z.object({ schemaVersion: z.literal(1), projectId, name: z.string().min(1).max(160), revision: z.number().int().positive(), templateVersion: z.literal(1), baseRef: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/), outputRoot: z.string().nullable(), instructionRefs: z.array(z.object({ path: z.string(), scope: z.string(), required: z.boolean() })).max(100) });
export type DesktopProject = z.infer<typeof projectSchema>;
export const projectView = z.object({ projectId, name: z.string(), sourceRoot: z.string(), initialized: z.boolean(), available: z.boolean(), config: projectSchema.nullable(), issue: z.string().nullable() });
export const initChange = z.object({ path: z.string(), before: hashSchema.nullable(), content: z.string().nullable(), reason: z.string() });
export const initialization = z.object({ projectId, fingerprint: hashSchema, changes: z.array(initChange), issues: z.array(z.string()) });
export const instructionFile = z.object({ path: z.string(), scope: z.string(), required: z.boolean(), exists: z.boolean(), hash: hashSchema.nullable(), content: z.string().nullable(), issue: z.string().nullable() });
export const instructionReport = z.object({ files: z.array(instructionFile), fingerprint: hashSchema, ready: z.boolean(), issues: z.array(z.string()) });
const projectInput = z.object({ projectId }).strict();
export const projectsRpc = {
  "desktop.projects.list": defineRpc({ name: "desktop.projects.list", input: z.object({}).strict(), output: z.array(projectView) }),
  "desktop.projects.register": defineRpc({ name: "desktop.projects.register", input: z.object({ sourceRoot: z.string().min(1), name: z.string().min(1).max(160) }).strict(), output: projectView }),
  "desktop.projects.preview": defineRpc({ name: "desktop.projects.preview", input: projectInput, output: initialization }),
  "desktop.projects.initialize": defineRpc({ name: "desktop.projects.initialize", input: z.object({ projectId, fingerprint: hashSchema, commandKey }).strict(), output: projectView }),
  "desktop.projects.configure": defineRpc({ name: "desktop.projects.configure", input: z.object({ projectId, expectedRevision: z.number().int(), name: z.string().min(1).max(160), baseRef: z.string().min(1), outputRoot: z.string().nullable() }).strict(), output: projectView }),
  "desktop.instructions.read": defineRpc({ name: "desktop.instructions.read", input: projectInput, output: instructionReport }),
  "desktop.instructions.save": defineRpc({ name: "desktop.instructions.save", input: z.object({ projectId, path: z.string(), expectedHash: hashSchema.nullable(), content: z.string().max(200000), scope: z.string().max(200).default("all") }).strict(), output: instructionReport }),
} as const;
