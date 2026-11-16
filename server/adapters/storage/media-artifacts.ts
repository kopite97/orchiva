import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { mediaBudget } from "../../../shared/contracts/desktop-media";
import { relativeFile, safePath } from "./project-files";

export type MediaArtifact = { path: string; bytes: number; sha256: string };
/** Explicit manifest paths include ignored outputs; never scans unrelated project files. */
export async function collectMedia(root: string, paths: string[]): Promise<MediaArtifact[]> {
  if (!paths.length || paths.length > mediaBudget.files) throw new Error("MEDIA_FILE_COUNT_LIMIT");
  const normalized = paths.map(relativeFile);
  if (new Set(normalized.map(p => p.toLowerCase())).size !== paths.length) throw new Error("MEDIA_DUPLICATE_PATH");
  if (normalized.some(p => /^(?:\.git|\.orchiva|docs)(?:\/|$)/i.test(p) || /(^|\/)AGENTS\.md$/i.test(p))) throw new Error("MEDIA_METADATA_PATH");
  const result: MediaArtifact[] = []; let total = 0;
  for (const path of normalized) {
    const target = await safePath(root, path), before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("MEDIA_REGULAR_FILE_REQUIRED");
    if (before.size > mediaBudget.perFile || total + before.size > mediaBudget.total) throw new Error("MEDIA_SIZE_LIMIT");
    const resolved = await realpath(target), handle = await open(target, "r");
    try {
      const opened = await handle.stat();
      if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw new Error("MEDIA_FILE_CHANGED");
      const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let count = 0;
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
        count += bytesRead; if (count > mediaBudget.perFile || total + count > mediaBudget.total) throw new Error("MEDIA_SIZE_LIMIT");
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat(), named = await lstat(target);
      if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.ino !== before.ino || named.dev !== before.dev || await realpath(target) !== resolved) throw new Error("MEDIA_FILE_CHANGED");
      await safePath(root, path); total += count; result.push({ path, bytes: count, sha256: hash.digest("hex") });
    } finally { await handle.close(); }
  }
  return result;
}
