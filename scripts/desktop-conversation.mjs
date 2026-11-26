// Isolated D4 acceptance driver. Never targets an existing operating project.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, realpath, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..'), [mode, runId, ...args] = process.argv.slice(2);
assert.match(runId ?? '', /^d4-[a-z0-9-]{8,60}$/);
const directory = join(root, '.desktop-local', runId), optionsPath = join(directory, 'desktop.json'), statePath = join(directory, 'state.json');
if (mode === 'prepare') {
  await mkdir(directory); const dataHome = join(directory, 'data'), paseoHome = join(directory, 'paseo'), source = join(directory, '상담 시험');
  await mkdir(dataHome); await mkdir(paseoHome); await mkdir(source);
  const probe = createServer(); await new Promise(ok => probe.listen(0, '127.0.0.1', ok)); const port = probe.address().port; await new Promise(ok => probe.close(ok));
  const options = { sourceRoot: root, isolationRoot: await realpath(directory), dataHome: await realpath(dataHome), paseoHome: await realpath(paseoHome), endpoint: `127.0.0.1:${port}`, nodePath: process.execPath, paseoCliPath: join(root, '.desktop-local/tools/paseo/node_modules/@getpaseo/cli/bin/paseo') };
  await writeFile(optionsPath, JSON.stringify(options, null, 2));
  await writeFile(join(dataHome, 'project.json'), JSON.stringify({ name: 'PoC Sandbox', repositoryPath: resolve(root, '../orchiva-PoC'), baseRef: 'main', provider: 'codex/default' }));
  await writeFile(join(paseoHome, 'config.json'), JSON.stringify({ version: 1, daemon: { listen: options.endpoint }, pluginsEnabled: true, plugins: { 'orchiva-plugin': { source: 'directory', path: root, enabled: true } } }));
  await run('git', ['init', '-b', 'main', source]);
  await writeFile(join(source, 'sample.txt'), 'D4 original fixture\n');
  await run('git', ['-C', source, 'add', 'sample.txt']); await run('git', ['-C', source, '-c', 'user.name=Orchiva Test', '-c', 'user.email=orchiva@test.invalid', 'commit', '-m', 'D4 fixture']);
  await writeFile(statePath, JSON.stringify({ runId, source, conversations: [], preparedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ runId, optionsPath }));
} else {
  const options = JSON.parse(await readFile(optionsPath, 'utf8')), state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(options.isolationRoot, await realpath(directory)); assert.equal(state.source, join(directory, '상담 시험'));
  const env = { ...process.env, ORCHIVA_ISOLATION_ROOT: directory, ORCHIVA_DATA_HOME: options.dataHome, ORCHIVA_PASEO_HOME: options.paseoHome, ORCHIVA_PASEO_ENDPOINT: options.endpoint };
  delete env.CODEX_WINDOWS_REGISTERED_CORE; delete env.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY;
  if (mode === 'start') {
    await run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts/start-desktop-runtime.ps1'), '-Config', optionsPath], { env, windowsHide: true, timeout: 75000 }); console.log('D4 daemon ready');
  } else if (mode === 'daemon-stop') {
    await run(process.execPath, [options.paseoCliPath, 'daemon', 'stop', '--home', options.paseoHome], { env, windowsHide: true, timeout: 60000 }); console.log('D4 daemon stopped');
  } else {
    const client = createHostClient(options.endpoint, { clientId: runId + '-verify', clientType: 'cli', appVersion: '0.15.4', connectTimeoutMs: 5000, reconnect: { enabled: false }, localCredential: async () => (await readFile(join(options.paseoHome, 'local-credential'), 'utf8')).trim() }), api = createPaseoApi(client);
    const rpc = (method, input = {}) => client.invokePluginRpc('orchiva-plugin', method, input), save = () => writeFile(statePath, JSON.stringify(state, null, 2));
    const item = () => state.conversations.at(-1), identity = () => ({ projectId: state.projectId, conversationId: item().id });
    const get = () => rpc('desktop.conversations.get', identity());
    try {
      await client.connect();
      if (mode === 'setup') {
        const p = await rpc('desktop.projects.register', { sourceRoot: state.source, name: 'D4 상담 검증' }); state.projectId = p.projectId; await save();
        const preview = await rpc('desktop.projects.preview', { projectId: p.projectId }); await rpc('desktop.projects.initialize', { projectId: p.projectId, fingerprint: preview.fingerprint, commandKey: runId + '-initialize' });
        const catalog = await rpc('desktop.models', { projectId: p.projectId }); state.model = catalog.models.find(m => m.provider === 'codex/gpt-5.4-mini')?.provider ?? catalog.models.find(m => /mini/.test(m.provider))?.provider ?? catalog.models[0].provider; await save(); console.log(JSON.stringify({ projectId: state.projectId, models: catalog.models.map(m => m.provider), selected: state.model }));
      } else if (mode === 'policy-check') {
        const before=await api.agents.list();
        await assert.rejects(rpc('desktop.conversations.create',{projectId:state.projectId,conversationId:randomUUID(),commandKey:randomUUID(),expectedRevision:0,selection:{provider:state.model,thinkingOptionId:null,policy:{access:'read-only',approval:'untrusted'}}}),/CONVERSATION_POLICY_UNAVAILABLE/);
        const historical=state.conversations.find(c=>c.selection.policy.approval==='untrusted');
        if(historical) {
          const id={projectId:state.projectId,conversationId:historical.id}, doc=await rpc('desktop.conversations.get',id);
          await assert.rejects(rpc('desktop.conversations.send',{...id,expectedRevision:doc.revision,commandKey:randomUUID(),text:'미지원 정책 사전 거부 시험'}),/CONVERSATION_POLICY_UNAVAILABLE/);
          assert.equal((await rpc('desktop.conversations.get',id)).revision,doc.revision);
        }
        assert.equal((await api.agents.list()).entries.length,before.entries.length); console.log('PASS: unsupported approval rejected before Agent creation/send');
      } else if (mode === 'new') {
        const id = randomUUID(), selection = { provider: state.model, thinkingOptionId: null, policy: { access: args[0] ?? 'read-only', approval: args[1] ?? 'on-request' } };
        const command = { projectId: state.projectId, conversationId: id, commandKey: randomUUID(), expectedRevision: 0, selection };
        const doc = await rpc('desktop.conversations.create', command); await rpc('desktop.conversations.create', command); state.conversations.push({ id, agentId: doc.agentId, selection, commands: [] }); await save(); console.log(JSON.stringify({ id, policy: doc.policy }));
      } else if (mode === 'send') {
        const doc = await get(), text = await readFile(args[0], 'utf8'); const command = { ...identity(), expectedRevision: doc.revision, commandKey: randomUUID(), text };
        item().commands.push(command); await save(); await rpc('desktop.conversations.send', command); await rpc('desktop.conversations.send', command); console.log('D4 send accepted and replayed');
      } else if (mode === 'permission') {
        const requests = await rpc('desktop.conversations.attention', identity()), request = requests[0]; assert.ok(request); const action = request.actions.find(a => a.behavior === args[0]); assert.ok(action);
        const doc = await get(), command = { ...identity(), expectedRevision: doc.revision, commandKey: randomUUID(), requestId: request.id, requestHash: request.hash, actionId: action.id, behavior: action.behavior };
        item().commands.push({ method: 'permission', ...command }); await save(); await rpc('desktop.conversations.permission', command); await rpc('desktop.conversations.permission', command); console.log('D4 permission accepted and replayed');
      } else if (mode === 'stop') { const doc = await get(); const command = { ...identity(), expectedRevision: doc.revision, commandKey: randomUUID() }; await rpc('desktop.conversations.stop', command); await rpc('desktop.conversations.stop', command); console.log('D4 stop accepted and replayed');
      } else if (mode === 'brief') {
        const doc = await get(), last = doc.turns.at(-1), turn = last ? await rpc('desktop.conversations.turn', { ...identity(), turnId: last.id }) : null;
        const requests = await rpc('desktop.conversations.attention', identity()); console.log(JSON.stringify({ id:doc.id, revision:doc.revision, state:last?.state, error:doc.observationError, response:turn?.response, failure:turn?.failure, permissions:requests.length }));
      } else if (mode === 'status') {
        const doc = await get(), last = doc.turns.at(-1), turn = last ? await rpc('desktop.conversations.turn', { ...identity(), turnId: last.id }) : null;
        const requests = await rpc('desktop.conversations.attention', identity()); const agent = api.agents.ref(doc.agentId); const snapshot = await agent.refresh(); const timeline = snapshot ? await agent.timeline.refetch({direction:'tail',limit:20}) : null; console.log(JSON.stringify({ id: doc.id, sessionState: doc.sessionState, revision: doc.revision, observationError: doc.observationError, agentStatus:agent.status, activeTurn:agent.activeTurn, timeline:timeline?.entries.map(e=>({seq:e.seqEnd,turnId:e.turnId,type:e.item.type,messageId:e.item.clientMessageId})), turns: doc.turns, response: turn?.response, failure: turn?.failure, permissions: requests, journals: doc.journals }, null, 2));
      } else if (mode === 'verify') {
        const records = [];
        const listed = await rpc('desktop.conversations.list', {projectId:state.projectId});
        for (const entry of listed.records) if (!state.conversations.some(c=>c.id===entry.id)) { const doc=await rpc('desktop.conversations.get',{projectId:state.projectId,conversationId:entry.id}); state.conversations.push({id:doc.id,agentId:doc.agentId,selection:{provider:doc.provider,policy:doc.policy},commands:[],origin:'GUI'}); }
        await save();
        for (const c of state.conversations) {
          const id = { projectId: state.projectId, conversationId: c.id }, doc = await rpc('desktop.conversations.get', id); assert.equal(doc.agentId, c.agentId); assert.ok(doc.turns.every(t => ['answered','failed'].includes(t.state)));
          const agent = api.agents.ref(doc.agentId); await agent.refresh(); const page = await agent.timeline.refetch({ direction: 'tail', limit: 100 }); assert.equal(page.hasOlder, false);
          const users = page.entries.filter(e => e.item.type === 'user_message');
          // A provider that rejected configuration has no persisted provider transcript after restart.
          // Preserve this failed attempt separately; never count it as a successful model turn.
          if (doc.policy.approval === 'untrusted' && users.length === 0) {
            assert.equal(doc.turns.length,1); const full=await rpc('desktop.conversations.turn',{...id,turnId:doc.turns[0].id});
            assert.equal(full.state,'failed'); assert.equal(full.failure,'AGENT_EXECUTION_FAILED'); assert.ok(full.receipt);
            assert.match(full.response,/approval_policy = "untrusted" is no longer supported/);
            records.push({id:c.id,agentId:doc.agentId,policy:doc.policy,turns:doc.turns,messages:0,providerConfigurationRejected:true,restoredTranscriptUnavailable:true});
            continue;
          }
          assert.equal(users.length, doc.turns.length, `timeline count: ${c.id}`);
          const identified=users.filter(e=>e.item.clientMessageId); assert.equal(new Set(identified.map(e=>e.item.clientMessageId)).size,identified.length);
          const restoredWithoutId=[];
          for (const turn of doc.turns) {
            const matches=users.filter(e=>e.item.clientMessageId===turn.messageId);
            if(matches.length===0) { const full=await rpc('desktop.conversations.turn',{...id,turnId:turn.id}); assert.ok(turn.receipt); assert.equal(users.filter(e=>!e.item.clientMessageId&&e.item.text===full.input).length,1); restoredWithoutId.push(turn.id); }
            else assert.equal(matches.length,1);
          }
          records.push({ id: c.id, agentId: doc.agentId, policy: doc.policy, turns: doc.turns, messages: users.length, restoredWithoutId, journals: doc.journals, tools: page.entries.filter(e => e.item.type === 'tool_call').map(e => ({ name: e.item.name, status: e.item.status })) });
        }
        const agents = await api.agents.list(); assert.equal(agents.pageInfo.hasMore, false); assert.equal(agents.entries.length, state.conversations.length);
        const result = { runId, verifiedAt: new Date().toISOString(), records, agentCount: agents.entries.length, sourceFiles: await readdir(state.source) }; await writeFile(join(directory, 'acceptance.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ passed: true, agentCount: agents.entries.length, turns: records.map(r => r.messages) }));
      } else throw new Error('Unknown D4 phase');
    } finally { await api.dispose(); await client.close(); }
  }
}
