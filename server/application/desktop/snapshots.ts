import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { git } from "../../config/project-config";
import { bytes, digest, immutable, relativeFile } from "../../adapters/storage/project-files";
import { Projects } from "./projects";
import type { Binding } from "../../../shared/contracts/milestone-run";
import { snapshotTree } from "../../adapters/storage/integration-git";
import type { ProductionInput } from "../../../shared/contracts/desktop-production";
import { productionSchema } from "../../../shared/contracts/desktop-production";
const execute = promisify(execFile);
export const inputSnapshot = z.object({ version: z.literal(1), baseCommit: z.string(), projectRevision: z.number(), instructionFingerprint: z.string(), inputHash: z.string(), parentContext: z.string().optional(), files: z.array(z.object({ path: z.string(), hash: z.string().nullable(), base64: z.string().nullable() })), fingerprint: z.string() });
export type InputSnapshot = z.infer<typeof inputSnapshot>;
export const internalFile = (path: string) => path.startsWith("docs/.orchiva/") || path.startsWith("docs/evidence/") || path.startsWith(".orchiva/") || path.startsWith(".git/") || /^docs\/(plans|decisions)\/plan-/.test(path) || path === "docs/plans/README.md";
export async function captureInput(projects: Projects, id: string, input: ProductionInput, binding?:Binding) {
  const p = await projects.project(id), instructions = await projects.instructions(id);
  if (!instructions.ready) throw new Error("INSTRUCTIONS_NOT_READY");
  const baseCommit = binding?.integrationBase ?? await git(p.sourceRoot, "rev-parse", "--verify", `${p.config.baseRef}^{commit}`);
  const selected=binding?.unityProfile?new Set([...instructions.files.map(f=>f.path),...binding.inputs.map(f=>f.path),...binding.checks.map(f=>f.path),...binding.outputs,...(binding.readPaths??[])]):null;
  const committed=binding?.integrationBase?await snapshotTree(p.sourceRoot,baseCommit,path=>selected?selected.has(path):!internalFile(path)||instructions.files.some(f=>f.path===path)):null;
  const stdout = committed ? [...committed.keys()].join("\0") : (await execute("git", ["-C", p.sourceRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })).stdout;
  const paths = [...new Set([...stdout.split("\0").filter(Boolean), ...instructions.files.map(x => x.path), ...(binding?.inputs.map(f=>f.path)??[])]) ].filter(x => !internalFile(x) || instructions.files.some(f => f.path === x)).sort();
  if (paths.length > 1000) throw new Error("INPUT_FILE_LIMIT");
  const files: InputSnapshot["files"] = []; let size = 0;
  for (const path of paths) {
    relativeFile(path);
    const approvedInput=binding?.inputs.find(f=>f.path===path);
    let content:Buffer|null;
    if(!binding?.integrationBase) content=await bytes(p.sourceRoot,path);
    else {
      content=committed!.get(path)??null;
      if(approvedInput && (content?digest(content):null)!==approvedInput.hash) {
        content=await bytes(p.sourceRoot,path);
        if((content?digest(content):null)!==approvedInput.hash) throw new Error("MILESTONE_INPUT_CHANGED");
      }
    }
    size += content?.length ?? 0; if (size > 16 * 1024 * 1024) throw new Error("INPUT_SIZE_LIMIT");
    files.push({ path, hash: content ? digest(content) : null, base64: content?.toString("base64") ?? null });
  }
  let parentContext: string | undefined;
  if (input.mode === "modify" && input.parentToken) {
    const original = await bytes(p.sourceRoot, `docs/.orchiva/requests/${input.parentToken}.json`); if (!original) throw new Error("PARENT_RESULT_INVALID");
    const parent = productionSchema.parse(JSON.parse(original.toString("utf8"))), result = parent.engine.results.find(x => x.id === input.parentResultId);
    if (!result) throw new Error("PARENT_RESULT_INVALID");
    parentContext = JSON.stringify({ token: parent.token, resultId: result.id, fingerprint: result.fingerprint, title: parent.input.title, goal: parent.input.goal, changedFiles: result.changedFiles, response: result.finalResponse.slice(0, 20000), note: "이전 결과는 참고 맥락이다. 실행 기준은 현재 소스 snapshot이며 이전 결과를 자동 반영하지 않는다." });
  }
  const snapshot: InputSnapshot = { version: 1, baseCommit, projectRevision: p.config.revision, instructionFingerprint: instructions.fingerprint, inputHash: digest(JSON.stringify(input)), ...(parentContext ? { parentContext } : {}), files, fingerprint: digest(JSON.stringify(files.map(({ path, hash }) => ({ path, hash })))) };
  return snapshot;
}
export async function storeSnapshot(root: string, snapshot: InputSnapshot) { const content = JSON.stringify(snapshot), id = digest(content); await immutable(root, `docs/.orchiva/snapshots/${id}.json`, content); return id; }
export async function loadSnapshot(root: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("SNAPSHOT_ID_INVALID");
  const content = await bytes(root, `docs/.orchiva/snapshots/${id}.json`, 24 * 1024 * 1024);
  if (!content || digest(content) !== id) throw new Error("SNAPSHOT_INVALID"); return inputSnapshot.parse(JSON.parse(content.toString("utf8")));
}
export function sameInput(a: InputSnapshot, b: InputSnapshot) { return a.baseCommit === b.baseCommit && a.projectRevision === b.projectRevision && a.instructionFingerprint === b.instructionFingerprint && a.inputHash === b.inputHash && a.fingerprint === b.fingerprint && a.parentContext === b.parentContext; }
