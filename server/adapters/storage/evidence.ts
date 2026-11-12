import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExecutionResult, RequestRecord } from "../../../shared/contracts/feature-request";
import type { Observation } from "../../application/ports";
import { assertWorktree, git, type ProjectConfig } from "../../config/project-config";

const execute = promisify(execFile);
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
  const tracked = (await git(root, "diff", "--name-only", "-z", "HEAD")).split("\0");
  const untracked = (await git(root, "ls-files", "--others", "--exclude-standard", "-z")).split("\0");
  const files = [...new Set([...tracked, ...untracked].filter(Boolean))].sort();
  if (files.length > 300) throw new Error("PoC evidence limit exceeded (300 files).");
  const hash = createHash("sha256").update(await git(root, "rev-parse", "HEAD"));
  for (const path of files) {
    hash.update(path);
    try { hash.update(await readFile(await safeFile(root, path))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") hash.update("<deleted>"); else throw error; }
  }
  return { changedFiles: files, fingerprint: hash.digest("hex"), diffStat: await git(root, "diff", "--stat", "HEAD") };
}
export async function collectEvidence(record: RequestRecord, config: ProjectConfig, observation: Observation): Promise<ExecutionResult> {
  const before = await snapshot(record, config);
  const root = record.worktreePath!;
  const checks: ExecutionResult["checks"] = [];
  const deadline = Date.now() + 20000;
  for (const check of record.checks) {
    const began = Date.now();
    const command = check.kind === "node-test" ? `node --test --test-isolation=none ${check.path}` : `file-contains ${check.path}`;
    try {
      const path = await safeFile(root, check.path);
      let output: string;
      if (check.kind === "node-test") {
        if (!/\.(cjs|mjs|js)$/.test(path)) throw new Error("Node test files must end in .js, .mjs or .cjs.");
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Validation exceeded its 20 second budget.");
        // No shell, subprocesses, workers, addons, filesystem writes or inherited credentials.
        const result = await runNodeTest(root, path, Math.min(10000, remaining));
        output = result.stdout + result.stderr;
      } else {
        if (!(await readFile(path, "utf8")).includes(check.text)) throw new Error(`Required text not found: ${check.text}`);
        output = `Found required text in ${check.path}: ${check.text}`;
      }
      checks.push({ label: check.label, command, passed: true, exitCode: 0, output: output.slice(-16000), durationMs: Date.now() - began });
    } catch (error) {
      const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
      checks.push({ label: check.label, command, passed: false, exitCode: typeof failure.code === "number" ? failure.code : null,
        output: `${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.slice(-16000), durationMs: Date.now() - began });
    }
  }
  const after = await snapshot(record, config);
  return {
    id: randomUUID(), sourceKey: observation.sourceKey, collectedAt: new Date().toISOString(),
    finalResponse: observation.finalResponse.slice(-32000), agentStatus: observation.agentStatus,
    ...after, checks, executionFailure: observation.failure,
    failure: observation.failure ?? (before.fingerprint !== after.fingerprint ? "Files changed during validation. Run validation again." : checks.some(check => !check.passed) ? "One or more validation checks failed." : null),
  };
}
