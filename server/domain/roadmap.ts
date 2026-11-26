import type { Feature, Roadmap, Selection } from "../../shared/contracts/milestone-roadmap";

export function resolveRange(roadmap: Roadmap, selection: Selection) {
  const issues: string[] = [];
  const phases = new Set<string>(), milestones = new Set<string>();
  const owners = new Map<string, number>();
  let order = 0;
  for (const phase of roadmap.phases) {
    if (phases.has(phase.id)) issues.push("중복 Phase: " + phase.id);
    phases.add(phase.id);
    for (const milestone of phase.milestones) {
      if (milestones.has(milestone.id)) issues.push("중복 Milestone: " + milestone.id);
      milestones.add(milestone.id);
      for (const f of milestone.features) {
        if (owners.has(f.id)) issues.push("중복 Feature: " + f.id);
        owners.set(f.id, order);
      }
      order++;
    }
  }
  const list = roadmap.phases.find(p => p.id === selection.phase)?.milestones ?? [];
  const start = list.findIndex(m => m.id === selection.first), end = list.findIndex(m => m.id === selection.last);
  if (start < 0 || end < start) issues.push("구간의 Phase·시작·종료 순서를 확인하세요.");
  const selected = start < 0 || end < start ? [] : list.slice(start, end + 1);
  const nodes = selected.flatMap(m => {
    if (!m.features.length) issues.push(m.id + ": 빈 초안에 Feature를 추가하세요.");
    if (m.features.length > 5) issues.push(m.id + ": 최대 5개입니다. 여섯 번째부터 다른 Milestone으로 옮긴 뒤 구간을 다시 확인하세요.");
    return m.features.map(f => ({ ...f, milestone: m.id, context: [] as string[] }));
  });
  const local = new Map(nodes.map(n => [n.id, n]));
  const external = new Set<string>(), visited = new Set<string>(), visiting = new Set<string>();
  const walk = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) { issues.push("순환 의존: " + [...visiting, id].join(" → ")); return; }
    visiting.add(id);
    for (const dep of local.get(id)!.dependsOn) {
      if (!owners.has(dep)) issues.push(id + ": 선행 ID 없음 " + dep);
      else if (owners.get(dep)! > owners.get(id)!) issues.push(id + ": 뒤 Milestone을 선행으로 지정함 " + dep);
      if (local.has(dep)) walk(dep); else external.add(dep);
    }
    visiting.delete(id); visited.add(id);
  };
  for (const n of nodes) walk(n.id);
  const sorted: typeof nodes = [];
  if (!issues.length) {
    const ready = new Set<string>();
    for (const milestone of selected) {
      const remaining = nodes.filter(n => n.milestone === milestone.id);
      const prioritized = remaining.some(n => n.priority !== undefined);
      const readySince = new Map<string,number>();
      while (remaining.length) {
        const eligible = remaining.filter(n => n.dependsOn.every(dep => !local.has(dep) || ready.has(dep)));
        if (!eligible.length) break;
        if (prioritized) {
          for (const n of eligible) if (!readySince.has(n.id)) readySince.set(n.id,sorted.length);
          eligible.sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0) || readySince.get(a.id)! - readySince.get(b.id)!
            || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        }
        const next = eligible[0];
        remaining.splice(remaining.indexOf(next),1);
        sorted.push(next); ready.add(next.id);
      }
    }
  }
  return { milestones: selected.map(m => m.id), nodes: sorted.length === nodes.length ? sorted : nodes, external, issues };
}

export function markdownSection(text: string, fragment: string) {
  const slug = (value:string) => value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,"").replace(/\s+/g,"-");
  const lines=text.split(/\r?\n/);
  let start=-1, end=lines.length, level=0, fence="";
  for (const [i,line] of lines.entries()) {
    const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) { if(!fence) fence=marker[1]; else if(marker[1].startsWith(fence)) fence=""; continue; }
    if (fence) continue;
    const heading=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    if (start>=0 && end===lines.length && heading[1].length<=level) end=i;
    if (slug(heading[2])===slug(fragment)) {
      if (start>=0) throw new Error("AMBIGUOUS_SECTION");
      start=i;level=heading[1].length;
    }
  }
  if (start<0 || !slug(fragment)) throw new Error("SECTION_NOT_FOUND");
  return lines.slice(start,end).join("\n");
}

export function applies(scope: string, f: Feature, engine?: string) {
  const tags = ["all", "global", "game", "project", f.discipline, "discipline:" + f.discipline,
    "role:" + f.role, "task:" + f.id, "engine:" + engine];
  if (tags.includes(scope)) return true;
  const prefix = scope.replace(/^path:/, "").replace(/\/\*\*$/, "").replace(/\/$/, "");
  return f.outputs.some(p => p === prefix || p.startsWith(prefix + "/"));
}
