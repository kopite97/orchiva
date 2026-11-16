import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { productionSchema, type Production } from "../../../shared/contracts/desktop-production";
import { recordSchema, tokenSchema, type RequestRecord } from "../../../shared/contracts/feature-request";
import { captureHistory, assertAppendOnly, validateReferences, occupiesSlot, payloadHash } from "../../domain/record-v2";
import type { RequestStore } from "../../application/ports";
import { RequestLocks } from "../../application/request-locks";
import { atomic, absent, safePath } from "./project-files";

/** One v3 envelope is authoritative; the proven v2 engine is an embedded component. */
export class ProductionStore implements RequestStore {
  private locks = new RequestLocks();
  constructor(readonly root: string, readonly projectId: string, private own: () => Promise<void>) {}
  private file(token: string) { return safePath(this.root, `docs/.orchiva/requests/${tokenSchema.parse(token)}.json`); }
  async exclusive<T>(action: () => Promise<T>) { await this.own(); return this.locks.run("request", action); }
  async envelope(token: string): Promise<Production | null> {
    try {
      const raw = JSON.parse(await readFile(await this.file(token), "utf8"));
      if (raw.schemaVersion !== 3) throw new Error("UNSUPPORTED_VERSION");
      const doc = productionSchema.parse(raw);
      if (doc.token !== token || doc.engine.token !== token || doc.projectId !== this.projectId) throw new Error("RECORD_IDENTITY_MISMATCH");
      validateReferences(doc.engine); return doc;
    } catch (error) { if (absent(error)) return null; throw error; }
  }
  async put(next: Production) {
    await this.own();
    return this.locks.run("write", async () => {
      const old = await this.envelope(next.token);
      if (old && old.revision !== next.revision) throw new Error("REVISION_CONFLICT");
      const doc = productionSchema.parse(structuredClone(next));
      if (old) {
        assertAppendOnly(old.engine, doc.engine);
        for (const key of ["planVersions", "reviews", "exports"] as const) if (JSON.stringify(doc[key].slice(0, old[key].length)) !== JSON.stringify(old[key])) throw new Error("IMMUTABLE_HISTORY");
        for (const entry of old.journals.filter(x => x.state === "applied")) if (!doc.journals.some(x => JSON.stringify(x) === JSON.stringify(entry))) throw new Error("IMMUTABLE_COMMAND");
      }
      validateReferences(doc.engine);
      const meaningful = (value: Production) => { const copy = structuredClone(value); delete copy.engine.observation; copy.engine.observationError = null; return payloadHash(copy); };
      doc.revision = old ? old.revision + Number(meaningful(old) !== meaningful(doc)) : 1;
      await atomic(await this.file(next.token), JSON.stringify(doc, null, 2)); next.revision = doc.revision;
    });
  }
  async get(token: string) { return (await this.envelope(token))?.engine ?? null; }
  async save(record: RequestRecord) {
    const doc = await this.envelope(record.token); if (!doc) throw new Error("NOT_FOUND");
    if (doc.engine.revision !== record.revision) throw new Error("REVISION_CONFLICT");
    const next = recordSchema.parse(structuredClone(record)); captureHistory(next); assertAppendOnly(doc.engine, next); validateReferences(next);
    const meaningful = (value: RequestRecord) => { const { revision, updatedAt, observationError, observation, ...rest } = value; return payloadHash(rest); };
    next.revision = doc.engine.revision + Number(meaningful(doc.engine) !== meaningful(next));
    next.updatedAt = next.revision === doc.engine.revision ? doc.engine.updatedAt : new Date().toISOString();
    if (JSON.stringify(next) === JSON.stringify(doc.engine)) return;
    doc.engine = next; await this.put(doc);
    // Application state machines hold references to command checkpoints while
    // saving. Replacing commands here would silently discard subsequent phases.
    for (const key of ["revision", "updatedAt", "results", "decisions", "attemptHistory", "criteria", "plans", "statusReason"] as const) Object.assign(record, { [key]: next[key] });
  }
  async all() {
    const records: Production[] = [], issues: string[] = [];
    let files: string[];
    try { files = await readdir(await safePath(this.root, "docs/.orchiva/requests")); } catch (error) { if (absent(error)) return { records, issues }; throw error; }
    for (const file of files.filter(x => x.endsWith(".json")).sort()) {
      try { const doc = await this.envelope(file.slice(0, -5)); if (doc) records.push(doc); }
      catch { issues.push(file); }
    }
    return { records, issues };
  }
  async list() { return (await this.all()).records.map(x => x.engine); }
  async diagnostics() { const all = await this.all(); return { issues: all.issues.map(file => ({ file, code: "INVALID_V3_RECORD" })), activeTokens: all.records.filter(x => occupiesSlot(x.engine) || ["pending", "running", "unknown"].includes(x.planning?.state ?? "") || x.journals.some(j => ["pending", "unknown"].includes(j.state))).map(x => x.token) }; }
}
