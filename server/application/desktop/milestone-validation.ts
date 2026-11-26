import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Binding } from "../../../shared/contracts/milestone-run";
import type { ExecutionResult, RequestRecord } from "../../../shared/contracts/feature-request";
import type { InputSnapshot } from "./snapshots";
import { bytes, digest, immutable, safePath } from "../../adapters/storage/project-files";
import { git } from "../../config/project-config";
import { gitBytes, gitText, snapshotTree } from "../../adapters/storage/integration-git";
import { internalFile } from "./snapshots";
import type { TransferManifest } from "./transfers";
import { runNodeTest, snapshotFiles } from "../../adapters/storage/evidence";

export function validateSnapshot(binding: Binding, snapshot: InputSnapshot) {
  const hashes = new Map(snapshot.files.map(f => [f.path, f.hash]));
  for (const f of [...binding.inputs, ...binding.checks])
    if ((hashes.get(f.path) ?? null) !== f.hash) throw new Error("MILESTONE_INPUT_CHANGED");
}

/** Validate a worker's old-base result with the files already integrated by its peers. */
export async function validateParallelBase(repo:string, base:string, binding:Binding, snapshot:InputSnapshot, changes:TransferManifest["files"]) {
  await gitText(repo,["merge-base","--is-ancestor",binding.integrationBase!,base]);
  const moved=(await gitBytes(repo,["diff","--name-only","--no-renames","-z",binding.integrationBase!,base])).toString().split("\0").filter(Boolean);
  const guarded=new Set([...binding.outputs,...binding.inputs.map(f=>f.path)].map(s=>s.toLowerCase()));
  if (moved.some(s=>guarded.has(s.toLowerCase()))) throw new Error("INTEGRATION_BASE_MOVED");
  if (!binding.checks.length) return;
  const selected=new Set(snapshot.files.map(f=>f.path));
  const files=await snapshotTree(repo,base,path=>binding.unityProfile?selected.has(path):!internalFile(path));
  for(const f of snapshot.files) {
    if (!files.has(f.path) && f.base64!==null && binding.inputs.some(i=>i.path===f.path)) files.set(f.path,Buffer.from(f.base64,"base64"));
  }
  for (const f of changes) {
    if (f.content===null) files.delete(f.path);
    else files.set(f.path,Buffer.from(f.content,"base64"));
  }
  const dir=await mkdtemp(join(tmpdir(),"orchiva-parallel-check-"));
  try {
    for (const [path,data] of files) await immutable(dir,path,data);
    for (const check of binding.checks) {
      const file=files.get(check.path);
      if (!file || digest(file)!==check.hash) throw new Error("MILESTONE_CHECK_CHANGED");
      await runNodeTest(dir,await safePath(dir,check.path),10000);
    }
  } finally { await rm(dir,{recursive:true,force:true}); }
}

export async function validateOutputs(binding: Binding, snapshot: InputSnapshot, record: RequestRecord, result: ExecutionResult) {
  const root = record.worktreePath!;
  const baseline = new Map(snapshot.files.map(f => [f.path, f.hash]));
  baseline.set("docs/.orchiva/input-snapshot.json", digest(JSON.stringify({ fingerprint: snapshot.fingerprint })));
  for (const plan of [record.requestPlan, record.taskPlan]) baseline.set(".orchiva/plans/" + plan.id + ".md", digest(plan.content));
  if (await git(root, "rev-parse", "HEAD") !== snapshot.baseCommit) throw new Error("MILESTONE_BASE_CHANGED");
  const ignored = (await git(root, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")).split("\0").filter(Boolean);
  const paths = new Set([...baseline.keys(), ...result.changedFiles, ...ignored]);
  for (const path of paths) {
    if (binding.outputs.includes(path)) continue;
    if(binding.unityProfile && !baseline.has(path))throw new Error("MILESTONE_SCOPE_VIOLATION: "+path);
    const content = await bytes(root, path);
    if ((content ? digest(content) : null) !== (baseline.get(path) ?? null)) throw new Error("MILESTONE_SCOPE_VIOLATION: " + path);
  }
  const sandbox = await mkdtemp(join(tmpdir(), "orchiva-validation-"));
  try {
    for (const f of snapshot.files) if (f.base64 !== null && !binding.outputs.includes(f.path)) await immutable(sandbox, f.path, Buffer.from(f.base64, "base64"));
    for (const path of binding.outputs) {
      const content = await bytes(root, path);
      if (!content && !baseline.get(path)) throw new Error("MILESTONE_OUTPUT_MISSING: " + path);
      if (content) await immutable(sandbox, path, content);
    }
    for (const [i, check] of binding.checks.entries()) {
      const start = Date.now(), id = record.checks[i]?.id;
      if (!id || record.checks[i].path !== check.path) throw new Error("MILESTONE_CHECK_MISSING");
      const content = await bytes(sandbox, check.path);
      if (!content || digest(content) !== check.hash) throw new Error("MILESTONE_CHECK_CHANGED");
      let output: string, passed = true;
      try { const ran = await runNodeTest(sandbox, await safePath(sandbox, check.path), 10000); output = ran.stdout + ran.stderr; }
      catch (e) { passed = false; output = (e as { stdout?: string }).stdout || String(e); }
      result.checks.push({
        checkId: id, label: check.path, command: "node --test " + check.path, passed, status: passed ? "passed" : "failed",
        inputFingerprint: check.hash, exitCode: passed ? 0 : 1, durationMs: Date.now() - start, output: output.slice(-16000)
      });
      if (!passed) result.failure = "MILESTONE_CHECK_FAILED";
    }
  } finally { await rm(sandbox, { recursive: true, force: true }); }
  const after = await snapshotFiles(root, record.checks);
  if (after.fingerprint !== result.fingerprint) result.failure = "MILESTONE_INPUT_CHANGED";
}
