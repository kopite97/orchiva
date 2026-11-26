import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { conversationSchema, conversationSelection, type Conversation } from "../../../shared/contracts/desktop-conversation";
import { desktopError } from "../../../shared/contracts/desktop-errors";
import { acceptConversationTurn, activeConversationTurn, markConversationDispatch } from "../../domain/conversation";
import { payloadHash } from "../../domain/record-v2";
import { ConversationStore } from "../../adapters/storage/conversation-store";
import type { ConversationRuntime } from "./conversation-runtime";
import type { ProductionService } from "./production";
type Identity = { projectId: string; conversationId: string };
type Command = Identity & { commandKey: string; expectedRevision: number };
const now = () => new Date().toISOString();

export class Conversations {
  private stores = new Map<string, ConversationStore>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  constructor(readonly production: ProductionService, private runtime: ConversationRuntime) { production.externalSlotCheck = () => this.assertSlot(); }
  get projects() { return this.production.projects; }
  async store(id: string) { const p = await this.projects.project(id); let store = this.stores.get(id); if (!store || store.root !== p.sourceRoot) { store = new ConversationStore(p.sourceRoot, id, () => this.projects.own(p.sourceRoot)); this.stores.set(id, store); } return store; }
  async required(i: Identity) { const doc = await (await this.store(i.projectId)).get(i.conversationId); if (!doc) throw new Error("NOT_FOUND"); return doc; }
  async list(id: string) { const all = await (await this.store(id)).all(); return { issues: all.issues, records: all.records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(d => ({ id: d.id, title: d.turns[0]?.input.slice(0, 100) ?? "새 대화", createdAt: d.createdAt, state: d.turns.at(-1)?.state ?? "ready" })) }; }
  async assertSlot() {
    for (const p of await this.projects.list()) {
      if (!p.available) throw new Error("PROJECT_UNAVAILABLE_OR_INVALID"); if (!p.initialized) continue;
      const all = await (await this.store(p.projectId)).all();
      if (all.issues.length) throw new Error("PROJECT_RECORD_INVALID");
      if (all.records.some(d => d.turns.some(activeConversationTurn))) throw new Error("GLOBAL_EXECUTION_BUSY");
    }
  }
  async create(i: Command & { selection: z.infer<typeof conversationSelection> }) {
    return this.projects.exclusive(async () => {
      const store = await this.store(i.projectId), old = await store.get(i.conversationId), selection = conversationSelection.parse(i.selection), hash = payloadHash(selection);
      if (old) { if (old.createKey !== i.commandKey || old.createHash !== hash) throw new Error("IDEMPOTENCY_CONFLICT"); return old; }
      if (i.expectedRevision !== 0) throw new Error("REVISION_CONFLICT");
      // Paseo 0.15.4 accepts this enum, but Codex 0.166.0 rejects it at session open.
      if (selection.policy.approval === "untrusted") throw new Error("CONVERSATION_POLICY_UNAVAILABLE");
      const catalog = await this.production.models(i.projectId), model = catalog.models.find(m => m.provider === selection.provider);
      if (!catalog.ready || !model || (selection.thinkingOptionId && !model.levels.some(l => l.id === selection.thinkingOptionId))) throw new Error("MODEL_SELECTION_UNAVAILABLE");
      const instructions = await this.projects.instructions(i.projectId); if (!instructions.ready) throw new Error("INSTRUCTIONS_NOT_READY");
      const p = await this.projects.project(i.projectId);
      const doc = conversationSchema.parse({ schemaVersion: 1, projectId: i.projectId, id: i.conversationId, revision: 1, createdAt: now(), ...selection, instructions, cwd: p.sourceRoot, createKey: i.commandKey, createHash: hash, agentId: randomUUID(), sessionState: "accepted", observationError: null, turns: [], journals: [] });
      await store.put(doc, 0); return doc;
    });
  }
  async send(i: Command & { text: string }) {
    return this.projects.exclusive(async () => {
      const doc = await this.required(i), store = await this.store(i.projectId), next = acceptConversationTurn(doc, i, now());
      if (next.revision === doc.revision) return doc;
      if (doc.policy.approval === "untrusted") throw new Error("CONVERSATION_POLICY_UNAVAILABLE");
      await this.production.assertSlot();
      if ((await this.projects.project(i.projectId)).sourceRoot !== doc.cwd) throw new Error("RESOURCE_MISMATCH");
      if (doc.sessionState === "ready") { if (!await this.runtime.exists(doc)) throw new Error("RESOURCE_MISSING"); }
      await store.put(next, doc.revision); this.wake(); return next;
    });
  }
  async attention(i: Identity) { const doc = await this.required(i); return doc.sessionState === "ready" && doc.turns.some(activeConversationTurn) ? this.runtime.attention(doc) : []; }
  async permission(i: Command & { requestId: string; requestHash: string; actionId: string; behavior: "allow" | "deny" }) {
    return this.projects.exclusive(async () => {
      const doc = await this.required(i), store = await this.store(i.projectId), payload = { requestId: i.requestId, requestHash: i.requestHash, actionId: i.actionId, behavior: i.behavior };
      if (this.replay(doc, i.commandKey, "permission", payload)) return doc;
      this.revision(doc, i.expectedRevision); const turn = doc.turns.find(activeConversationTurn); if (!turn) throw new Error("INVALID_STATE");
      const request = (await this.runtime.attention(doc)).find(r => r.id === i.requestId);
      if (!request || request.hash !== i.requestHash || !request.actions.some(a => a.id === i.actionId && a.behavior === i.behavior)) throw new Error("PERMISSION_CHANGED");
      if (request.kind === "question" && i.behavior === "allow") throw new Error("QUESTION_ANSWER_REQUIRED");
      if (doc.journals.some(j => j.requestId === i.requestId)) throw new Error("DELIVERY_UNKNOWN");
      const journal: Conversation["journals"][number] = { key: i.commandKey, kind: "permission", turnId: turn.id, payloadHash: payloadHash(payload), requestId: request.id, request, actionId: i.actionId, behavior: i.behavior, at: now(), state: "pending" };
      doc.journals.push(journal); await store.put(doc, doc.revision);
      try { await this.runtime.permission(doc, request.id, i.actionId, i.behavior); journal.state = "sent"; } catch { journal.state = "unknown"; }
      await store.put(doc, doc.revision); this.wake(); return doc;
    });
  }
  async stop(i: Command) {
    return this.projects.exclusive(async () => {
      const doc = await this.required(i), store = await this.store(i.projectId);
      if (this.replay(doc, i.commandKey, "stop", {})) return doc;
      this.revision(doc, i.expectedRevision); const turn = doc.turns.find(activeConversationTurn); if (!turn) throw new Error("INVALID_STATE");
      if (doc.journals.some(j => j.kind === "stop" && j.turnId === turn.id)) throw new Error("DELIVERY_UNKNOWN");
      const journal: Conversation["journals"][number] = { key: i.commandKey, kind: "stop", turnId: turn.id, payloadHash: payloadHash({}), requestId: null, request: null, actionId: null, behavior: null, at: now(), state: "pending" };
      doc.journals.push(journal); await store.put(doc, doc.revision);
      if (turn.state === "accepted" && doc.sessionState === "accepted") { turn.state = "failed"; turn.failure = "CANCELLED_BEFORE_SEND"; turn.completedAt = now(); journal.state = "observed"; }
      else { try { await this.runtime.stop(doc); journal.state = "sent"; } catch { journal.state = "unknown"; } }
      await store.put(doc, doc.revision); this.wake(); return doc;
    });
  }
  private revision(doc: Conversation, revision: number) { if (doc.revision !== revision) throw new Error("REVISION_CONFLICT"); }
  private replay(doc: Conversation, key: string, kind: string, payload: unknown) { const old = doc.journals.find(j => j.key === key); if ((old && (old.kind !== kind || old.payloadHash !== payloadHash(payload))) || doc.createKey === key || doc.turns.some(t => t.commandKey === key)) throw new Error("IDEMPOTENCY_CONFLICT"); return old; }
  startWorker() { this.wake(); }
  wake() { if (this.stopped || this.running || this.timer) return; this.timer = setTimeout(() => { this.timer = undefined; void this.settle().finally(() => { if (!this.stopped) this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, 2500); }); }, 0); this.timer.unref(); }
  async settle() { if (this.running) return this.running; this.running = this.cycle().catch(() => undefined); try { await this.running; } finally { this.running = undefined; } }
  async close() { this.stopped = true; if (this.timer) clearTimeout(this.timer); await this.running; }
  private async cycle() {
    await this.projects.exclusive(async () => {
      for (const project of await this.projects.list()) {
        if (!project.available || !project.initialized) continue;
        const store = await this.store(project.projectId), all = await store.all();
        for (let doc of all.records) {
          let turn = doc.turns.find(activeConversationTurn); if (!turn) continue;
          const before = JSON.stringify(doc);
          try {
            if (project.sourceRoot !== doc.cwd) throw new Error("RESOURCE_MISMATCH");
            if (doc.sessionState === "accepted") {
              doc.sessionState = "creating"; await store.put(doc, doc.revision);
              try { await this.runtime.create(doc); doc.sessionState = "ready"; } catch { doc.sessionState = "unknown"; }
              await store.put(doc, doc.revision);
            } else if (doc.sessionState === "creating" || doc.sessionState === "unknown") {
              doc.sessionState = await this.runtime.exists(doc) ? "ready" : "unknown";
            }
            if (doc.sessionState !== "ready") throw new Error("DELIVERY_UNKNOWN");
            if (turn.state === "accepted") {
              await this.runtime.prepare(doc);
              const priorRevision = doc.revision; doc = markConversationDispatch(doc, turn.id); turn = doc.turns.find(activeConversationTurn)!; await store.put(doc, priorRevision);
              try {
                if (await this.runtime.send(doc, turn) === "not-started") { turn.state = "failed"; turn.failure = "SEND_NOT_STARTED_AGENT_BUSY"; turn.completedAt = now(); }
                else turn.state = "running";
              } catch { turn.state = "unknown"; }
              await store.put(doc, doc.revision);
              if (!activeConversationTurn(turn)) continue;
            }
            const observation = await this.runtime.observe(doc, turn);
            Object.assign(turn, observation);
            if (!activeConversationTurn(turn)) turn.completedAt = now();
            const requests = await this.runtime.attention(doc);
            for (const j of doc.journals.filter(j => j.state !== "observed")) {
              if (!activeConversationTurn(turn) || (j.kind === "permission" && !requests.some(r => r.id === j.requestId))) j.state = "observed";
              else if (j.state === "pending") j.state = "unknown";
            }
            doc.observationError = null;
          } catch (error) { doc.observationError = desktopError(error) ?? "CONVERSATION_OBSERVATION_UNAVAILABLE"; }
          if (JSON.stringify(doc) !== before) await store.put(doc, doc.revision);
        }
      }
    });
  }
}
