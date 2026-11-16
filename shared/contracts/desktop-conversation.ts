import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";
import { projectId, commandKey, hashSchema, instructionReport } from "./desktop-project";

export const conversationId = z.string().uuid();
export const conversationPolicy = z.object({ access: z.enum(["read-only", "workspace-write", "danger-full-access"]), approval: z.enum(["untrusted", "on-request", "never"]) }).strict();
export const conversationSelection = z.object({ provider: z.string().regex(/^codex\/.+$/), thinkingOptionId: z.string().nullable(), policy: conversationPolicy }).strict();
export const conversationAttention = z.object({ id: z.string(), hash: hashSchema, kind: z.string(), title: z.string(), details: z.string().max(30000), actions: z.array(z.object({ id: z.string(), label: z.string(), behavior: z.enum(["allow", "deny"]) })) });
export const conversationJournal = z.object({ key: commandKey, kind: z.enum(["permission", "stop"]), turnId: z.string().uuid(), payloadHash: hashSchema, requestId: z.string().nullable(), request: conversationAttention.nullable(), actionId: z.string().nullable(), behavior: z.enum(["allow", "deny"]).nullable(), at: z.string(), state: z.enum(["pending", "unknown", "sent", "observed"]) });
export const conversationTurn = z.object({
  id: z.string().uuid(), commandKey, messageId: z.string().uuid(), input: z.string().trim().min(1).max(12000),
  inputHash: hashSchema, createdAt: z.string(),
  state: z.enum(["accepted", "dispatching", "unknown", "running", "answered", "failed"]),
  response: z.string().max(200000).nullable(), failure: z.string().nullable(),
  completedAt: z.string().nullable(),
  receipt: z.object({ seq: z.number(), epoch: z.string() }).nullable().default(null),
});
export const conversationSchema = z.object({
  schemaVersion: z.literal(1), projectId, id: conversationId,
  revision: z.number().int().positive(), createdAt: z.string(),
  provider: z.string().regex(/^codex\/.+$/), thinkingOptionId: z.string().nullable(),
  policy: conversationPolicy, instructions: instructionReport,
  cwd: z.string(), createKey: commandKey, createHash: hashSchema,
  sessionState: z.enum(["accepted", "creating", "unknown", "ready"]),
  observationError: z.string().nullable(),
  journals: z.array(conversationJournal).max(1000),
  agentId: z.string().nullable(), turns: z.array(conversationTurn).max(100),
}).strict();
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationTurn = z.infer<typeof conversationTurn>;
const identity = { projectId, conversationId };
const command = { ...identity, commandKey, expectedRevision: z.number().int().nonnegative() };
export const conversationView = conversationSchema.omit({ instructions: true, turns: true, journals: true }).extend({ instructionFingerprint: hashSchema, turns: z.array(conversationTurn.omit({ input: true, response: true }).extend({ preview: z.string() })), journals: z.array(conversationJournal.omit({ request: true })) });
export function viewConversation(doc: Conversation): z.infer<typeof conversationView> {
  const { instructions, turns, journals, ...rest } = doc;
  return { ...rest, instructionFingerprint: instructions.fingerprint, turns: turns.map(({ input, response, ...turn }) => ({ ...turn, preview: input.slice(0, 160) })), journals: journals.map(({ request, ...journal }) => journal) };
}
export const conversationRpc = {
  "desktop.conversations.list": defineRpc({ name: "desktop.conversations.list", input: z.object({ projectId }).strict(), output: z.object({ issues: z.array(z.string()), records: z.array(z.object({ id: conversationId, title: z.string(), createdAt: z.string(), state: z.string() })) }) }),
  "desktop.conversations.create": defineRpc({ name: "desktop.conversations.create", input: z.object({ ...command, selection: conversationSelection }).strict(), output: conversationView }),
  "desktop.conversations.get": defineRpc({ name: "desktop.conversations.get", input: z.object(identity).strict(), output: conversationView }),
  "desktop.conversations.turn": defineRpc({ name: "desktop.conversations.turn", input: z.object({ ...identity, turnId: z.string().uuid() }).strict(), output: conversationTurn }),
  "desktop.conversations.send": defineRpc({ name: "desktop.conversations.send", input: z.object({ ...command, text: z.string().trim().min(1).max(12000) }).strict(), output: conversationView }),
  "desktop.conversations.attention": defineRpc({ name: "desktop.conversations.attention", input: z.object(identity).strict(), output: z.array(conversationAttention) }),
  "desktop.conversations.permission": defineRpc({ name: "desktop.conversations.permission", input: z.object({ ...command, requestId: z.string(), requestHash: hashSchema, actionId: z.string(), behavior: z.enum(["allow", "deny"]) }).strict(), output: conversationView }),
  "desktop.conversations.stop": defineRpc({ name: "desktop.conversations.stop", input: z.object(command).strict(), output: conversationView }),
} as const;
