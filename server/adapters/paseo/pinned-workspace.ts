import type { PaseoApi } from "@getpaseo/client";
import { assertSandbox, assertWorktree, git, type ProjectConfig } from "../../config/project-config";

export async function createPinnedWorkspace(api: PaseoApi, config: ProjectConfig, input: { key: string; title: string; branch: string; commit: string }) {
  await assertSandbox(config);
  if (!/^[a-f0-9]{40}$/.test(input.commit)) throw new Error("A full commit SHA is required.");
  if (await git(config.repositoryPath, "rev-parse", "--verify", `${input.commit}^{commit}`) !== input.commit) throw new Error("Unknown base commit.");
  const workspace = await api.workspaces.create({ idempotencyKey: input.key, title: input.title,
    source: { kind: "worktree", cwd: config.repositoryPath, action: "branch-off", refName: input.commit, branchName: input.branch } });
  if (!workspace.directory) throw new Error("Workspace has no directory.");
  await assertWorktree(config, workspace.directory);
  if (await git(workspace.directory, "rev-parse", "HEAD") !== input.commit) throw new Error("Created workspace differs from the confirmed commit.");
  return workspace;
}
