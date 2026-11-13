import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const [runId,variant='clean-install',fixtureRunId=runId] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/);
assert.match(fixtureRunId,/^m6-[a-z0-9-]{8,60}$/);assert.ok(['clean-install','p01-rpc','p01-rpc-idle'].includes(variant));
const source=resolve(import.meta.dirname,'../..'),root=join(homedir(),'.orchiva/m6',runId),dest=join(root,variant),config=join(dest,'data'),id=variant==='clean-install'?'orchiva-m6-clean':'orchiva-m6-measure';
await mkdir(dest);await mkdir(config);await mkdir(join(config,'requests'));
for(const name of ['client','server','shared','index.client.tsx','index.server.ts','package.json','tsconfig.json']) await cp(join(source,name),join(dest,name),{recursive:true});
await symlink(join(source,'node_modules'),join(dest,'node_modules'),'junction');
await cp(join(homedir(),'.orchiva/project.json'),join(config,'project.json'));
const configFile=join(dest,'server/config/project-config.ts');
await writeFile(configFile,(await readFile(configFile,'utf8')).replace('join(homedir(), ".orchiva")',JSON.stringify(config)));
const clientFile=join(dest,'index.client.tsx');await writeFile(clientFile,(await readFile(clientFile,'utf8')).replace('title: "Orchiva", Component','title: "M6 설치 확인", Component'));
await writeFile(join(dest,'paseo-plugin.json'),JSON.stringify({id,name:variant==='clean-install'?'M6 설치 확인':'M6 RPC 측정',requirements:{paseo:'>=0.15.4 <0.16.0'}}));
if(variant.startsWith('p01-rpc')){
 await cp(join(homedir(),'.orchiva/m6',fixtureRunId,'p01/requests'),join(config,'requests'),{recursive:true});
 const serverFile=join(dest,'index.server.ts');let text=await readFile(serverFile,'utf8');text=`import {defineRpc} from '@getpaseo/plugin';import {z} from 'zod';import {setTimeout as delay} from 'node:timers/promises';\n`+text;
 text=text.replace('let stopped = false;',`let stopped = false;let holdActive=false;const hold=defineRpc({name:'m6.hold',input:z.object({ms:z.number().int().min(100).max(1000)}),output:z.boolean()});const held=defineRpc({name:'m6.held',input:z.object({}),output:z.boolean()});server.handle(held,async()=>holdActive);server.handle(hold,async({ms})=>{await ready;return store.exclusive(async()=>{holdActive=true;try{await delay(ms);return true;}finally{holdActive=false;}});});`);
 await writeFile(serverFile,text);await writeFile(clientFile,(await readFile(clientFile,'utf8')).replace('M6 설치 확인','M6 RPC 측정'));
}
await writeFile(join(dest,'manifest.json'),JSON.stringify({runId,createdAt:new Date().toISOString(),source,config,initialRequests:variant==='clean-install'?0:100,realAuthenticationCopied:false,changes:['isolated configDirectory','distinct sidebar title and Plugin ID'],scope:variant==='clean-install'?'Current Windows PC, existing SDK and authentication; isolated empty data/config copy. No new model task permitted during walkthrough.':'Current Windows PC; copied synthetic 100-record store and actual production RPC handlers. No model task permitted.'},null,2),{flag:'wx'});
console.log(JSON.stringify({directory:dest,pluginId:id,config}));
