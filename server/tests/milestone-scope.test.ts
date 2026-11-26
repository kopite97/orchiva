import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { roadmapSchema } from "../../shared/contracts/milestone-roadmap";
import { resolveRange, markdownSection } from "../domain/roadmap";
import { Projects } from "../application/desktop/projects";
import { ProductionService } from "../application/desktop/production";
import { Roadmaps } from "../application/desktop/roadmap";
import { git } from "../config/project-config";

const range = { phase: "P", first: "M", last: "M" };
function fixture(count: number) {
  const features = Array.from({ length: count }, (_, i) => ({ id: "F" + i, title: "점수", goal: "계산", outputs: ["out" + i] }));
  return roadmapSchema.parse({ version: 1, phases: [{ id: "P", milestones: [{ id: "M", features }, { id: "N", features: [{ ...features[0], id: "X", title: "QA", goal: "확인", outputs: ["qa"] }] }] }] });
}
test("range boundaries, direction and stable dependency diagnostics", () => {
  for (const n of [0,1,5,6]) assert.equal(resolveRange(fixture(n),range).issues.length === 0,n === 1 || n === 5);
  const map = fixture(5);
  assert.equal(resolveRange(map, { ...range, last: "N" }).nodes.length, 6);
  assert.ok(resolveRange(map,{ ...range,first: "N" }).issues.length);
  const nodes = map.phases[0].milestones[0].features;
  nodes[0].dependsOn = ["F1","absent","X"]; nodes[1].dependsOn = ["F0"];
  const errors = resolveRange(map,range).issues.join(" ");
  for (const e of ["순환","선행 ID 없음","뒤 Milestone"]) assert.ok(errors.includes(e));
  nodes[1].id = "F0";
  assert.match(resolveRange(map,range).issues.join(" "),/중복/);
});
test("explicit priorities rank eligible nodes by priority, readiness age, then stable ID", () => {
  const map=fixture(4), nodes=map.phases[0].milestones[0].features;
  nodes[3].priority=5;
  nodes[0].dependsOn=["F3"];
  assert.deepEqual(resolveRange(map,range).nodes.map(n=>n.id),["F3","F1","F2","F0"]);
});
test("project scope freezes file contents, detects conflicts, stale updates, missing input and escape",async t => {
  const root = await mkdtemp(join(tmpdir(),"orchiva-roadmap-")), source = join(root,"source");
  await mkdir(source); await git(source,"init","-b","main"); await git(source,"-c","user.name=fixture","-c","user.email=f@test.invalid","commit","--allow-empty","-m","baseline");
  const projects = new Projects(join(root,"registry"));
  t.after(() => projects.close());
  const p = await projects.register(source,"fixture"), id = p.projectId;
  await projects.initialize(id,(await projects.preview(id)).fingerprint,"init-roadmap-001");
  const service = new Roadmaps(projects, {} as ProductionService), map = fixture(1);
  await service.save(id,null,map);
  const good = await service.preview(id,range);
  assert.deepEqual(good.issues,[]); assert.equal((await service.preview(id,range)).hash,good.hash);
  const markdown="# 규칙\n## 기본 점수\n10점\n### 예시\nHUD\n## 제외\n외부\n";
  await writeFile(join(source,"rules.md"),markdown);
  await writeFile(join(source,"rules-copy.md"),markdown);
  const referenced=structuredClone(map);
  referenced.phases[0].milestones[0].features[0].references=["rules.md#기본-점수","rules-copy.md"];
  const saved=await service.save(id,good.revision,referenced);
  const selected=await service.preview(id,range);
  assert.deepEqual(selected.issues,[]);assert.match(selected.excerpts![0].content,/HUD/);assert.doesNotMatch(selected.excerpts![0].content,/외부/);
  assert.equal(selected.files.find(f=>f.path==="rules-copy.md")?.sameContentAs,"rules.md");
  assert.throws(()=>markdownSection(markdown+"\n## 기본 점수\n20점","기본-점수"),/AMBIGUOUS/);
  await service.save(id,saved.revision,map);
  await writeFile(join(source,"docs/agents/workflow.md"),"@policy score=42");
  assert.notEqual((await service.preview(id,range)).hash,good.hash);
  await writeFile(join(source,"docs/plans/plans.md"),"@policy score=24");
  map.phases[0].milestones[0].features[0].references = ["../escape","no-file"];
  await assert.rejects(service.save(id,null,map),/REVISION_CONFLICT/);
  await service.save(id,good.revision,map);
  const errors = (await service.preview(id,range)).issues.join(" ");
  for (const e of ["정책 충돌","읽을 수 없는 입력","입력 누락"]) assert.ok(errors.includes(e));
});
