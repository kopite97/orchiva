import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, cpus, release } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createHostClient } from '@getpaseo/client/node';
import { createPaseoApi } from '@getpaseo/client';
import { loadConfig, assertSandbox } from '../../server/config/project-config.ts';

const [action, runId, tag] = process.argv.slice(2);
assert.match(runId ?? '', /^m6-[a-z0-9-]{8,60}$/);
const home = homedir(), data = join(home, '.orchiva'), root = join(data, 'm6', runId), out = join(root, 'supplement');
const readJson = async p => JSON.parse((await readFile(p, 'utf8')).replace(/^\uFEFF/, ''));
assert.equal((await readJson(join(root, 'baseline-manifest.json'))).runId, runId);
const config = await loadConfig(); await assertSandbox(config);
await mkdir(out, { recursive: true });
const token = name => `${runId}-${name}`;
const disk = name => readJson(join(data, 'requests', `${token(name)}.json`));
const sha = x => createHash('sha256').update(x).digest('hex');
const recordBytes = name => readFile(join(data, 'requests', `${token(name)}.json`));
const suffix = process.argv[5]; if (suffix) assert.match(suffix, /^[a-z0-9-]{1,30}$/);
const file = join(out, `${action}${tag ? `-${tag}` : ''}${suffix ? `-${suffix}` : ''}.json`);
const evidence = { runId, action, tag, startedAt: new Date().toISOString(), status: 'preflight' };
await writeFile(file, JSON.stringify(evidence, null, 2), { flag: 'wx' });
const persist = async () => { const tmp = `${file}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(evidence, null, 2)); await rename(tmp, file); };
const client = createHostClient('127.0.0.1:6767', { clientId: `${runId}-${action}`, clientType: 'cli', appVersion: '0.15.4', localCredential: async () => (await readFile(join(home, '.paseo-orchiva/local-credential'), 'utf8')).trim(), reconnect: { enabled: false } });
const api = createPaseoApi(client), rpc = (name, input = {}) => client.invokePluginRpc('orchiva-plugin', name, input);
const inventory = async () => { const [a, w] = await Promise.all([api.agents.list(), api.workspaces.list()]); assert.equal(a.pageInfo.hasMore, false); assert.equal(w.pageInfo.hasMore, false); return { agents: a.entries.map(({ agent }) => agent.id).sort(), workspaces: w.entries.map(x => x.id).sort(), active: a.entries.filter(({ agent }) => agent.activeTurn || agent.pendingPermissions?.length || ['running', 'initializing'].includes(agent.status)).map(({ agent }) => agent.id) }; };
const inputFor = r => ({ token: r.token, commandKey: `${r.token}-start`, expectedRevision: r.revision, planRevision: r.plans.at(-1).revision, inputHash: r.plans.at(-1).inputHash });
const wait = async (name, attempt = 1) => { const until = Date.now() + 240000; while (Date.now() < until) { const r = await disk(name); if (r.attempt === attempt && r.result && ['failed', 'awaiting-review', 'completed'].includes(r.status)) return r; if (r.status === 'needs-input') throw Error(`Unexpected needs-input: ${r.error}`); await delay(250); } throw Error(`Timeout waiting for ${name}; inspect before retrying.`); };
const specs = {
  s: { title: 'M6-002 S 합계 수용', goal: 'Create sum.mjs exporting function sum(a,b) returning a+b, and sum.test.mjs containing exactly two node:test cases: sum(2,3) equals 5; sum(-2,2) equals 0. Run both tests and report results.', path: 'sum.test.mjs', kind: 'node-test', completion: 'The sum function passes two independent tests.' },
  f: { title: 'M6-002 F 실패 복구', goal: 'This is an intentional failure acceptance fixture. Create increment.mjs exporting increment(x) returning x+2, and increment.test.mjs with exactly two node:test assertions: increment(1) equals 2 and increment(-1) equals 0. Keep the intentionally incorrect x+2 implementation for attempt 1. Run the tests, report the expected failure, and stop. Do not fix it until a later explicit resume.', path: 'increment.test.mjs', kind: 'node-test', completion: 'The unchanged two-test file passes after an explicit same-session correction.' },
  m: { title: 'M6-002 M 수동 확인', goal: `Create only M6_MANUAL.md with a short explanation of the single-request workflow and the literal run ID ${runId}. No automated test files.`, path: 'M6_MANUAL.md', manual: true, completion: 'The note describes the workflow and identifies this run.' },
  c1: { title: 'M6-002 C 동시 시작 1', goal: 'First wait 15 seconds once, then create only M6_C.txt containing ORCHIVA_M6_C_OK.', path: 'M6_C.txt', marker: 'ORCHIVA_M6_C_OK' },
  c2: { title: 'M6-002 C 동시 시작 2', goal: 'First wait 15 seconds once, then create only M6_C.txt containing ORCHIVA_M6_C_OK.', path: 'M6_C.txt', marker: 'ORCHIVA_M6_C_OK' },
  b: { title: 'M6-002 B 브라우저 없이 실행', goal: 'First wait 25 seconds once, then create only M6_BACKGROUND.txt containing ORCHIVA_M6_BACKGROUND_OK.', path: 'M6_BACKGROUND.txt', marker: 'ORCHIVA_M6_BACKGROUND_OK' },
  i: { title: 'M6-002 I 실제 세션 중단', goal: 'First wait 90 seconds once, then create only M6_INTERRUPT.txt containing ORCHIVA_M6_INTERRUPT_OK. This owned acceptance task may be interrupted before the wait ends.', path: 'M6_INTERRUPT.txt', marker: 'ORCHIVA_M6_INTERRUPT_OK' },
  p01: { title: 'M6 P02 supplement 01', goal: 'Create only m6-p02-01.txt containing ORCHIVA_M6_P02_SUP_01_OK.', path: 'm6-p02-01.txt', marker: 'ORCHIVA_M6_P02_SUP_01_OK' },
  p02: { title: 'M6 P02 supplement 02', goal: 'Create only m6-p02-02.txt containing ORCHIVA_M6_P02_SUP_02_OK.', path: 'm6-p02-02.txt', marker: 'ORCHIVA_M6_P02_SUP_02_OK' }
};
try {
  await client.connect();
  if (action === 'seed') {
    const inv = await inventory(); assert.equal(inv.active.length, 0); const diagnostic = await rpc('storage.diagnostics'); assert.equal(diagnostic.activeTokens.length, 0); assert.equal(diagnostic.issues.length, 0);
    evidence.inventory = inv; evidence.records = [];
    for (const [name, s] of Object.entries(specs)) {
      const checkId = `${name}-check`, feature = { title: s.title, goal: s.goal, scope: `Only the named files in this task's dedicated PoC-sandbox worktree. Run ${runId}.`, constraints: 'Stay only in this dedicated sandbox worktree. Do not access sibling repositories, RNG, or Plugin source. Do not push, merge, commit, create other files, or change any existing PoC evidence. Use no package installation. Preserve the tests after initial creation.', validation: s.manual ? 'Manual review only; no automatic checks.' : 'Orchiva runs the named independent check.', completionCriteria: s.completion ?? 'The marker exists in the named file.' };
      const criteria = [{ id: `${name}-criterion`, text: feature.completionCriteria, checkIds: s.manual ? [] : [checkId], manualMethod: s.manual ? 'Read M6_MANUAL.md and confirm the workflow plus this run ID.' : '', legacy: false }];
      const checks = s.manual ? [] : [{ id: checkId, kind: s.kind ?? 'file-contains', path: s.path, label: `${name} independent check`, ...(s.marker ? { text: s.marker } : {}) }];
      let r = await rpc('request.save-draft', { token: token(name), commandKey: `${token(name)}-save`, expectedRevision: 0, feature, criteria, checks });
      if (name !== 's') r = await rpc('request.prepare-plan', { token: r.token, commandKey: `${r.token}-plan`, expectedRevision: r.revision });
      evidence.records.push({ tag: name, token: r.token, status: r.status, revision: r.revision }); await persist();
    }
    assert.deepEqual(await inventory(), inv);
  } else if (action === 'stale-plan') {
    const previous = await readJson(join(out, 'snapshot-s.json')), old = previous.record, current = await disk('s'), before = await inventory(), bytes = await recordBytes('s');
    const plan = old.plans.at(-1);
    await assert.rejects(rpc('request.start', { token: current.token, commandKey: `${current.token}-stale-plan`, expectedRevision: old.revision, planRevision: plan.revision, inputHash: plan.inputHash }), /REVISION_CONFLICT|PLAN_STALE/);
    assert.deepEqual(await recordBytes('s'), bytes); assert.deepEqual(await inventory(), before); evidence.noEffect = true; evidence.oldPlan = plan; evidence.currentRevision = current.revision;
  } else if (action === 'start') {
    assert.ok(specs[tag]); const r = await disk(tag), inv = await inventory(); assert.equal(inv.active.length, 0); evidence.before = { status: r.status, inventory: inv, input: inputFor(r) }; await persist();
    let intent;const began=performance.now();let observing=true;const observer=(async()=>{while(observing&&!intent){const x=await disk(tag);if(x.commands.some(c=>c.key===evidence.before.input.commandKey))intent={ms:performance.now()-began,observedAt:new Date().toISOString()};else await delay(2);}})();
    let accepted;try{accepted=await rpc('request.start',evidence.before.input);evidence.startRpcMs=performance.now()-began;}finally{observing=false;await observer;}
    if(!intent){const confirmed=await disk(tag);assert.ok(confirmed.commands.some(c=>c.key===evidence.before.input.commandKey));intent={ms:performance.now()-began,observedAt:new Date().toISOString(),method:'post-RPC durable read; upper bound after asynchronous polling missed the short accepted phase'};}
    evidence.startIntent=intent;evidence.accepted = { status: accepted.status, revision: accepted.revision }; evidence.awaitedBy = 'Use wait to inspect disk without causing observation.';
  } else if (action === 'wait' || action === 'snapshot') {
    assert.ok(specs[tag]); if (action === 'wait') { await api.dispose(); await client.close(); }
    const r = action === 'wait' ? await wait(tag, Number(process.argv[5] ?? 1)) : await disk(tag);
    evidence.record = { token: r.token, status: r.status, revision: r.revision, attempt: r.attempt, agentId: r.agentId, workspaceId: r.workspaceId, worktreePath: r.worktreePath, plans: r.plans, results: r.results, decisions: r.decisions, commands: r.commands, sha256: sha(await recordBytes(tag)) };
    if (['s', 'f'].includes(tag) && r.worktreePath) evidence.testSha256 = sha(await readFile(join(r.worktreePath, specs[tag].path)));
  } else if (action === 'concurrent') {
    const inv = await inventory(); assert.equal(inv.active.length, 0); const inputs = await Promise.all(['c1', 'c2'].map(async name => inputFor(await disk(name)))); evidence.before = inv; evidence.inputs = inputs; await persist();
    const outcomes = await Promise.allSettled(inputs.map(input => rpc('request.start', input))); evidence.outcomes = outcomes.map(x => x.status === 'fulfilled' ? { status: 'fulfilled', token: x.value.token, requestStatus: x.value.status } : { status: 'rejected', error: String(x.reason) });
    assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1); assert.match(String(outcomes.find(x => x.status === 'rejected').reason), /BUSY/);
    const winner = outcomes.find(x => x.status === 'fulfilled').value, winTag = winner.token.endsWith('-c1') ? 'c1' : 'c2', loser = await disk(winTag === 'c1' ? 'c2' : 'c1');
    assert.equal(loser.agentId, null); assert.equal(loser.workspaceId, null);
    const same = inputs.find(x => x.token === winner.token); await rpc('request.start', same);
    await assert.rejects(rpc('request.start', { ...same, inputHash: 'a'.repeat(64) }), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(rpc('request.start', { ...same, commandKey: `${same.token}-stale`, expectedRevision: 0 }), /REVISION_CONFLICT|PLAN_STALE/);
    const result = await wait(winTag), after = await inventory(); assert.equal(after.agents.length, inv.agents.length + 1); assert.equal(after.workspaces.length, inv.workspaces.length + 1); assert.ok(result.agentId && result.workspaceId);
    evidence.winner = { tag: winTag, token: result.token, agentId: result.agentId, workspaceId: result.workspaceId, status: result.status }; evidence.after = after;
  } else if (action === 'p02') {
    evidence.samples = []; evidence.environment = { node: process.version, os: release(), cpu: cpus()[0]?.model, model: config.provider };
    for (const name of ['p01', 'p02']) {
      const r = await disk(name), input = inputFor(r); let intent,startRpcMs,accepted;
      if(r.attempt===2){assert.equal(r.status,'awaiting-review');assert.ok(r.commands.some(c=>c.key===`${r.token}-resume`&&c.status==='applied'));evidence.previouslyCompleted??=[];evidence.previouslyCompleted.push({tag:name,attempt:r.attempt,agentId:r.agentId,workspaceId:r.workspaceId});await persist();continue;}
      if(r.status==='ready') {const began=performance.now();let observing=true;const observer=(async()=>{while(observing&&!intent){const x=await disk(name);if(x.commands.some(c=>c.key===input.commandKey))intent=performance.now()-began;else await delay(2);}})();try{accepted=await rpc('request.start',input);startRpcMs=performance.now()-began;}finally{observing=false;await observer;}evidence.pendingStart={tag:name,startRpcMs,startIntentMs:intent};await persist();assert.ok(Number.isFinite(intent),'Start intent not captured; retain this sample.');}
      else {assert.equal(r.attempt,1);assert.ok(r.commands.some(c=>c.key===input.commandKey&&c.status==='applied'));evidence.continuation='Previous p01 start was accepted before a measurement-collector assertion. No start replay/new start; original missing metric remains missing.';}
      const stopped = await wait(name), originalIds = [stopped.agentId, stopped.workspaceId], instruction = `Confirm ${specs[name].path} still contains ${specs[name].marker}. Do not modify any file. Report only confirmation.`;
      const resumeAt = performance.now(); const resumed = await rpc('request.resume', { token: stopped.token, key: `${stopped.token}-resume`, instruction, expectedRevision: stopped.revision, resultId: stopped.result.id }); const resumeRpcMs = performance.now() - resumeAt;
      const done = await wait(name, 2); assert.deepEqual([done.agentId, done.workspaceId], originalIds); assert.equal(done.status, 'awaiting-review');
      evidence.samples.push({ tag: name, startIntentMs: intent??null, startRpcMs:startRpcMs??null, resumeRpcMs, agentId: done.agentId, workspaceId: done.workspaceId, attempt: done.attempt, acceptedStatus: accepted?.status??'previously accepted' });delete evidence.pendingStart; await persist();
    }
  } else if (action === 'manual-denied') {
    const r = await disk('m'), before = await recordBytes('m'); assert.equal(r.result.checks.length, 0);
    await assert.rejects(rpc('request.review', { token: r.token, commandKey: `${r.token}-missing-manual`, expectedRevision: r.revision, resultId: r.result.id, approved: true, note: 'M6 missing manual evidence must reject.', criteriaReviews: [{ criterionId: 'm-criterion', satisfied: true, evidenceRefs: [{ kind: 'file', id: 'M6_MANUAL.md' }], note: '' }] }), /REVIEW_REQUIRED|manual evidence/);
    assert.deepEqual(await recordBytes('m'), before); evidence.missingEvidenceRejected = true; evidence.noWrite = true; evidence.manualFile = await readFile(join(r.worktreePath, 'M6_MANUAL.md'), 'utf8');
  } else if (action === 'rejection-pause') {
    assert.equal(tag, 'f'); const r = await disk(tag), bytes = await recordBytes(tag); assert.equal(r.status, 'failed'); assert.equal(r.attempt, 2); assert.equal(r.decisions.at(-1).approved, false);
    evidence.before = { attempt: r.attempt, resumeCommands: r.commands.filter(x => x.kind === 'resume').length, decisionId: r.decisions.at(-1).id, sha256: sha(bytes) }; await delay(11000);
    assert.deepEqual(await recordBytes(tag), bytes); evidence.after = evidence.before; evidence.noAutomaticSend = true;
  } else if (action === 'stale-session') {
    assert.equal(tag, 'f'); const r = await disk(tag); assert.equal(r.status, 'awaiting-review'); evidence.before = { revision: r.revision, result: r.result, resultIds: r.results.map(x => x.id), attempt: r.attempt };
    await api.agents.ref(r.agentId).run('M6 controlled external turn: confirm increment.mjs returns x + 1 and the two existing tests remain unchanged. Do not modify, create, delete, commit, push or merge any file. Reply briefly with confirmation.', { timeoutMs: 180000 });
    await assert.rejects(rpc('request.review', { token: r.token, commandKey: `${r.token}-stale-session-review`, expectedRevision: r.revision, resultId: r.result.id, approved: true, note: 'M6 external turn must invalidate the old review.', criteriaReviews: [{ criterionId: 'f-criterion', satisfied: true, evidenceRefs: [{ kind: 'check', id: 'f-check' }], note: '' }] }), /REVISION_CONFLICT|STALE_RESULT|execution changed/);
    let next; const end = Date.now() + 30000; do { next = await disk(tag); if (next.result?.id !== r.result.id && next.status === 'awaiting-review') break; await delay(250); } while (Date.now() < end);
    assert.equal(next.attempt, r.attempt); assert.notEqual(next.result.id, r.result.id); assert.notEqual(next.result.sourceKey, r.result.sourceKey); assert.deepEqual(next.results.find(x => x.id === r.result.id), r.results.find(x => x.id === r.result.id)); evidence.after = { revision: next.revision, resultId: next.result.id, sourceKey: next.result.sourceKey, resultIds: next.results.map(x => x.id), attempt: next.attempt }; evidence.oldResultPreserved = true;
  } else if (action === 'stale-file' || action === 'compare-completed') {
    assert.ok(['s', 'f'].includes(tag)); const r = await disk(tag); assert.ok(r.result); if (action === 'compare-completed') assert.equal(r.status, 'completed'); else assert.equal(r.status, 'awaiting-review');
    const path = join(r.worktreePath, tag === 's' ? 'sum.mjs' : 'increment.mjs'), original = await readFile(path), bytes = await recordBytes(tag); await writeFile(path, Buffer.concat([original, Buffer.from('\n// M6 owned reversible current-file inspection.\n')]));
    try {
      evidence.inspection = await rpc('request.inspect-result', { token: r.token, resultId: r.result.id }); assert.equal(evidence.inspection.matches, false);
      if (action === 'stale-file') await assert.rejects(rpc('request.review', { token: r.token, commandKey: `${r.token}-stale-file-review`, expectedRevision: r.revision, resultId: r.result.id, approved: true, note: 'M6 stale file must reject.', criteriaReviews: [{ criterionId: `${tag}-criterion`, satisfied: true, evidenceRefs: [{ kind: 'check', id: `${tag}-check` }], note: '' }] }), /STALE_RESULT/);
      assert.deepEqual(await recordBytes(tag), bytes); evidence.requestUnchanged = true;
    } finally { await writeFile(path, original); }
    assert.equal((await rpc('request.inspect-result', { token: r.token, resultId: r.result.id })).matches, true); evidence.sourceRestored = true;
  } else if (action === 'change-check') {
    assert.equal(tag, 'f'); const r = await disk(tag); assert.equal(r.status, 'awaiting-review'); const path = join(r.worktreePath, specs.f.path), old = await readFile(path); evidence.beforeSha256 = sha(old); evidence.oldResults = r.results.map(x => ({ id: x.id, sha256: sha(JSON.stringify(x)) }));
    await writeFile(path, Buffer.concat([old, Buffer.from('\n// M6 A16 deliberate comment-only check input change; assertions retained.\n')]));
    const next = await rpc('request.revalidate', { token: r.token, resultId: r.result.id, commandKey: `${r.token}-check-change-revalidate`, expectedRevision: r.revision }); assert.equal(next.attempt, r.attempt); assert.equal(next.status, 'awaiting-review'); assert.equal(next.result.testChanges.length, 1);
    await assert.rejects(rpc('request.review', { token: r.token, commandKey: `${r.token}-check-change-denied`, expectedRevision: next.revision, resultId: next.result.id, approved: true, note: 'M6 missing check-change reason must reject.', criteriaReviews: [{ criterionId: 'f-criterion', satisfied: true, evidenceRefs: [{ kind: 'check', id: 'f-check' }], note: '' }] }), /TEST_CHANGE_REQUIRED/);
    for (const oldResult of r.results) assert.deepEqual(next.results.find(x => x.id === oldResult.id), oldResult);
    evidence.afterSha256 = sha(await readFile(path)); evidence.newResultId = next.result.id; evidence.testChanges = next.result.testChanges; evidence.attempt = next.attempt;
  } else throw Error(`Unknown action ${action}`);
  evidence.status = 'completed'; evidence.pass = true; evidence.endedAt = new Date().toISOString(); await persist(); console.log(JSON.stringify({ file, pass: true, action, tag, status: evidence.record?.status ?? evidence.accepted?.status, attempt: evidence.record?.attempt, samples: evidence.samples, winner: evidence.winner }, null, 2));
} catch (error) { evidence.status = 'failed'; evidence.error = String(error); await persist(); throw error; }
finally { try { await api.dispose(); } finally { await client.close(); } }
