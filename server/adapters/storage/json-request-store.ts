import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { recordSchema, tokenSchema, type RequestRecord } from "../../../shared/contracts/feature-request";
import type { RequestStore } from "../../application/ports";
export class JsonRequestStore implements RequestStore {
  constructor(private directory: string) {}
  private path(token: string) { return join(this.directory, `${tokenSchema.parse(token)}.json`); }
  async get(token: string) {
    try { return recordSchema.parse(JSON.parse(await readFile(this.path(token), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async save(record: RequestRecord) {
    recordSchema.parse(record);
    await mkdir(this.directory, { recursive: true });
    const target = this.path(record.token), temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temp, target);
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(name => name.endsWith(".json"));
    const records = await Promise.all(files.map(name => this.get(name.slice(0, -5))));
    return records.filter((r): r is RequestRecord => r !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
