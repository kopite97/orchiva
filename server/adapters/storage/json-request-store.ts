import { mkdir, readFile, readdir, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { recordSchema, tokenSchema, type RequestRecord } from "../../../shared/contracts/feature-request";
import type { RequestStore } from "../../application/ports";
import { RequestLocks } from "../../application/request-locks";
import { assertAppendOnly, captureHistory, migrateV1, occupiesSlot, payloadHash, validateReferences } from "../../domain/record-v2";
import { DirectoryOwner } from "./directory-owner";
type Hooks = { afterBackup?: () => Promise<void>; beforeRename?: () => Promise<void> };
export class JsonRequestStore implements RequestStore {
  private owner: DirectoryOwner;
  private writes = new RequestLocks();
  private project = new RequestLocks();
  private closed = false;
  private closing = false;
  private issues: { file: string; code: string }[] = [];
  constructor(private directory: string, private hooks: Hooks = {}) { this.owner = new DirectoryOwner(directory); }
  async open() { if (this.closed) throw new Error("STORE_CLOSED"); await this.owner.open(); }
  async close() {
    this.closing = true;
    await this.project.run("project", () => this.writes.run("write", async () => { this.closed = true; await this.owner.close(); }));
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error("STORE_CLOSED");
    await this.open();
    return this.project.run("project", async () => { if (this.closed) throw new Error("STORE_CLOSED"); return action(); });
  }
  private path(token: string) { return join(this.directory, `${tokenSchema.parse(token)}.json`); }
  private async atomic(target: string, value: RequestRecord) {
    const temp = `${target}.${randomUUID()}.tmp`;
    const file = await open(temp, "wx");
    try { await file.writeFile(JSON.stringify(value, null, 2), "utf8"); await file.sync(); } finally { await file.close(); }
    await this.hooks.beforeRename?.();
    await rename(temp, target);
  }
  private async read(token: string): Promise<RequestRecord | null> {
    let bytes: Buffer;
    try { bytes = await readFile(this.path(token)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const value = JSON.parse(bytes.toString("utf8"));
    if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2) throw new Error("UNSUPPORTED_VERSION");
    if (value.token !== token) throw new Error("TOKEN_MISMATCH");
    if (value.schemaVersion === 2) {
      for (const key of ["results", "decisions", "commands", "attemptHistory", "plans", "criteria"]) if (!Array.isArray(value[key])) throw new Error("INVALID_V2");
      if (!Number.isInteger(value.revision) || value.revision < 1) throw new Error("INVALID_V2");
      const parsed = recordSchema.parse(value); validateReferences(parsed); return parsed;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const migrated = migrateV1(value, digest);
    const backupDirectory = join(this.directory, "backups", "v1");
    await mkdir(backupDirectory, { recursive: true });
    const backup = join(backupDirectory, `${token}-${digest}.json`);
    try {
      const file = await open(backup, "wx");
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await readFile(backup)).equals(bytes)) throw new Error("BACKUP_CONFLICT");
    }
    await this.hooks.afterBackup?.();
    await this.atomic(this.path(token), migrated);
    return migrated;
  }
  async get(token: string) {
    await this.open();
    return this.writes.run("write", () => this.read(token));
  }
  async save(record: RequestRecord) {
    await this.open();
    return this.writes.run("write", async () => {
      const previous = await this.read(record.token);
      if (previous ? previous.revision !== record.revision : record.revision !== 0) throw new Error("REVISION_CONFLICT");
      const next = recordSchema.parse(structuredClone(record));
      captureHistory(next);
      if (previous) assertAppendOnly(previous, next);
      validateReferences(next);
      const meaningful = (value: RequestRecord) => { const { revision, updatedAt, observationError, observation, ...rest } = value; return payloadHash(rest); };
      next.revision = previous ? previous.revision + Number(meaningful(previous) !== meaningful(next)) : 1;
      next.updatedAt = previous && next.revision === previous.revision ? previous.updatedAt : new Date().toISOString();
      if (previous && payloadHash(previous) === payloadHash(next)) return;
      await this.atomic(this.path(record.token), next);
      for (const key of ["revision", "updatedAt", "results", "decisions", "attemptHistory", "criteria", "plans", "statusReason"] as const) Object.assign(record, { [key]: next[key] });
    });
  }
  async list() {
    await this.open();
    return this.writes.run("write", async () => {
      const files = (await readdir(this.directory)).filter(name => name.endsWith(".json")).sort();
      const records: RequestRecord[] = []; this.issues = [];
      for (const file of files) {
        try { const record = await this.read(file.slice(0, -5)); if (record) records.push(record); }
        catch (error) { this.issues.push({ file, code: error instanceof Error && ["UNSUPPORTED_VERSION", "TOKEN_MISMATCH", "INVALID_V2", "BACKUP_CONFLICT"].includes(error.message) ? error.message : "INVALID_RECORD" }); }
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }
  async diagnostics() {
    const records = await this.list();
    let bytes = 0;
    for (const file of (await readdir(this.directory)).filter(name => name.endsWith(".json"))) bytes += (await readFile(join(this.directory, file))).length;
    return { records: records.length, bytes, results: records.reduce((sum, item) => sum + item.results.length, 0), decisions: records.reduce((sum, item) => sum + item.decisions.length, 0), issues: [...this.issues], activeTokens: records.filter(occupiesSlot).map(item => item.token) };
  }
}
