import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import { Projects } from "../application/desktop/projects";
import { ProductionService } from "../application/desktop/production";
import { Conversations } from "../application/desktop/conversations";
import { JsonRequestStore } from "../adapters/storage/json-request-store";
import { acceptConversationTurn } from "../domain/conversation";
import type { ConversationRuntime, ConversationObservation, ConversationAttention } from "../application/desktop/conversation-runtime";
import type { Conversation, ConversationTurn } from "../../shared/contracts/desktop-conversation";
import { conversationOptions, PaseoConversationRuntime } from "../adapters/paseo/conversation-runtime";
import { viewConversation } from "../../shared/contracts/desktop-conversation";
class Runtime implements ConversationRuntime {
  creates = 0; sends = 0; replies = 0; stops = 0; created = false; lostCreate = false; lostSend = false; lostReply = false; terminal = false; absent = false;
  requests: ConversationAttention[] = [];
  async create() { this.creates++; this.created = true; if (this.lostCreate) throw new Error("lost"); }
  async exists() { return this.created; }
  async prepare() {}
  async send() { this.sends++; if (this.lostSend) throw new Error("lost"); return "sent" as const; }
  async observe(_doc: Conversation, turn: ConversationTurn): Promise<ConversationObservation> { return { receipt: this.absent ? null : { epoch: "epoch", seq: 3 }, state: this.absent ? "unknown" : this.terminal ? "answered" : "running", response: this.terminal ? "대답" : null, failure: null }; }
  async attention() { return this.requests; }
  async permission() { this.replies++; if (this.lostReply) throw new Error("lost"); this.requests = []; }
  async stop() { this.stops++; this.terminal = true; }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orchiva-d4-")), source = join(root, "소스"); await mkdir(source);
  const projects = new Projects(join(root, "registry")), legacy = new JsonRequestStore(join(root, "legacy")); await legacy.open();
  const p = await projects.register(source, "대화 시험"), preview = await projects.preview(p.projectId); await projects.initialize(p.projectId, preview.fingerprint, "initialize-d4-test");
  const api = { providers: { listModels: async () => ({ models: [{ id: "test", label: "Test", thinkingOptions: [] }] }) } } as unknown as PaseoApi;
  const production = new ProductionService(projects, legacy, async () => api), runtime = new Runtime(); let service = new Conversations(production, runtime);
  const identity = { projectId: p.projectId, conversationId: randomUUID() }, create = { ...identity, expectedRevision: 0, commandKey: "create-d4-test", selection: { provider: "codex/test", thinkingOptionId: null, policy: { access: "read-only" as const, approval: "on-request" as const } } };
  const doc = await service.create(create);
  return { root, source, production, runtime, identity, create, doc, get service() { return service; }, async restart() { await service.close(); service = new Conversations(production, runtime); },
    async close() { await service.close(); await production.close(); await projects.close(); await legacy.close(); const delta = relative(tmpdir(), root); assert.ok(delta && !delta.startsWith("..") && !isAbsolute(delta)); await rm(root, { recursive: true, force: true }); } };
}
test("D4 durable intent, lost receipt, shared slot, restart and same-session follow-up", async () => {
  const f = await fixture(); try {
    assert.equal(f.runtime.creates, 0); assert.deepEqual(await f.service.create(f.create), f.doc);
    await assert.rejects(f.service.create({ ...f.create, conversationId: randomUUID(), selection: { ...f.create.selection, policy: { access: "read-only", approval: "untrusted" } } }), /POLICY_UNAVAILABLE/);
    await assert.rejects(f.service.create({ ...f.create, selection: { ...f.create.selection, policy: { access: "workspace-write", approval: "never" } } }), /IDEMPOTENCY_CONFLICT/);
    f.runtime.lostCreate = true; f.runtime.lostSend = true;
    const command = { ...f.identity, expectedRevision: f.doc.revision, commandKey: "send-d4-test-01", text: "첫 질문" };
    await f.service.send(command); await f.service.settle();
    await assert.rejects(f.production.assertSlot(), /GLOBAL_EXECUTION_BUSY/);
    await f.restart(); await f.service.settle();
    const running = await f.service.required(f.identity); assert.equal(running.turns[0].state, "running");
    await f.service.send(command); assert.equal(f.runtime.creates, 1); assert.equal(f.runtime.sends, 1);
    f.runtime.terminal = true; await f.service.settle(); const answered = await f.service.required(f.identity); assert.equal(answered.turns[0].state, "answered"); await f.production.assertSlot();
    f.runtime.terminal = false; await f.service.send({ ...command, commandKey: "send-d4-test-02", expectedRevision: answered.revision, text: "후속 질문" }); await f.service.settle();
    const next = await f.service.required(f.identity); assert.equal(next.agentId, answered.agentId); assert.deepEqual(next.turns[0], answered.turns[0]); assert.equal(f.runtime.creates, 1); assert.equal(f.runtime.sends, 2);
    assert.ok(!JSON.stringify(viewConversation(next)).includes("content"));
  } finally { await f.close(); }
});
test("D4 absent timeline never resends; approval uncertainty is durable and stale actions are rejected", async () => {
  const f = await fixture(); try {
    f.runtime.absent = true; f.runtime.lostSend = true;
    await f.service.send({ ...f.identity, expectedRevision: f.doc.revision, commandKey: "send-d4-test-01", text: "질문" }); await f.service.settle(); await f.restart(); await f.service.settle();
    let doc = await f.service.required(f.identity); assert.equal(doc.turns[0].state, "unknown"); assert.equal(f.runtime.sends, 1);
    f.runtime.absent = false; await f.service.settle();
    f.runtime.requests = [{ id: "permission-01", hash: "a".repeat(64), kind: "tool", title: "명령 실행", details: "내용", actions: [{ id: "once", label: "허용", behavior: "allow" }, { id: "reject", label: "거부", behavior: "deny" }] }];
    doc = await f.service.required(f.identity);
    const reply = { ...f.identity, commandKey: "reply-d4-test-01", expectedRevision: doc.revision, requestId: "permission-01", requestHash: "a".repeat(64), actionId: "once", behavior: "allow" as const };
    await assert.rejects(f.service.permission({ ...reply, requestHash: "b".repeat(64) }), /PERMISSION_CHANGED/);
    f.runtime.lostReply = true; const unknown = await f.service.permission(reply); assert.equal(unknown.journals[0].state, "unknown");
    await f.restart(); await f.service.permission(reply); await f.service.settle(); assert.equal(f.runtime.replies, 1);
    doc = await f.service.required(f.identity); await assert.rejects(f.service.permission({ ...reply, commandKey: "reply-d4-test-02", expectedRevision: doc.revision }), /DELIVERY_UNKNOWN/);
    f.runtime.requests = []; await f.service.settle(); assert.equal((await f.service.required(f.identity)).journals[0].state, "observed");
    doc = await f.service.required(f.identity); const stop = { ...f.identity, commandKey: "stop-d4-test-01", expectedRevision: doc.revision }; await f.service.stop(stop); await f.service.stop(stop); await f.service.settle(); assert.equal(f.runtime.stops, 1);
  } finally { await f.close(); }
});
test("D4 store refuses stale/rewritten records and corrupt/future records block all new execution", async () => {
  const f = await fixture(); try {
    const store = await f.service.store(f.identity.projectId), altered = structuredClone(f.doc); altered.policy.access = "danger-full-access";
    await assert.rejects(store.put(altered, f.doc.revision), /IDENTITY_CHANGED/);
    const accepted = acceptConversationTurn(f.doc, { commandKey: "send-d4-test-01", expectedRevision: f.doc.revision, text: "질문" }, new Date().toISOString());
    await store.put(accepted, f.doc.revision); await assert.rejects(store.put(accepted, f.doc.revision), /REVISION_CONFLICT/);
    await writeFile(join(f.source, "docs/.orchiva/conversations", randomUUID() + ".json"), '{"schemaVersion":99}');
    assert.equal((await store.all()).issues.length, 1); await assert.rejects(f.production.assertSlot(), /PROJECT_RECORD_INVALID/);
  } finally { await f.close(); }
});
test("D4 all nine access/approval combinations map explicitly without mutating global settings", async () => {
  const f = await fixture(); try {
    for (const access of ["read-only", "workspace-write", "danger-full-access"] as const) for (const approval of ["untrusted", "on-request", "never"] as const) {
      const doc = { ...f.doc, policy: { access, approval } }, options = conversationOptions(doc);
      assert.equal(options.config.options?.sandbox_mode, access); assert.equal(options.config.options?.approval_policy, approval);
      assert.equal(options.cwd, f.source); assert.equal(options.prompt, undefined); assert.equal(options.agentId, f.doc.agentId);
      assert.equal(options.config.options?.web_search, "disabled");
    }
  } finally { await f.close(); }
});
test("D4 runtime binds full timeline and durable outcome; idle commentary is not a completed answer", async () => {
  const f = await fixture(); try {
    const doc = acceptConversationTurn(f.doc, { commandKey: "send-d4-test-01", expectedRevision: f.doc.revision, text: "질문" }, new Date().toISOString()), turn = doc.turns[0];
    const entries = [
      { seqStart: 1, seqEnd: 1, turnId: "provider-turn-1", item: { type: "user_message", clientMessageId: turn.messageId, text: turn.input } },
      { seqStart: 2, seqEnd: 2, turnId: "provider-turn-1", item: { type: "assistant_message", text: "진행 중입니다" } },
    ];
    const handle = { status: "idle", activeTurn: null, pendingPermissions: [], refresh: async () => ({ agent: { id: doc.agentId, cwd: doc.cwd, labels: { orchivaConversation: doc.id, orchivaPolicy: (await import('../domain/record-v2')).payloadHash(doc.policy) }, currentModeId: "auto", provider: "codex", model: "test" } }), timeline: { refetch: async () => ({ entries, epoch: "epoch", hasOlder: false }) } };
    const api = { agents: { ref: () => handle } } as unknown as PaseoApi;
    const runtime = new PaseoConversationRuntime(async () => api, async () => {}, join(f.root, "outcomes"));
    assert.equal((await runtime.observe(doc, turn)).state, "unknown");
    await runtime.recordOutcome(doc.agentId!, turn.messageId, "other-turn", "completed"); assert.equal((await runtime.observe(doc, turn)).state, "unknown");
    await runtime.recordOutcome(doc.agentId!, "previous-message", "provider-turn-1", "completed"); assert.equal((await runtime.observe(doc, turn)).state, "unknown");
    await runtime.recordOutcome(doc.agentId!, turn.messageId, "provider-turn-1", "canceled");
    const result = await new PaseoConversationRuntime(async () => api, async () => {}, join(f.root, "outcomes")).observe(doc, turn);
    assert.equal(result.state, "failed"); assert.equal(result.failure, "TURN_CANCELLED"); assert.equal(result.response, "진행 중입니다");
    await assert.rejects(runtime.recordOutcome(doc.agentId!, turn.messageId, "provider-turn-1", "completed"), /OUTCOME_CONFLICT/);
    entries.push({ seqStart: 3, seqEnd: 3, turnId: "foreign-turn", item: { type: "user_message", text: "외부 입력", clientMessageId: "foreign" } });
    await assert.rejects(runtime.observe(doc, turn), /FOREIGN_TURN/);
  } finally { await f.close(); }
});
