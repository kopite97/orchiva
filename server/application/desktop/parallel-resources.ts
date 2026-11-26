import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Scope } from "../../../shared/contracts/milestone-roadmap";
import { absent, safePath } from "../../adapters/storage/project-files";
import { treeFile } from "../../adapters/storage/integration-git";

export async function featureResources(root:string, repo:string, base:string, spec:Scope["nodes"][number]) {
  const keys = new Set<string>();
  for (const resource of spec.resources ?? []) keys.add("lock:"+resource.trim().normalize("NFC").toLowerCase());
  for (const [access, paths] of [["write",spec.outputs],["read",spec.context.map(p=>p.split("#")[0])]] as const) {
    for (const path of paths) {
      await safePath(root,path);
      let prefix=root;
      for(const segment of path.split("/")) {
        prefix=join(prefix,segment);
        try { if ((await lstat(prefix)).isSymbolicLink()) throw new Error("MILESTONE_RESOURCE_ALIAS"); }
        catch(e) { if (absent(e)) break; throw e; }
      }
      const name=path.normalize("NFC").toLowerCase().replace(/\.meta$/,"");
      keys.add(access+":"+name);

      const meta=await treeFile(repo,base,/\.meta$/i.test(path)?path:path+".meta");
      const guid=meta?.bytes.toString().match(/^guid:\s*([a-f\d]{32})\s*$/im)?.[1];
      if (guid) keys.add(access+":guid:"+guid.toLowerCase());
      if (access === "read") continue;
      if (/^(packages|projectsettings)(\/|$)/.test(name)) keys.add("exclusive:project");
      if (/\.(unity|prefab)$/.test(name)) keys.add("lock:unity-editor");
      if (/\.meta$/i.test(path)) keys.add("lock:asset-metadata");
    }
  }
  return [...keys].sort();
}

export function resourceConflict(left:string[],right:string[]) {
  if (left.includes("exclusive:project") || right.includes("exclusive:project")) return "Packages/ProjectSettings";
  for(const a of left) for(const b of right) {
    if(a.startsWith("lock:") || b.startsWith("lock:")) { if (a===b) return a.slice(5); continue; }
    if(a.startsWith("read:") && b.startsWith("read:")) continue;
    const x=a.slice(a.indexOf(":")+1), y=b.slice(b.indexOf(":")+1);
    if(x===y || x.startsWith(y+"/") || y.startsWith(x+"/")) return x;
  }
  return null;
}
