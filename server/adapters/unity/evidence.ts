import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SaxesParser } from "saxes";
import { gitBytes, gitText, treeFile } from "../storage/integration-git";
import { relativeFile } from "../storage/project-files";

export const editorVersion="6000.3.27f1";
export const editTests=["HudRulesTests.ApprovedAward","HudRulesTests.ApprovedLabel"];
export const playTests=["HudPlayTests.CollectUpdatesSceneHud"];

export function verifyXml(xml:string, expected:string[], interval?:{started:number;ended:number}) {
  const parser=new SaxesParser(), cases:string[]=[];
  let root=false;
  parser.on("doctype",()=>{throw Error("UNITY_XML_DOCTYPE");});
  parser.on("opentag",tag=>{
    const a=tag.attributes;
    if (!root) {
      if (tag.name!=="test-run" || a.result!=="Passed" || Number(a.total)!==expected.length ||
        Number(a.passed)!==expected.length || ["failed","skipped","inconclusive"].some(k=>Number(a[k])!==0)) throw Error("UNITY_TEST_COUNTS");
      if(interval){
        const start=Date.parse(String(a["start-time"])),end=Date.parse(String(a["end-time"]));
        if(!Number.isFinite(start)||!Number.isFinite(end)||start<interval.started-1000||end<start||end>interval.ended+1000)throw Error("UNITY_XML_STALE");
      }
      root=true;
    }
    if (tag.name==="test-case") {
      if (a.result!=="Passed") throw Error("UNITY_TEST_FAILED");
      cases.push(String(a.fullname));
    }
  });
  parser.write(xml).close();
  if(!root || JSON.stringify(cases.sort())!==JSON.stringify([...expected].sort())) throw Error("UNITY_TEST_INVENTORY");
  return cases;
}

export function verifyLog(stage:string,log:string) {
  const end=stage==="player"?"Input System polling thread exited.":stage==="build"?"Application will terminate with return code 0":"Test run completed. Exiting with code 0";
  if(!log.includes(end))throw Error("UNITY_LOG_INCOMPLETE: "+stage);
}

export async function fileHash(path:string) {
  const hash=createHash("sha256");
  for await(const part of createReadStream(path)) hash.update(part);
  return hash.digest("hex");
}
export async function inventory(root:string, hashes=false) {
  const files:{path:string;bytes:number;hash?:string}[]=[];
  async function walk(prefix:string) {
    for(const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
      const path=prefix?prefix+"/"+entry.name:entry.name;
      if(entry.isDirectory()) await walk(path);
      else if(entry.isFile()) {
        const full=join(root,path);
        files.push({path,bytes:(await stat(full)).size,...(hashes?{hash:await fileHash(full)}:{})});
      } else throw Error("UNITY_UNSUPPORTED_FILE");
    }
  }
  await walk("");return files.sort((a,b)=>a.path.localeCompare(b.path,"en"));
}

type GitInput={path:string;oid:string;bytes:number;lfs?:{sha256:string;bytes:number}};

// Bound each Git process and its buffer even for projects with thousands of small assets.
async function* metadata(repo:string,entries:GitInput[]) {
  for(let offset=0;offset<entries.length;){
    const chunk:GitInput[]=[];let bytes=0;
    while(offset<entries.length && bytes<4*1024*1024 && chunk.length<512){
      const entry=entries[offset++];if(entry.bytes>1024*1024)throw Error("UNITY_META_SIZE");
      bytes+=entry.bytes;chunk.push(entry);
    }
    const data=await gitBytes(repo,["cat-file","--batch"],chunk.map(e=>e.oid+"\n").join(""));
    let index=0;
    for(const entry of chunk){
      const end=data.indexOf(10,index);
      if(data.toString("ascii",index,end)!==entry.oid+" blob "+entry.bytes)throw Error("UNITY_INPUT_IDENTITY");
      index=end+1;yield {entry,data:data.subarray(index,index+entry.bytes)};
      index+=entry.bytes;if(data[index++]!==10)throw Error("UNITY_INPUT_IDENTITY");
    }
  }
}

