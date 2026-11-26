import { type Roadmap, type Selection, type Scope, roadmapSchema } from "../../../shared/contracts/milestone-roadmap";
import { bytes, digest, atomic, relativeFile, safePath } from "../../adapters/storage/project-files";
import { git } from "../../config/project-config";
import { resolveRange, applies, markdownSection } from "../../domain/roadmap";
import type { Projects } from "./projects";
import type { ProductionService } from "./production";
import { internalFile } from "./snapshots";

import { z } from "zod";
import { phaseDecision } from "../../../shared/contracts/phase-acceptance";
import { join } from "node:path";
const enrollment = (id:string) => "acceptance/" + id + "/profile.json";
const roadmapPath = "docs/roadmap/roadmap.json";
export const emptyRoadmap: Roadmap = { version: 1, phases: [], evidence: [] };

export class Roadmaps {
  constructor(readonly projects: Projects, readonly production: ProductionService) {}

  async read(id: string) {
    const { sourceRoot } = await this.projects.project(id);
    const raw = await bytes(sourceRoot, roadmapPath, 256 * 1024);
    if (!raw) return { revision: null, roadmap: emptyRoadmap };
    try { return { revision: digest(raw), roadmap: roadmapSchema.parse(JSON.parse(raw.toString("utf8"))) }; }
    catch { throw new Error("ROADMAP_INVALID"); }
  }

  async save(id: string, expected: string | null, roadmap: Roadmap) {
    return this.projects.exclusive(async () => {
      const { sourceRoot } = await this.projects.project(id);
      await this.projects.own(sourceRoot);
      const current = await this.read(id);
      const content = JSON.stringify(roadmapSchema.parse(roadmap), null, 2) + "\n";
      if (Buffer.byteLength(content) > 256 * 1024) throw new Error("INPUT_SIZE_LIMIT");
      const enrolled=await bytes(this.projects.directory,enrollment(id));
      if ((enrolled || current.roadmap.acceptance) && !roadmap.acceptance) throw Error("PHASE_PROFILE_REQUIRED");
      if (current.revision !== digest(content) && expected !== current.revision) throw Error("REVISION_CONFLICT");
      if (roadmap.acceptance) await atomic(join(this.projects.directory,enrollment(id)),JSON.stringify(roadmap.acceptance));
      if (current.revision === digest(content)) return current;
      await atomic(await safePath(sourceRoot, roadmapPath), content);
      return { revision: digest(content), roadmap };
    });
  }

