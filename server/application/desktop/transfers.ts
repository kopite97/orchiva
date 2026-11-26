import { unlink } from "node:fs/promises";
import { z } from "zod";
import { bytes, digest, immutable, atomic, safePath, relativeFile } from "../../adapters/storage/project-files";

export const transferFile = z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable(), content: z.string().nullable() });
export const transferManifest = z.object({ version: z.literal(1), media: z.literal(true).optional(), projectId: z.string(), token: z.string(), resultId: z.string(), fingerprint: z.string(), files: z.array(transferFile) });
export type TransferManifest = z.infer<typeof transferManifest>;
const transferJournal = z.object({ version: z.literal(1), media: z.literal(true).optional(), key: z.string(), manifestHash: z.string(), paths: z.array(z.string()), state: z.enum(["applying", "applied", "undoing", "undone"]), files: z.array(transferFile), completed: z.array(z.string()), restored: z.array(z.string()) });
export type TransferJournal = z.infer<typeof transferJournal>;
const limit = (media?: boolean) => media ? 32 * 1024 * 1024 : 2 * 1024 * 1024;
const hash = (value: Buffer | null) => value ? digest(value) : null;
export async function previewTransfer(root: string, manifest: TransferManifest) {
  return Promise.all(manifest.files.map(async file => {
    const current = await bytes(root, file.path, limit(manifest.media));
    return { path: file.path, before: file.before, after: file.after, current: hash(current), conflict: hash(current) !== file.before,
      beforeText: current && !current.includes(0) ? current.toString("utf8").slice(0, 30000) : null,
      afterText: file.content && !Buffer.from(file.content, "base64").includes(0) ? Buffer.from(file.content, "base64").toString("utf8").slice(0, 30000) : null };
  }));
}
const journalPath = (key: string) => { if (!/^[a-zA-Z0-9-]{8,80}$/.test(key)) throw new Error("COMMAND_KEY_INVALID"); return `docs/.orchiva/transfers/${key}.json`; };
export async function readTransfer(root: string, key: string) { const content = await bytes(root, journalPath(key), 24 * 1024 * 1024); return content ? transferJournal.parse(JSON.parse(content.toString("utf8"))) : null; }
async function persist(root: string, journal: TransferJournal) { const content = JSON.stringify(journal); if (Buffer.byteLength(content) > 24 * 1024 * 1024) throw new Error("EXPORT_SIZE_LIMIT"); await atomic(await safePath(root, journalPath(journal.key)), content); }
async function write(root: string, file: z.infer<typeof transferFile>, direction: "apply" | "undo", media?: boolean) {
  const target = await safePath(root, relativeFile(file.path));
  const desired = direction === "apply" ? file.after : file.before;
  const current = await bytes(root, file.path, limit(media)), currentHash = hash(current);
  if (currentHash === desired) return;
  if (currentHash !== (direction === "apply" ? file.before : file.after)) throw new Error("SOURCE_FILE_CONFLICT: " + file.path);
  if (desired === null) { if (current) await unlink(target); }
  else {
    if (!file.content || digest(Buffer.from(file.content, "base64")) !== desired) throw new Error("TRANSFER_CONTENT_INVALID");
    await atomic(target, Buffer.from(file.content, "base64"));
  }
}
/** Durable intent and original bytes precede every source mutation. Replays compare hashes. */
export async function applyTransfer(root: string, manifest: TransferManifest, key: string, selected: string[], afterWrite?: () => void) {
  const paths = [...new Set(selected)].sort(), manifestHash = digest(JSON.stringify(manifest));
  if (!paths.length || paths.some(path => !manifest.files.some(f => f.path === path))) throw new Error("SELECT_FILES_REQUIRED");
  let journal = await readTransfer(root, key);
  if (journal) {
    if (journal.manifestHash !== manifestHash || JSON.stringify(journal.paths) !== JSON.stringify(paths)) throw new Error("IDEMPOTENCY_CONFLICT");
    if (journal.state === "applied" || journal.state === "undone") return journal;
    if (journal.state !== "applying") throw new Error("UNDO_IN_PROGRESS");
  } else {
    const files = manifest.files.filter(x => paths.includes(x.path));
    for (const file of files) {
      const current = await bytes(root, file.path, limit(manifest.media)); if (hash(current) !== file.before) throw new Error("SOURCE_FILE_CONFLICT: " + file.path);
      if (current) await immutable(root, `docs/.orchiva/backups/transfers/${key}/${file.path}`, current);
    }
    journal = { version: 1, ...(manifest.media ? { media: true as const } : {}), key, manifestHash, paths, state: "applying", files, completed: [], restored: [] }; await persist(root, journal);
  }
  for (const file of journal.files) { if (journal.completed.includes(file.path)) continue; await write(root, file, "apply", journal.media); afterWrite?.(); journal.completed.push(file.path); await persist(root, journal); }
  journal.state = "applied"; await persist(root, journal); return journal;
}
export async function undoTransfer(root: string, key: string) {
  const journal = await readTransfer(root, key); if (!journal) throw new Error("TRANSFER_NOT_FOUND");
  if (journal.state === "undone") return journal;
  if (journal.state === "applied" || journal.state === "applying") {
    for (const file of journal.files) { const current = hash(await bytes(root, file.path, limit(journal.media))); if (current !== file.after && !(journal.state === "applying" && current === file.before)) throw new Error("SOURCE_FILE_CONFLICT: " + file.path); }
    journal.state = "undoing"; await persist(root, journal);
  }
  for (const file of [...journal.files].reverse()) {
    if (journal.restored.includes(file.path)) continue;
    const backup = file.before ? await bytes(root, `docs/.orchiva/backups/transfers/${key}/${file.path}`, limit(journal.media)) : null;
    if (hash(backup) !== file.before) throw new Error("BACKUP_INVALID");
    await write(root, { ...file, content: backup?.toString("base64") ?? null }, "undo", journal.media); journal.restored.push(file.path); await persist(root, journal);
  }
  journal.state = "undone"; await persist(root, journal); return journal;
}
