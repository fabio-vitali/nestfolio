import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveJudge } from '../lib/derive-judge.mjs';

const CHECK = { id: 'itc', kind: 'gap', evaluator: { type: 'judgment', run: 'skill:audit-integration-test' } };

test('DJ1 maps a done TaskResult.findings through runProcedure(target,{check})', async () => {
  const calls = [];
  const rp = async (name, args) => { calls.push([name, args]); return { taskId: name, status: 'done', summary: 'ok', findings: [{ id: 'f1', check: 'itc', kind: 'gap', scope: [], detail: 'missing', raised_at: 'now' }] }; };
  const judge = deriveJudge(rp);
  const findings = await judge(CHECK);
  assert.equal(findings.length, 1);
  assert.deepEqual(calls[0][0], 'audit-integration-test');
  assert.equal(calls[0][1].check.id, 'itc');
});
test('DJ2 a done result with no findings key means zero findings', async () => {
  const judge = deriveJudge(async () => ({ taskId: 'x', status: 'done', summary: 'clean' }));
  assert.deepEqual(await judge(CHECK), []);
});
test('DJ3 a failed procedure throws (fails closed at the runGate layer)', async () => {
  const judge = deriveJudge(async () => ({ taskId: 'x', status: 'failed', summary: 'no such skill' }));
  await assert.rejects(() => judge(CHECK), /no such skill/);
});
test('DJ4 no runProcedure ⇒ judge is undefined (resolveEvaluator throws its usual JudgeCapabilityUnavailable)', () => {
  assert.equal(deriveJudge(undefined), undefined);
});
