import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { configRpc, pageRpc, detailRpc, serviceStatusRpc, diagnosticsRpc } from "./feature-request";
import { projectsRpc } from "./desktop-project";
import { roadmapRpc } from "./milestone-roadmap";
import { productionRpc } from "./desktop-production";
import { conversationRpc } from "./desktop-conversation";

import { runRpc } from "./milestone-run";

import { integrationRpc } from "./milestone-integration";
export const protocolVersion = 1;
export const maxFrameBytes = 1024 * 1024;
export const runtimeInfoSchema = z.object({ protocolVersion: z.literal(1), serverVersion: z.enum(["desktop-d1", "desktop-d3", "desktop-d4", "desktop-d5"]), dataHome: z.string(), paseoHome: z.string(), endpoint: z.string(), isolated: z.boolean(), pid: z.number(), startedAt: z.string(), capabilities: z.array(z.string()), restoring: z.boolean() });
export const runtimeInfoRpc = defineRpc({ name: "runtime.info", input: z.object({}).strict(), output: runtimeInfoSchema });
export const readContracts = { "runtime.info": runtimeInfoRpc, "project.read": configRpc, "request.page": pageRpc, "request.detail": detailRpc, "runtime.status": serviceStatusRpc, "storage.diagnostics": diagnosticsRpc } as const;
export type ReadMethod = keyof typeof readContracts;
export const desktopContracts = { ...readContracts, ...projectsRpc, ...productionRpc, ...roadmapRpc, ...runRpc, ...integrationRpc, ...conversationRpc } as const;
export const envelopeSchema = z.object({ protocolVersion: z.literal(1), id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), method: z.string(), params: z.unknown() }).strict();
