import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { conversationSchema } from "../../shared/contracts/desktop-conversation";
import { acceptConversationTurn, markConversationDispatch, restoreConversation, assertConversationHistory } from "../domain/conversation";

const fixture = () => conversationSchema.parse({ schemaVersion: 1, projectId: randomUUID(), id: randomUUID(), revision: 1, createdAt: new Date().toISOString(), provider: "codex/test", thinkingOptionId: null, policy: { access: "read-only", approval: "on-request" }, cwd: "C:/fixture", createKey: "create-test-001", createHash: "a".repeat(64), sessionState: "accepted", observationError: null, journals: [], instructions: { files: [], fingerprint: "a".repeat(64), ready: true, issues: [] }, agentId: null, turns: [] });
test("conversation command replay keeps message identity, rejects changed payload and blocks overlapping turns", () => {
  const initial = fixture(), command = { commandKey: "conversation-key-001", expectedRevision: 1, text: "첫 질문" };
  const accepted = acceptConversationTurn(initial, command, initial.createdAt);
  assert.equal(initial.turns.length, 0);
  assert.deepEqual(acceptConversationTurn(accepted, command, initial.createdAt), accepted);
  assert.throws(() => acceptConversationTurn(accepted, { ...command, text: "다른 질문" }, initial.createdAt), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => acceptConversationTurn(accepted, { ...command, commandKey: "conversation-key-002", expectedRevision: accepted.revision }, initial.createdAt), /TURN_PENDING/);
});
test("restart after send intent is unknown and cannot redispatch even when receipt is absent", () => {
  const initial = fixture(), accepted = acceptConversationTurn(initial, { commandKey: "conversation-key-001", expectedRevision: 1, text: "질문" }, initial.createdAt);
  const sent = markConversationDispatch(accepted, accepted.turns[0].id), restored = restoreConversation(sent);
  assert.equal(restored.turns[0].state, "unknown");
  assert.equal(restored.turns[0].messageId, accepted.turns[0].messageId);
  assert.throws(() => markConversationDispatch(restored, restored.turns[0].id), /DISPATCH_NOT_ALLOWED/);
  assert.deepEqual(restoreConversation(restored), restored);
});
test("completed conversation turns and pinned instructions cannot be rewritten by a follow-up", () => {
  const initial = fixture(), answered = acceptConversationTurn(initial, { commandKey: "conversation-key-001", expectedRevision: 1, text: "질문" }, initial.createdAt);
  Object.assign(answered.turns[0], { state: "answered", response: "답변", completedAt: initial.createdAt });
  answered.agentId = "same-agent";
  const next = acceptConversationTurn(answered, { commandKey: "conversation-key-002", expectedRevision: answered.revision, text: "후속 질문" }, initial.createdAt);
  assertConversationHistory(answered, next);
  next.turns[0].response = "변조";
  assert.throws(() => assertConversationHistory(answered, next), /RESULT_CHANGED/);
  const changed = structuredClone(answered); changed.agentId = "new-agent";
  assert.throws(() => assertConversationHistory(answered, changed), /AGENT_CHANGED/);
});
