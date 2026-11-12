import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createHostClient } from '@getpaseo/client/node';
const client = createHostClient('127.0.0.1:6767', {
  clientId: 'orchiva-lifecycle-test', clientType: 'cli', appVersion: '0.15.4',
  localCredential: () => readFileSync(join(homedir(), '.paseo-orchiva', 'local-credential'), 'utf8').trim(), reconnect: { enabled: false },
});
const invoke = (method, input) => client.invokePluginRpc('orchiva-plugin', method, input);
const successToken = 'lifecycle-success-20261112-001';
const failureToken = 'lifecycle-failure-20261112-001';
const checks = [{ kind: 'node-test', path: 'feature.test.mjs', label: 'Feature behavior tests' }];
const constraints = 'Only this sandbox worktree. No dependencies, network, commits, push, merge, subprocesses or other repositories. Tests must use node:test and node:assert/strict, read files only, and run under node --test --test-isolation=none. Do not change generated PLAN files.';
try {
  await client.connect();
  const action = process.argv[2] || 'status';
  if (action === 'start') {
    for (const input of [
      { token: successToken, checks, feature: {
        title: 'PoC v2 성공 사례: sum 함수', goal: 'Implement and verify a sum(a,b) function.',
        scope: 'Create feature.mjs exporting function sum(a,b) that returns a+b. Create feature.test.mjs with node:test tests covering sum(2,3)===5 and sum(-2,2)===0.',
        constraints, validation: 'Run node --test --test-isolation=none feature.test.mjs; all tests must pass.', completionCriteria: 'Both sum cases pass; feature.mjs and feature.test.mjs exist. Report test evidence.' } },
      { token: failureToken, checks, feature: {
        title: 'PoC v2 실패·복구 사례: increment 함수', goal: 'Exercise Orchiva detection of a failing test and later recovery on the same worktree.',
        scope: 'INITIAL ATTEMPT ONLY: create feature.mjs exporting increment(n) that intentionally returns n (the injected bug). Create feature.test.mjs asserting increment(1)===2 using node:test. Run the test, report the expected failure, and STOP. Do not fix the injected bug until explicit recovery instructions arrive in a later message.',
        constraints, validation: 'Initial injected bug must make node --test --test-isolation=none feature.test.mjs exit nonzero. After explicit recovery, the same unchanged assertion must pass.', completionCriteria: 'After recovery, increment(1) equals 2; the original test is preserved and passes. Initial attempt is intentionally incomplete.' } },
    ]) {
      const record = await invoke('request.start', input);
      console.log(JSON.stringify({ token: record.token, status: record.status, agentId: record.agentId, workspaceId: record.workspaceId, error: record.error }));
      assert.ok(record.agentId);
    }
  } else if (action === 'recover') {
    const record = await invoke('request.refresh', { token: failureToken });
    assert.equal(record.status, 'failed');
    assert.ok(record.result.checks.some(check => !check.passed));
    const input = { token: failureToken, key: 'lifecycle-recovery-001', instruction: 'Recovery authorized: fix only increment(n) in feature.mjs to return n+1. Keep the existing feature.test.mjs assertion unchanged. Run the test again and report the result. Use the same worktree; no commits, push, merge or network.' };
    const resumed = await invoke('request.resume', input);
    const replay = await invoke('request.resume', input);
    assert.equal(resumed.agentId, record.agentId); assert.equal(resumed.workspaceId, record.workspaceId);
    assert.equal(replay.attempt, resumed.attempt); assert.equal(resumed.attempt, 2);
    assert.equal(resumed.attempts[0].result.checks[0].passed, false);
    console.log(JSON.stringify({ recovered: record.token, sameAgent: resumed.agentId, sameWorkspace: resumed.workspaceId, attempt: replay.attempt, status: replay.status }));
  } else if (action === 'verify') {
    const records = await invoke('request.list', {});
    for (const token of [successToken, failureToken]) {
      const record = records.find(item => item.token === token);
      assert.equal(record?.status, 'completed');
      assert.equal(record.observationError, null); assert.equal(record.error, null);
      assert.equal(record.decision?.approved, true);
      assert.equal(record.decision.resultId, record.result.id);
      assert.ok(record.result.finalResponse.length > 0);
      assert.ok(record.result.checks.every(check => check.passed && check.exitCode === 0));
      for (const plan of [record.requestPlan, record.taskPlan]) {
        assert.equal(readFileSync(join(record.worktreePath, '.orchiva', 'plans', `${plan.id}.md`), 'utf8'), plan.content);
      }
      const replay = await invoke('request.start', { token, feature: record.feature, checks: record.checks });
      assert.equal(replay.agentId, record.agentId); assert.equal(replay.workspaceId, record.workspaceId);
      assert.equal(replay.result.id, record.result.id); assert.equal(replay.status, 'completed');
      if (token === failureToken) {
        assert.equal(record.attempt, 2); assert.equal(record.attempts.length, 1);
        assert.equal(record.attempts[0].result.checks[0].exitCode, 1);
        assert.match(record.attempts[0].result.checks[0].output, /1 !== 2/);
        assert.equal(createHash('sha256').update(readFileSync(join(record.worktreePath, 'feature.test.mjs'))).digest('hex'), 'ac419489fa43b8ab51e67c33cd6df419abcab32cbc465745cb03ec53dba4a3aa');
        const recovery = await invoke('request.resume', { token, key: record.recovery.key, instruction: record.recovery.instruction });
        assert.equal(recovery.attempt, 2); assert.equal(recovery.status, 'completed');
      } else assert.equal(record.attempt, 1);
      // Re-run the original test suite after restart as well as checking stored evidence.
      const output = execFileSync(process.execPath, ['--permission', `--allow-fs-read=${record.worktreePath}`, '--test', '--test-isolation=none', './feature.test.mjs'], { cwd: record.worktreePath, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.match(output, /fail 0/);
      console.log(JSON.stringify({ token, status: record.status, attempt: record.attempt, agentId: record.agentId, result: 'PASS' }));
    }
    assert.equal((await invoke('request.list', {})).length, records.length);
    console.log('PASS: success, failure evidence, unchanged recovery test, explicit decisions, durable state and idempotency.');
  } else if (action === 'approve') {
    for (const token of [successToken, failureToken]) {
      const record = await invoke('request.refresh', { token, revalidate: action === 'revalidate' });
      if (record.status === 'completed') { console.log(`${token}: already completed`); continue; }
      assert.equal(record.status, 'awaiting-review');
      assert.ok(record.result.finalResponse.length > 0);
      assert.ok(record.result.checks.length > 0 && record.result.checks.every(check => check.passed));
      const decided = await invoke('request.review', { token, resultId: record.result.id, approved: true,
        note: token === successToken ? 'PoC verifier: sum(2,3)=5 and sum(-2,2)=0 independently passed; both implementation and test files inspected.' : 'PoC verifier: the original increment assertion now passes; same workspace and session retained, and failed attempt evidence preserved.' });
      assert.equal(decided.status, 'completed');
      console.log(JSON.stringify({ token, status: decided.status, resultId: decided.result.id, attempt: decided.attempt }));
    }
  } else {
    for (const token of [successToken, failureToken]) {
      const record = await invoke('request.refresh', { token, revalidate: action === 'revalidate' });
      console.log(JSON.stringify({ token, status: record.status, attempt: record.attempt, agentId: record.agentId, worktreePath: record.worktreePath, error: record.error, observationError: record.observationError,
        checks: record.result?.checks, finalResponse: record.result?.finalResponse, history: record.events }));
    }
  }
} finally { await client.close(); }
