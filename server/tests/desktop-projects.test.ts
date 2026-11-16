import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, symlink, cp } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { Projects, inspectProjectInstructions } from "../application/desktop/projects";
import { digest, safePath } from "../adapters/storage/project-files";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "orchiva-d2-")), source = join(root, "소스 경로"), output = join(root, "결과물");
  await mkdir(source); await mkdir(output);
  const projects = new Projects(join(root, "registry"));
  return { root, source, output, projects, async close() { await projects.close(); const rel = relative(tmpdir(), root); assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel)); await rm(root, { recursive: true, force: true }); } };
}
test("project registration writes no source; initialization is repeatable and rediscovered", async () => {
  const f = await fixture();
  try {
    const p = await f.projects.register(f.source, "테스트"); assert.deepEqual(await readdir(f.source), []);
    const preview = await f.projects.preview(p.projectId); assert.ok(preview.changes.length >= 7);
    await f.projects.initialize(p.projectId, preview.fingerprint, "initialize-001");
    const report = await inspectProjectInstructions(f.source); assert.equal(report.ready, true);
    const again = await f.projects.preview(p.projectId); assert.deepEqual(again.changes, []);
    await f.projects.initialize(p.projectId, preview.fingerprint, "initialize-001");
    assert.equal((await f.projects.register(f.source, "다른 이름")).projectId, p.projectId);
    const configured = await f.projects.configure(p.projectId, 1, { name: "설정", baseRef: "main", outputRoot: f.output });
    assert.equal(configured.config?.revision, 2); assert.equal(await f.projects.output(p.projectId), f.output);
    await assert.rejects(f.projects.configure(p.projectId, 2, { name: "설정", baseRef: "main", outputRoot: f.source }), /OVERLAP/);
    const other = new Projects(join(f.root, "registry-other"));
    try { assert.equal((await other.register(f.source, "등록")).projectId, p.projectId); await assert.rejects(other.initialize(p.projectId, again.fingerprint, "initialize-002"), /STORE_OWNED/); } finally { await other.close(); }
  } finally { await f.close(); }
});
test("initialization preserves custom instructions, detects stale previews and migration collisions", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, "AGENTS.md"), "# 기존 규칙\n이 규칙을 보존한다.\n");
    await mkdir(join(f.source, "docs/plans"), { recursive: true }); await writeFile(join(f.source, "docs/plans/AGENTS.md"), "# 원래 계획 지침\n");
    const p = await f.projects.register(f.source, "테스트"), preview = await f.projects.preview(p.projectId);
    await writeFile(join(f.source, "AGENTS.md"), "# 외부 편집\n");
    await assert.rejects(f.projects.initialize(p.projectId, preview.fingerprint, "initialize-001"), /STALE/);
    const fresh = await f.projects.preview(p.projectId); await f.projects.initialize(p.projectId, fresh.fingerprint, "initialize-002");
    assert.match(await readFile(join(f.source, "AGENTS.md"), "utf8"), /외부 편집/);
    assert.equal(await readFile(join(f.source, "docs/plans/plans.md"), "utf8"), "# 원래 계획 지침\n");
    await assert.rejects(readFile(join(f.source, "docs/plans/AGENTS.md")), { code: "ENOENT" });
    await writeFile(join(f.source, "docs/plans/AGENTS.md"), "# 충돌\n");
    assert.ok((await f.projects.preview(p.projectId)).issues.some(x => x.includes("CONFLICT")));
    assert.equal((await f.projects.instructions(p.projectId)).ready, false);
  } finally { await f.close(); }
});
test("instruction edits preserve external changes and backups; root escapes and duplicate project IDs fail", async () => {
  const f = await fixture();
  try {
    const p = await f.projects.register(f.source, "테스트"), init = await f.projects.preview(p.projectId); await f.projects.initialize(p.projectId, init.fingerprint, "initialize-001");
    const report = await f.projects.instructions(p.projectId), file = report.files.find(x => x.path === "docs/agents/workflow.md")!;
    await writeFile(join(f.source, file.path), "외부 변경");
    await assert.rejects(f.projects.saveInstruction(p.projectId, file.path, file.hash, "덮어쓰기", "all"), /FILE_CHANGED/);
    await f.projects.saveInstruction(p.projectId, file.path, digest("외부 변경"), "확인한 수정", "all");
    assert.equal(await readFile(join(f.source, "docs/.orchiva/backups/instructions", digest("외부 변경") + ".md"), "utf8"), "외부 변경");
    await symlink(f.output, join(f.source, "escape"), "junction"); await assert.rejects(safePath(f.source, "escape/new.md"), /PATH_ESCAPE/);
    await assert.rejects(safePath(f.source, "../outside.md"), /INVALID_PATH/);
    const copy = join(f.root, "clone"); await mkdir(copy); await mkdir(join(copy, "docs/.orchiva"), { recursive: true }); await cp(join(f.source, "docs/.orchiva/project.json"), join(copy, "docs/.orchiva/project.json"));
    await assert.rejects(f.projects.register(copy, "복제"), /DUPLICATE_PROJECT_ID/);
  } finally { await f.close(); }
});
