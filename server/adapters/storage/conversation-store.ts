import { readdir } from "node:fs/promises";
import { conversationId, conversationSchema, type Conversation } from "../../../shared/contracts/desktop-conversation";
import { assertConversationHistory, activeConversationTurn } from "../../domain/conversation";
import { payloadHash } from "../../domain/record-v2";
import { RequestLocks } from "../../application/request-locks";
import { absent, atomic, bytes, safePath } from "./project-files";

export class ConversationStore {
  private locks = new RequestLocks();
  constructor(readonly root: string, readonly projectId: string, private own: () => Promise<void>) {}
  private file(id: string) { return `docs/.orchiva/conversations/${conversationId.parse(id)}.json`; }
  async get(id: string): Promise<Conversation | null> {
    const content = await bytes(this.root, this.file(id), 32 * 1024 * 1024); if (!content) return null;
    const doc = conversationSchema.parse(JSON.parse(content.toString("utf8")));
    if (doc.id !== id || doc.projectId !== this.projectId) throw new Error("RECORD_IDENTITY_MISMATCH");
    this.validate(doc); return doc;
  }
  private validate(doc: Conversation) {
    if (doc.turns.filter(activeConversationTurn).length > 1 || doc.turns.slice(0, -1).some(activeConversationTurn)) throw new Error("CONVERSATION_HISTORY_INVALID");
    for (const key of ["id", "commandKey", "messageId"] as const) if (new Set(doc.turns.map(t => t[key])).size !== doc.turns.length) throw new Error("CONVERSATION_HISTORY_INVALID");
    if (new Set([doc.createKey, ...doc.turns.map(t => t.commandKey), ...doc.journals.map(j => j.key)]).size !== 1 + doc.turns.length + doc.journals.length) throw new Error("CONVERSATION_HISTORY_INVALID");
    for (const turn of doc.turns) if (turn.inputHash !== payloadHash({ text: turn.input }) || (activeConversationTurn(turn) ? turn.completedAt !== null : !turn.completedAt)) throw new Error("CONVERSATION_HISTORY_INVALID");
  }
  async put(next: Conversation, expectedRevision: number) {
    await this.own();
    return this.locks.run("write", async () => {
      const old = await this.get(next.id);
      if ((old?.revision ?? 0) !== expectedRevision) throw new Error("REVISION_CONFLICT");
      const doc = conversationSchema.parse(next); this.validate(doc);
      if (old) assertConversationHistory(old, doc);
      doc.revision = expectedRevision + 1;
      const content = JSON.stringify(doc, null, 2); if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error("CONVERSATION_SIZE_LIMIT");
      await atomic(await safePath(this.root, this.file(doc.id)), content); next.revision = doc.revision;
    });
  }
  async all() {
    const records: Conversation[] = [], issues: string[] = []; let files: string[];
    try { files = await readdir(await safePath(this.root, "docs/.orchiva/conversations")); } catch (error) { if (absent(error)) return { records, issues }; throw error; }
    if (files.length > 1000) throw new Error("CONVERSATION_SIZE_LIMIT");
    for (const file of files.filter(f => f.endsWith(".json")).sort()) {
      try { const doc = await this.get(file.slice(0, -5)); if (doc) records.push(doc); } catch { issues.push(file); }
    }
    return { records, issues };
  }
}
