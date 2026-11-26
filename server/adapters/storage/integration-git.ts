import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { digest, relativeFile } from "./project-files";
import type { TransferManifest } from "../../application/desktop/transfers";

export const oid = /^[a-f0-9]{40}$/;
export function publishPath(path: string) {
  if (relativeFile(path) !== path || path.split("/").some(s => s.startsWith(".") || /^(?:AGENTS\.md|node_modules|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s)) ||
    /^docs\/(agents|plans|roadmap|evidence|decisions)(\/|$)/i.test(path) || /(?:^|\/)(?:id_rsa|id_ed25519|credentials(?:\.json)?|local-credential)$|\.(?:pem|pfx|key)$/i.test(path))
    throw new Error("INTEGRATION_PATH_DENIED");
  return path;
}
export async function gitBytes(cwd: string, args: string[], input?: Buffer | string, extra: NodeJS.ProcessEnv = {}) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile("git", ["--literal-pathspecs", "-c", "core.hooksPath=NUL", "-C", cwd, ...args], {
      windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", ...extra }
    }, (error, out) => error ? reject(Object.assign(new Error("INTEGRATION_GIT_FAILED: " + args[0]), { code: error.code })) : resolve(out));
    child.stdin?.on("error", () => { }); child.stdin?.end(input);
  });
}
export const gitText = async (cwd: string, args: string[], input?: Buffer | string, env?: NodeJS.ProcessEnv) => (await gitBytes(cwd, args, input, env)).toString("utf8").trim();
export async function ref(repo: string, branch: string) {
  const value = await gitText(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/" + branch]);
  return value.split("\n").find(s => s.startsWith("refs/heads/" + branch + " "))?.split(" ")[1] ?? null;
}
export async function advanceRef(repo: string, branch: string, before: string | null, after: string) {
  const current = await ref(repo, branch);
  if (current === after) return;
  if (current !== before) throw new Error("INTEGRATION_BASE_MOVED");
  await gitText(repo, ["update-ref", "refs/heads/" + branch, after, before ?? "0".repeat(40)]);
}
export async function initializeRepo(directory: string, source: string, base: string) {
  await mkdir(directory, { recursive: true });
  await gitText(directory, ["init", "--bare", "--quiet"]);
  await gitText(directory, ["fetch", "--no-tags", "--no-write-fetch-head", source, base]);
}
export async function treeFile(repo: string, commit: string, path: string) {
  const line = (await gitBytes(repo, ["ls-tree", "-z", commit, "--", path])).toString("utf8");
  if (!line) return null;
  const m = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(line);
  if (!m || m[3] !== path) throw new Error("INTEGRATION_PATH_DENIED");
  return { mode: m[1], bytes: await gitBytes(repo, ["cat-file", "blob", m[2]]) };
}
/** Read a pinned snapshot in two Git processes, keeping binary blobs intact. */
export async function snapshotTree(repo: string, commit: string, include: (path: string) => boolean) {
  const listing = (await gitBytes(repo, ["ls-tree", "-r", "-z", commit])).toString("utf8").split("\0").filter(Boolean);
  const entries: { path: string; oid: string }[] = [];
  for (const line of listing) {
    const separator = line.indexOf("\t"), path = line.slice(separator + 1);
    if (!include(path)) continue;
    relativeFile(path);
    const match = /^(?:100644|100755) blob ([a-f0-9]{40})$/.exec(line.slice(0, separator));
    if (!match) throw new Error("INTEGRATION_PATH_DENIED");
    entries.push({ path, oid: match[1] });
  }
  if (entries.length > 1000) throw new Error("INPUT_FILE_LIMIT");
  const result = new Map<string, Buffer>(); if (!entries.length) return result;
  const data = await gitBytes(repo, ["cat-file", "--batch"], entries.map(e => e.oid + "\n").join(""));
  let offset = 0, size = 0;
  for (const entry of entries) {
    const end = data.indexOf(10, offset);
    const header = end < 0 ? null : /^([a-f0-9]{40}) blob (\d+)$/.exec(data.toString("ascii", offset, end));
    if (!header || header[1] !== entry.oid) throw new Error("INTEGRATION_TREE_MISMATCH");
    const length = Number(header[2]); size += length;
    if (length > 2 * 1024 * 1024 || size > 16 * 1024 * 1024) throw new Error("INPUT_SIZE_LIMIT");
    offset = end + 1; result.set(entry.path, data.subarray(offset, offset + length)); offset += length;
    if (data[offset++] !== 10) throw new Error("INTEGRATION_TREE_MISMATCH");
  }
  return result;
}
export function verifiedFiles(manifest: TransferManifest, allowed: string[]) {
  const seen = new Set<string>();
  for (const file of manifest.files) {
    const name = publishPath(file.path).toLowerCase();
    if (!allowed.includes(file.path) || seen.has(name) || (file.content === null ? null : digest(Buffer.from(file.content, "base64"))) !== file.after) throw new Error("INTEGRATION_MANIFEST_INVALID");
    seen.add(name);
  }
  return manifest.files;
}
export async function featureCommit(repo: string, base: string, branch: string, files: TransferManifest["files"], message: string, at: string) {
  const temp = await mkdtemp(join(repo, "index-"));
  const env = { GIT_INDEX_FILE: join(temp, "index"), GIT_AUTHOR_NAME: "Orchiva", GIT_AUTHOR_EMAIL: "orchiva@localhost", GIT_COMMITTER_NAME: "Orchiva", GIT_COMMITTER_EMAIL: "orchiva@localhost", GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
  try {
    await gitText(repo, ["read-tree", base], undefined, env);
    const updates = [];
    for (const f of files) {
      const path = publishPath(f.path), prior = await treeFile(repo, base, path);
      if ((prior ? digest(prior.bytes) : null) !== f.before) throw new Error("INTEGRATION_FILE_CONFLICT: " + path);
      const blob = f.content === null ? "0".repeat(40) : await gitText(repo, ["hash-object", "-w", "--stdin"], Buffer.from(f.content, "base64"));
      updates.push((f.after === null ? "0" : prior?.mode ?? "100644") + " " + blob + "\t" + path + "\0");
    }
    if (updates.length) await gitText(repo, ["update-index", "-z", "--index-info"], updates.join(""), env);
    const tree = await gitText(repo, ["write-tree"], undefined, env);
    const head = await gitText(repo, ["commit-tree", tree, "-p", base], message + "\n", env);
    const changed = (await gitBytes(repo, ["diff-tree", "--no-renames", "--name-only", "-r", "-z", "--no-commit-id", base, head])).toString().split("\0").filter(Boolean);
    if (changed.length !== files.length || changed.some(p => !files.some(f => f.path === p))) throw new Error("INTEGRATION_TREE_MISMATCH");
    for (const f of files) {
      const actual = await treeFile(repo, head, f.path);
      if ((actual ? digest(actual.bytes) : null) !== f.after) throw new Error("INTEGRATION_TREE_MISMATCH");
    }
    await advanceRef(repo, branch, null, head); return head;
  } finally { await rm(temp, { recursive: true, force: true }); }
}
