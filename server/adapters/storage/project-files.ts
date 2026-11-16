import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export function relativeFile(value: string) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || isAbsolute(value) || /[:\x00-\x1f]/.test(normalized) || normalized.split("/").some(x => !x || x === "." || x === ".." || /[. ]$/.test(x))) throw new Error("INVALID_PATH");
  return normalized;
}
export function inside(root: string, target: string) {
  const delta = relative(root.toLowerCase(), target.toLowerCase());
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(".." + sep));
}
export async function safePath(root: string, file: string) {
  const base = await realpath(root), target = resolve(base, relativeFile(file));
  if (!inside(base, target)) throw new Error("PATH_ESCAPE");
  let ancestor = target;
  while (true) {
    try { if (!inside(base, await realpath(ancestor))) throw new Error("PATH_ESCAPE"); break; }
    catch (error) { if (!absent(error)) throw error; const next = dirname(ancestor); if (next === ancestor) throw error; ancestor = next; }
  }
  return target;
}
export async function bytes(root: string, file: string, limit = 2 * 1024 * 1024): Promise<Buffer | null> {
  try { const path = await safePath(root, file), stat = await lstat(path); if (!stat.isFile() || stat.size > limit) throw new Error("FILE_LIMIT"); return await readFile(path); }
  catch (error) { if (absent(error)) return null; throw error; }
}
export async function atomic(path: string, content: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp", handle = await open(temp, "wx");
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
}
export async function immutable(root: string, file: string, content: string | Buffer) {
  const target = await safePath(root, file); await mkdir(dirname(target), { recursive: true });
  try { const handle = await open(target, "wx"); try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; if (!(await readFile(target)).equals(Buffer.from(content))) throw new Error("IMMUTABLE_CONFLICT"); }
}
export async function markdownFiles(root: string, directory = "", count = { value: 0 }): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory ? await safePath(root, directory) : root, { withFileTypes: true })) {
    if ([".git", "node_modules", ".orchiva", "bin", "obj", ".desktop-local"].includes(item.name) || item.isSymbolicLink()) continue;
    if (++count.value > 10000) throw new Error("DIRECTORY_LIMIT");
    const file = directory ? directory + "/" + item.name : item.name;
    if (item.isDirectory()) result.push(...await markdownFiles(root, file, count));
    else if (item.isFile() && /\.md$/i.test(item.name)) result.push(file);
  }
  return result;
}
