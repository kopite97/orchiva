// Isolated UI integration preview: identical client, copied fixture, lookup-only RPCs.
// Never point this harness at the live requests directory.
import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
const [runId]=process.argv.slice(2);assert.match(runId??'',/^m5-[a-z0-9-]{8,60}$/);
const source=resolve(import.meta.dirname,'..'),root=join(homedir(),'.orchiva/m5',runId),dest=join(root,'ui-preview');
const token=runId+'-fixture',record=JSON.parse(await readFile(join(root,'fixture-requests',token+'.json'),'utf8'));
assert.ok(record.commands.some(x=>x.status==='unknown'));assert.equal(record.agentId,null);
await mkdir(dest);await mkdir(join(dest,'records'));
for(const path of ['client','server','shared','index.client.tsx','package.json','tsconfig.json'])await cp(join(source,path),join(dest,path),{recursive:true});
await symlink(join(source,'node_modules'),join(dest,'node_modules'),'junction');
await writeFile(join(dest,'records',token+'.json'),JSON.stringify(record,null,2),{flag:'wx'});
await writeFile(join(dest,'paseo-plugin.json'),JSON.stringify({id:'orchiva-m5-preview',name:'M5 격리 검증',description:'Copied unknown fixture; no creation or send RPCs.',requirements:{paseo:'>=0.15.4 <0.16.0'}}));
const server=`import type {PluginServerContext} from '@getpaseo/plugin/server';
import {join} from 'node:path';
import {configRpc,listRpc,getRpc,pageRpc,detailRpc,serviceStatusRpc,diagnosticsRpc,reconcileRpc} from './shared/contracts/feature-request';
import {loadConfig} from './server/config/project-config';
import {JsonRequestStore} from './server/adapters/storage/json-request-store';
import {RequestLocks} from './server/application/request-locks';
import {RecoverRequest} from './server/application/recover-request';
import {PaseoRuntime} from './server/adapters/paseo/runtime';
import {failureView} from './server/domain/failure';
import {allowedActions,requestPage} from './server/domain/request-view';
export default function contribute(server:PluginServerContext){
 const store=new JsonRequestStore(${JSON.stringify(join(dest,'records'))}),ready=store.open(),recover=new RecoverRequest(store,new RequestLocks());
 server.handle(configRpc,async()=>{await ready;return loadConfig();});
 server.handle(listRpc,async()=>{await ready;return store.list();});
 server.handle(getRpc,async({token})=>{await ready;return store.get(token);});
 server.handle(pageRpc,async input=>{await ready;return requestPage(await store.list(),input);});
 server.handle(detailRpc,async({token})=>{await ready;const record=await store.get(token);return record?{record,failure:failureView(record),allowedActions:allowedActions(record)}:null;});
 server.handle(diagnosticsRpc,async()=>{await ready;return store.diagnostics();});
 server.handle(serviceStatusRpc,async()=>({state:'stopped',startedAt:new Date().toISOString(),lastSuccessAt:null,lastError:null,nextAttemptAt:null,cycles:0,failures:0,restoring:false}));
 server.handle(reconcileRpc,async(input,{paseo})=>{await ready;return recover.reconcile(input,new PaseoRuntime(paseo,await loadConfig()));});
 return async()=>{await ready;await store.close();};
}`;
await writeFile(join(dest,'index.server.ts'),server);console.log(dest);
