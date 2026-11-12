import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ExecutionResult, RequestRecord } from "../../../shared/contracts/feature-request";
import type { Observation } from "../../application/ports";
import { assertWorktree, git, type ProjectConfig } from "../../config/project-config";

const execute = promisify(execFile);
async function isIgnored(root: string, path: string) {
  try { await git(root, "check-ignore", "--no-index", "-q", "--", path); return true; }
  catch (error) { if ((error as { code?: number }).code === 1) return false; throw error; }
}
export async function runNodeTest(root: string, path: string, timeout: number) {
  // Node's Windows test glob does not accept drive-qualified paths reliably.
  const testPath = `./${relative(root, path).replaceAll("\\", "/")}`;
  return execute(process.execPath, ["--permission", `--allow-fs-read=${root}`, "--test", "--test-isolation=none", testPath], {
    cwd: root, windowsHide: true, timeout, maxBuffer: 65536,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP },
  });
}
export async function safeFile(root: string, path: string) {
  const canonicalRoot = await realpath(root);
  const resolved = await realpath(resolve(root, path));
  const delta = relative(canonicalRoot, resolved);
  if (delta.startsWith("..") || isAbsolute(delta)) throw new Error("File escapes the sandbox worktree.");
  const info = await stat(resolved);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("Evidence must be a regular file smaller than 2 MiB.");
  return resolved;
}
export async function snapshot(record: RequestRecord, config: ProjectConfig) {
  const root = record.worktreePath;
  if (!root) throw new Error("Missing worktree.");
  await assertWorktree(config, root);
  return snapshotFiles(root, record.checks);
}
/** Pure Git/file collector; the runtime entry point verifies sandbox ownership first. */
export async function snapshotFiles(root: string, definitions: RequestRecord["checks"]) {
  // NUL-delimited names must not be trimmed (a valid filename can start with spaces).
  const names = async (...args: string[]) => (await execute("git", ["-C", root, ...args], { windowsHide: true, timeout: 15000 })).stdout.split("\0");
  const tracked = await names("diff", "--name-only", "-z", "HEAD");
  const untracked = await names("ls-files", "--others", "--exclude-standard", "-z");
  const changedFiles = [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
  const paths = [...new Set([...changedFiles, ...definitions.map(x => x.path)])].sort();
  if (paths.length > 300) throw new Error("Evidence collection limit exceeded (300 files).");
  const files: NonNullable<ExecutionResult["files"]> = [];
  for (const path of paths) {
    let bytes: Buffer | null = null;
    try { bytes = await readFile(await safeFile(root, path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    files.push({ path, changeType: bytes === null ? "deleted" : untracked.includes(path) ? "untracked" : tracked.includes(path) ? "modified" : "check-input",
      sha256: bytes === null ? null : createHash("sha256").update(bytes).digest("hex"), size: bytes?.length ?? 0,
      deleted: bytes === null, isCheckInput: definitions.some(x => x.path === path) });
  }
  // Ignore rules can change outside the worktree (.git/info/exclude or global
  // excludes). A tracked check becoming ignored must also invalidate approval.
  const ignoredCheckInputs: string[] = [];
  for (const path of [...new Set(definitions.map(x => x.path))].sort()) if (await isIgnored(root, path)) ignoredCheckInputs.push(path);
  const fingerprint = createHash("sha256").update(JSON.stringify({ head: await git(root, "rev-parse", "HEAD"), files, ...(ignoredCheckInputs.length ? { ignoredCheckInputs } : {}) })).digest("hex");
  const diff = await git(root, "diff", "--stat", "HEAD");
  return { changedFiles, files, fingerprint, diffStat: diff.slice(0, 16000), diffStatTruncated: diff.length > 16000 };
}
export async function collectEvidence(record: RequestRecord, config: ProjectConfig, observation: Observation, options: { budgetMs?: number; checkTimeoutMs?: number } = {}): Promise<ExecutionResult> {
  if (!record.worktreePath) throw new Error("Missing worktree.");
  await assertWorktree(config, record.worktreePath);
  return collectFiles(record, observation, options);
}
export async function collectFiles(record: RequestRecord, observation: Observation, options: { budgetMs?: number; checkTimeoutMs?: number } = {}): Promise<ExecutionResult> {
  const root = record.worktreePath!;
  const before = await snapshotFiles(root, record.checks);
  const checks: ExecutionResult["checks"] = [];
  const deadline = Date.now() + (options.budgetMs ?? 20000);
  for (const [index, check] of record.checks.entries()) {
    const began = Date.now();
    const checkId = check.id ?? `legacy-check-${index + 1}`;
    const inputFingerprint = before.files.find(x => x.path === check.path)?.sha256 ?? null;
    const command = check.kind === "node-test" ? `node --test --test-isolation=none ${check.path}` : `file-contains ${check.path}`;
    let status: "passed" | "failed" | "error" | "skipped" = "error", failureKind: string | null = null, output = "", exitCode: number | null = null;
    try {
      if (Date.now() >= deadline) { status = "skipped"; failureKind = "budget"; output = "Validation budget exhausted before this check."; }
      else {
        if (await isIgnored(root, check.path)) throw new Error("Ignored check input is unsupported.");
        const path = await safeFile(root, check.path);
        if (check.kind === "node-test") {
          if (!/\.(cjs|mjs|js)$/.test(path)) throw new Error("Node test files must end in .js, .mjs or .cjs.");
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error("Validation exceeded its 20 second budget.");
          // No shell, subprocesses, workers, addons, filesystem writes or inherited credentials.
          const result = await runNodeTest(root, path, Math.max(1, Math.min(options.checkTimeoutMs ?? 10000, remaining)));
          output = result.stdout + result.stderr;
          status = "passed"; exitCode = 0;
        } else {
          const found = (await readFile(path, "utf8")).includes(check.text);
          status = found ? "passed" : "failed"; exitCode = found ? 0 : 1; failureKind = found ? null : "assertion";
          output = found ? `Found required text in ${check.path}: ${check.text}` : `Required text not found: ${check.text}`;
        }
      }
    } catch (error) {
      const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
      output = `${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
      exitCode = typeof failure.code === "number" ? failure.code : null;
      const infrastructure = failure.killed || failure.signal || /ERR_ACCESS_DENIED|SyntaxError|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(output);
      status = exitCode !== null && !infrastructure ? "failed" : "error";
      failureKind = failure.killed || failure.signal ? "timeout" : status === "failed" ? "assertion" : "validator";
    }
    checks.push({ checkId, label: check.label, command, status, failureKind, inputFingerprint, passed: status === "passed", exitCode,
      output: output.slice(-16000), truncated: output.length > 16000, durationMs: Date.now() - began });
  }
  const after = await snapshotFiles(root, record.checks);
  const testChanges: NonNullable<ExecutionResult["testChanges"]> = [];
  for (const [index, check] of checks.entries()) {
    const baseline = record.results.find(r => r.checks.some(c => c.checkId === check.checkId && c.inputFingerprint !== undefined));
    const first = baseline?.checks.find(c => c.checkId === check.checkId);
    if (baseline && first && first.inputFingerprint !== check.inputFingerprint) testChanges.push({ checkId: check.checkId!, path: record.checks[index].path, baselineResultId: baseline.id, before: first.inputFingerprint ?? null, after: check.inputFingerprint ?? null });
  }
  const { diffStatTruncated, ...evidence } = after;
  return {
    id: randomUUID(), sourceKey: observation.sourceKey, collectedAt: new Date().toISOString(),
    finalResponse: observation.finalResponse.slice(-32000), agentStatus: observation.agentStatus,
    ...evidence, checks, testChanges, truncation: { finalResponse: observation.finalResponse.length > 32000, diffStat: diffStatTruncated }, executionFailure: observation.failure,
    failure: observation.failure ?? (before.fingerprint !== after.fingerprint ? "Files changed during validation. Run validation again." : checks.some(check => !check.passed) ? "One or more validation checks failed or could not run." : null),
  };
}
