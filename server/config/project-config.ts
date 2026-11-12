import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
const execute = promisify(execFile);
export const configDirectory = join(homedir(), ".orchiva");
export const configSchema = z.object({ name: z.literal("PoC Sandbox"), repositoryPath: z.string().min(1), baseRef: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/), provider: z.string().regex(/^codex\/.+$/) });
export type ProjectConfig = z.infer<typeof configSchema>;
export async function loadConfig(): Promise<ProjectConfig> {
  return configSchema.parse(JSON.parse(await readFile(join(configDirectory, "project.json"), "utf8")));
}
export async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execute("git", ["-C", cwd, ...args], { windowsHide: true, timeout: 15000 });
  return stdout.trim();
}
export async function assertSandbox(config: ProjectConfig) {
  const allowed = await realpath(join(homedir(), "lib", "orchiva-PoC")), actual = await realpath(config.repositoryPath);
  if (actual.toLowerCase() !== allowed.toLowerCase()) throw new Error("Only the registered PoC sandbox path is allowed.");
  const root = await realpath(await git(actual, "rev-parse", "--show-toplevel"));
  if (root.toLowerCase() !== allowed.toLowerCase()) throw new Error("The target must be the sandbox repository root.");
  const remote = await git(actual, "remote", "get-url", "origin");
  if (!["https://github.com/kopite97/PoC-sandbox.git", "https://github.com/kopite97/PoC-sandbox", "git@github.com:kopite97/PoC-sandbox.git"].includes(remote)) throw new Error("The origin must be kopite97/PoC-sandbox. Production repositories are excluded.");
  await git(actual, "rev-parse", "--verify", `${config.baseRef}^{commit}`);
}
export async function assertWorktree(config: ProjectConfig, directory: string) {
  await assertSandbox(config);
  const actual = await realpath(directory);
  if (actual.toLowerCase() === (await realpath(config.repositoryPath)).toLowerCase()) throw new Error("A separate worktree is required.");
  const common = async (cwd: string) => realpath(resolve(cwd, await git(cwd, "rev-parse", "--git-common-dir")));
  if ((await common(actual)).toLowerCase() !== (await common(config.repositoryPath)).toLowerCase()) throw new Error("Worktree does not belong to the sandbox.");
}
