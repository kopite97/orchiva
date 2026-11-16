import { randomUUID } from "node:crypto";
import type { Conversation, ConversationTurn } from "../../shared/contracts/desktop-conversation";
import { payloadHash } from "./record-v2";

export const activeConversationTurn = (turn: ConversationTurn) => !["answered", "failed"].includes(turn.state);

/** Pure command acceptance. The caller persists the returned intent before dispatch. */
export function acceptConversationTurn(document: Conversation, command: { commandKey: string; expectedRevision: number; text: string }, at: string): Conversation {
  const text = command.text.trim();
  if (!text || text.length > 12000) throw new Error("CONVERSATION_INPUT_INVALID");
  const inputHash = payloadHash({ text });
  const previous = document.turns.find(t => t.commandKey === command.commandKey);
  if (previous) {
    if (previous.inputHash !== inputHash) throw new Error("IDEMPOTENCY_CONFLICT");
    return structuredClone(document);
  }
  if (document.revision !== command.expectedRevision) throw new Error("REVISION_CONFLICT");
  if (document.turns.some(activeConversationTurn)) throw new Error("CONVERSATION_TURN_PENDING");
  if (document.turns.length >= 100) throw new Error("CONVERSATION_TURN_LIMIT");
  const next = structuredClone(document);
  if (document.journals.some(j => j.key === command.commandKey) || document.createKey === command.commandKey) throw new Error("IDEMPOTENCY_CONFLICT");
  next.turns.push({ id: randomUUID(), commandKey: command.commandKey, messageId: randomUUID(), input: text, inputHash, createdAt: at, state: "accepted", response: null, failure: null, completedAt: null, receipt: null });
  next.revision++;
  return next;
}

/** Absence from a timeline is not permission to send again. */
export function markConversationDispatch(document: Conversation, turnId: string): Conversation {
  const next = structuredClone(document), turn = next.turns.find(t => t.id === turnId);
  if (!turn || turn.state !== "accepted") throw new Error("CONVERSATION_DISPATCH_NOT_ALLOWED");
  turn.state = "dispatching"; next.revision++;
  return next;
}

export function restoreConversation(document: Conversation): Conversation {
  const next = structuredClone(document);
  let changed = false;
  for (const turn of next.turns) if (turn.state === "dispatching") { turn.state = "unknown"; changed = true; }
  if (changed) next.revision++;
  return next;
}

export function assertConversationHistory(before: Conversation, after: Conversation) {
  for (const key of ["id", "projectId", "provider", "thinkingOptionId", "policy", "instructions", "createdAt", "cwd", "createKey", "createHash"] as const)
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error("CONVERSATION_IDENTITY_CHANGED");
  if (before.agentId && before.agentId !== after.agentId) throw new Error("CONVERSATION_AGENT_CHANGED");
  if (after.turns.length < before.turns.length) throw new Error("CONVERSATION_HISTORY_REMOVED");
  before.turns.forEach((turn, index) => {
    const next = after.turns[index];
    for (const key of ["id", "commandKey", "messageId", "input", "inputHash", "createdAt"] as const)
      if (turn[key] !== next[key]) throw new Error("CONVERSATION_INPUT_CHANGED");
    if (!activeConversationTurn(turn) && JSON.stringify(turn) !== JSON.stringify(next)) throw new Error("CONVERSATION_RESULT_CHANGED");
    if (turn.receipt && JSON.stringify(turn.receipt) !== JSON.stringify(next.receipt)) throw new Error("CONVERSATION_RECEIPT_CHANGED");
    if (turn.state !== "accepted" && next.state === "accepted") throw new Error("CONVERSATION_DISPATCH_NOT_ALLOWED");
  });
  if (after.journals.length < before.journals.length) throw new Error("CONVERSATION_HISTORY_REMOVED");
  before.journals.forEach((journal, i) => {
    const { state, ...fixed } = journal, { state: nextState, ...nextFixed } = after.journals[i];
    if (JSON.stringify(fixed) !== JSON.stringify(nextFixed) || (state === "observed" && nextState !== state)) throw new Error("IMMUTABLE_COMMAND");
  });
}
