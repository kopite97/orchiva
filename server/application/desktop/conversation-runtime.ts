import type { z } from "zod";
import type { Conversation, ConversationTurn, conversationAttention } from "../../../shared/contracts/desktop-conversation";
export type ConversationAttention = z.infer<typeof conversationAttention>;
export type ConversationObservation = { receipt: ConversationTurn["receipt"]; state: "unknown" | "running" | "answered" | "failed"; response: string | null; failure: string | null };
export interface ConversationRuntime {
  create(doc: Conversation): Promise<void>;
  exists(doc: Conversation): Promise<boolean>;
  prepare(doc: Conversation): Promise<void>;
  send(doc: Conversation, turn: ConversationTurn): Promise<"sent" | "not-started">;
  observe(doc: Conversation, turn: ConversationTurn): Promise<ConversationObservation>;
  attention(doc: Conversation): Promise<ConversationAttention[]>;
  permission(doc: Conversation, requestId: string, actionId: string, behavior: "allow" | "deny"): Promise<void>;
  stop(doc: Conversation): Promise<void>;
}