// Git object names refer to committed bytes, including large binary files. Only
// small metadata and pointer candidates are loaded in memory.
export async function inspectCommit(repo:string,sha:string) {
  if(!/^[a-f0-9]{40}$/.test(sha) || await gitText(repo,["rev-parse",sha+"^{commit}"])!==sha) throw Error("UNITY_COMMIT_REQUIRED");
  const raw=(await gitBytes(repo,["ls-tree","-r","-l","-z",sha])).toString("utf8");
  const entries=new Map<string,GitInput>();
  const gitDir=resolve(repo,await gitText(repo,["rev-parse","--git-common-dir"]));
  const directories=new Set<string>(),folded=new Set<string>();
  let total=0;
  const guids=new Set<string>(),assetGuids=new Map<string,string>();
  for(const line of raw.split("\0").filter(Boolean)) {
    const m=/^100(?:644|755) blob ([a-f0-9]{40}) +([0-9]+)\t([\s\S]+)$/.exec(line);
    if(!m)throw Error("UNITY_UNSUPPORTED_GIT_ENTRY");
    const path=relativeFile(m[3]), bytes=Number(m[2]);total+=bytes;
    if(total>2*1024**3 || entries.size>=100000)throw Error("UNITY_INPUT_BUDGET");
    const key=path.normalize("NFC").toLowerCase();
    if(folded.has(key) || path.split("/").some(s=>s.toLowerCase()===".git"))throw Error("UNITY_PATH_ALIAS");
    folded.add(key);
    const parts=path.split("/");
    for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join("/"));
    entries.set(path,{path,oid:m[1],bytes});
  }
  for(const dir of directories)if(dir.startsWith("Assets/") && !entries.has(dir+".meta"))throw Error("UNITY_META_MISSING: "+dir);
  const small:GitInput[]=[];
  for(const entry of entries.values()) {
    const {path,bytes}=entry;
    if(path.startsWith("Assets/") && !path.endsWith(".meta") && !entries.has(path+".meta"))throw Error("UNITY_META_MISSING: "+path);
    if(bytes<1024 || path.endsWith(".meta"))small.push(entry);
  }
  for await(const {entry,data} of metadata(repo,small)){
      const {path,bytes}=entry;
      if(data.toString("ascii",0,80).startsWith("version https://git-lfs.github.com/spec/v1")) {
        const match=/^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n?$/.exec(data.toString().replace(/\r\n/g,"\n"));
        if(!match)throw Error("UNITY_LFS_POINTER: "+path);
        const hash=match[1],size=Number(match[2]),object=join(gitDir,"lfs","objects",hash.slice(0,2),hash.slice(2,4),hash);
        total+=size-bytes;
        if(total>2*1024**3)throw Error("UNITY_INPUT_BUDGET");
        if((await stat(object).catch(()=>null))?.size!==size || await fileHash(object)!==hash)throw Error("UNITY_LFS_MISSING: "+path);
        entry.lfs={sha256:hash,bytes:size};
      }
      if(path.startsWith("Assets/") && path.endsWith(".meta")) {
        const guid=data.toString().match(/^guid: ([a-f0-9]{32})\s*$/mi)?.[1]?.toLowerCase();
        const owner=path.slice(0,-5);
        if(!guid || guids.has(guid) || !(entries.has(owner)||directories.has(owner)))throw Error("UNITY_META_INVALID: "+path);
        guids.add(guid);assetGuids.set(owner,guid);
      }
  }
  const parent=(await gitText(repo,["rev-list","--parents","-n","1",sha])).split(" ")[1];
  if(parent && guids.size) {
    const fields=(await gitBytes(repo,["diff","--name-status","--find-renames","-z",parent,sha,"--","Assets"])).toString().split("\0");
    for(let i=0;i<fields.length && fields[i];){
      const status=fields[i++],from=fields[i++];
      if(!status.startsWith("R"))continue;
      const to=fields[i++];
      if(to.endsWith(".meta"))continue;
      const prior=await treeFile(repo,parent,from+".meta");
      if(!prior || prior.bytes.toString().match(/^guid: ([a-f0-9]{32})\s*$/mi)?.[1]?.toLowerCase()!==assetGuids.get(to))throw Error("UNITY_META_RENAME: "+to);
    }
  }
  return {version:1,sha,tree:await gitText(repo,["rev-parse",sha+"^{tree}"]),total,files:[...entries.values()]};
}

export async function boundedText(path:string,limit=4*1024*1024) {
  const s=await lstat(path);if(!s.isFile() || s.size===0 || s.size>limit)throw Error("UNITY_EVIDENCE_SIZE");
  return readFile(path,"utf8");
}