  async preview(id: string, selection: Selection): Promise<Scope> {
    const { sourceRoot, config } = await this.projects.project(id);
    const { revision, roadmap } = await this.read(id);
    if (!revision) throw new Error("ROADMAP_REQUIRED");
    const { milestones, nodes, issues, external } = resolveRange(roadmap, selection);
    const enrolled=await bytes(this.projects.directory,enrollment(id));
    if ((enrolled || roadmap.acceptance) && enrolled?.toString()!==JSON.stringify(roadmap.acceptance)) issues.push("PHASE_PROFILE_CHANGED");
    if (roadmap.acceptance) {
      const protectedChecks=new Set(roadmap.acceptance.roles.flatMap(r=>r.checks).map(p=>p.toLowerCase()));
      for (const node of nodes) {
        const roles=roadmap.acceptance.roles.filter(r=>r.role===node.role);
        const role=roles[0];
        if (roles.length!==1) { issues.push(node.id+": PHASE_ROLE_REQUIRED"); continue; }
        if (!["planning","coding","level","qa"].includes(role.tool)) issues.push(node.id+": PHASE_TOOL_UNAVAILABLE "+role.tool);
        if ((role.tool==="planning") !== (node.discipline==="planning")) issues.push(node.id+": PHASE_DISCIPLINE_CONFLICT");
        if (node.outputs.some(path=>!role.outputs.includes(path) || protectedChecks.has(path.toLowerCase())) || (role.tool==="level" && node.outputs.some(p=>!/^Assets\/.+\.(json|unity|asset)$/.test(p))))
          issues.push(node.id+": PHASE_OUTPUT_POLICY");
        node.checks=[...new Set([...role.checks,...node.checks])];
        if(node.checks.length>8) issues.push(node.id+": PHASE_CHECK_LIMIT");
      }
    }
    const instructions = await this.projects.instructions(id);
    issues.push(...instructions.issues);
    const files = new Map<string, Scope["files"][number]>();
    const excerpts = new Map<string, NonNullable<Scope["excerpts"]>[number]>();
    const unique = new Set<string>();
    let size = 0;
    for (const node of nodes) {
      if (new Set(node.outputs.map(p=>p.toLowerCase())).size !== node.outputs.length) issues.push(node.id + ": 중복 출력 경로");
      const policies = new Map<string, string>();
      const selected = instructions.files.filter(f => applies(f.scope, node, roadmap.engine));
      const paths = [...new Set([...selected.map(f => f.path), ...node.references, ...node.checks])];
      for (const reference of paths) {
        const separator = node.references.includes(reference) ? reference.indexOf("#") : -1;
        const path = separator < 0 ? reference : reference.slice(0,separator);
        try {
          if (relativeFile(path) !== path || (internalFile(path) && !selected.some(f => f.path === path)) || path.split("/").some(s => s.startsWith("."))) throw new Error("INVALID_PATH");
          if (!files.has(path)) {
            const content = await bytes(sourceRoot, path, 96 * 1024);
            if (!content) { issues.push(node.id + ": 입력 누락 " + path); continue; }
            const hash = digest(content);
            if (!unique.has(hash)) { unique.add(hash); size += content.length; }
            if (size > 128 * 1024 || [...files.values()].reduce((n, f) => n + Buffer.byteLength(f.content), 0) + content.length > 256 * 1024) {
              issues.push("필수 입력 예산 초과"); break;
            }
            files.set(path, { path, hash, content: content.toString("utf8") });
          }
          if (separator >= 0) {
            if (!/\.md$/i.test(path)) throw new Error("MARKDOWN_REQUIRED");
            const content=markdownSection(files.get(path)!.content,decodeURIComponent(reference.slice(separator+1)));
            excerpts.set(reference,{reference,path,hash:digest(content),content});
          }
          node.context.push(reference);
          if (selected.some(f => f.path === path)) {
            for (const match of files.get(path)!.content.matchAll(/^@policy ([\w.-]+)=(.+)$/gm)) {
              const value = match[2].trim(), previous = policies.get(match[1]);
              if (previous && previous !== value) issues.push(node.id + ": 정책 충돌 " + match[1] + " (" + path + ")");
              policies.set(match[1], value);
            }
          }
        } catch { issues.push(node.id + ": 읽을 수 없는 입력 " + reference); }
      }
      for (const path of node.outputs) {
        try {
          if (relativeFile(path) !== path || path.split("/").some(s => s.startsWith(".")) || /^docs\/(?:roadmap|agents|plans|decisions|evidence)\//i.test(path) || /(^|\/)AGENTS\.md$/i.test(path) || internalFile(path) || nodes.some(n => [...n.references,...n.checks].some(ref => ref.split("#")[0].toLowerCase() === path.toLowerCase())) || instructions.files.some(f => f.path.toLowerCase() === path.toLowerCase())) throw new Error();
          await safePath(sourceRoot, path);
        } catch { issues.push(node.id + ": 보호되거나 잘못된 출력 경로 " + path); }
      }
    }
    const evidence = roadmap.evidence.filter(e => external.has(e.featureId));
    if(roadmap.acceptance && external.size) {
      const raw=await bytes(this.projects.directory,"acceptance/"+id+"/decisions.json",8*1024*1024);
      const decisions=raw?z.array(phaseDecision).parse(JSON.parse(raw.toString())):[];
      for(const phase of roadmap.phases.slice(0,roadmap.phases.findIndex(p=>p.id===selection.phase))) {
        const latest=decisions.filter(d=>d.projectId===id && d.phase===phase.id).at(-1);
        if(latest?.verdict!=="approve" || latest.roadmapRevision!==revision)continue;
        evidence.push(...latest.sources.filter(s=>external.has(s.featureId) && !evidence.some(e=>e.featureId===s.featureId)));
      }
    }
    for (const featureId of external) {
      const matches = evidence.filter(e => e.featureId === featureId);
      const e = matches[0];
      const doc = matches.length === 1 ? await (await this.production.store(id)).envelope(e.token) : null;
      if (!doc || doc.engine.status !== "completed" || !doc.reviews.some(r => r.approved && r.resultId === e.resultId && r.fingerprint === e.fingerprint) ||
          doc.engine.result?.id !== e.resultId || doc.engine.result.fingerprint !== e.fingerprint)
        issues.push("수용 근거가 없는 범위 밖 선행: " + featureId);
    }
    const baseCommit = await git(sourceRoot, "rev-parse", "--verify", config.baseRef + "^{commit}");
    if ([...excerpts.values()].reduce((size,e)=>size+Buffer.byteLength(e.content),0)>128*1024) issues.push("문서 절 입력 예산 초과");
    const canonical = new Map<string,string>();
    const manifest = [...files.values()].map(f => {
      const sameContentAs=canonical.get(f.hash);
      if (sameContentAs) return {...f,content:"",sameContentAs};
      canonical.set(f.hash,f.path);return f;
    });
    const scope = { ...(roadmap.acceptance?{acceptance:roadmap.acceptance}:{}), projectId: id, revision, selection, milestones, nodes, baseCommit, files: manifest, ...(excerpts.size ? {excerpts:[...excerpts.values()]} : {}), external: evidence, issues: [...new Set(issues)] };
    return { ...scope, hash: digest(JSON.stringify(scope)) };
  }
}
