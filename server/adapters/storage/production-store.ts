import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { productionSchema, type Production } from "../../../shared/contracts/desktop-production";
import { recordSchema, tokenSchema, type RequestRecord } from "../../../shared/contracts/feature-request";
import { captureHistory, assertAppendOnly, validateReferences, occupiesSlot, payloadHash } from "../../domain/record-v2";
import type { RequestStore } from "../../application/ports";
import { RequestLocks } from "../../application/request-locks";
import { atomic, absent, safePath } from "./project-files";

export function productionBusy(doc:Production) {
  return occupiesSlot(doc.engine) || ["pending","running","unknown"].includes(doc.planning?.state ?? "") ||
    doc.journals.some(j=>["pending","unknown"].includes(j.state));
}

/** One v3 envelope is authoritative; the proven v2 engine is an embedded component. */
export class ProductionStore implements RequestStore {
  private locks = new RequestLocks();
  constructor(readonly root: string, readonly projectId: string, private own: () => Promise<void>, private reservations?: () => Promise<{ token:string; runId:string; generation:number }[]>) {}
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
      if (doc.milestone?.generation) {
        const claim=(await this.reservations?.())?.find(c=>c.token===doc.token);
        if (!claim || claim.generation!==doc.milestone.generation || claim.runId!==doc.milestone.runId)
          throw new Error("MILESTONE_STALE_WORKER");
      }
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
  async diagnostics(requester?: string) {
    const all = await this.all(), claims = await this.reservations?.() ?? [];
    for (const claim of claims) {
      const held=all.records.find(d=>d.token===claim.token);
      if (held && (held.milestone?.runId!==claim.runId || held.milestone.generation!==claim.generation)) throw new Error("MILESTONE_STALE_WORKER");
    }
    const own = claims.find(c => c.token === requester);
    const bound = all.records.find(d => d.token === requester)?.milestone;
    if (bound?.generation && (!own || own.generation !== bound.generation || own.runId !== bound.runId))
      throw new Error("MILESTONE_STALE_WORKER");
    const peers = new Set(own ? claims.filter(c => c.runId === own.runId).map(c => c.token) : []);
    const active = all.records.filter(productionBusy).map(x => x.token);
    return { issues: all.issues.map(file => ({file,code:"INVALID_V3_RECORD"})),
      activeTokens: [...new Set([...active,...claims.map(c => c.token)])].filter(token => !peers.has(token)) };
  }
}
