import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuditProcedures, buildAuditPrompt } from '../audit-procedures.mjs';

const check = { id: 'audit-service', kind: 'staleness', scope: { paths: ['services/**'] } };

test('procedure returns done + parsed findings from a fenced json result', async () => {
  const fake = async () => ({ result: '```json\n{"findings":[{"detail":"card stale","evidence":"x.ts:1","scope":["services/a/**"]}]}\n```' });
  const procs = makeAuditProcedures({ runScenario: fake });
  const r = await procs['audit-service']({ check });
  assert.equal(r.status, 'done');
  assert.equal(r.taskId, 'audit-service');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].detail, 'card stale');
});

test('empty findings array is a clean done', async () => {
  const fake = async () => ({ result: '```json\n{"findings":[]}\n```' });
  const procs = makeAuditProcedures({ runScenario: fake });
  const r = await procs['audit-service']({ check });
  assert.equal(r.status, 'done');
  assert.deepEqual(r.findings, []);
});

test('unparseable result retries once then fails (not throws)', async () => {
  let calls = 0;
  const fake = async () => { calls++; return { result: 'no json here' }; };
  const procs = makeAuditProcedures({ runScenario: fake });
  const r = await procs['audit-service']({ check });
  assert.equal(calls, 2, 'retried once');
  assert.equal(r.status, 'failed');
});

test('runs read-only: passes an allowedTools without Write/Edit', async () => {
  let seen;
  const fake = async (_scn, _ref, opts) => { seen = opts; return { result: '```json\n{"findings":[]}\n```' }; };
  const procs = makeAuditProcedures({ runScenario: fake });
  await procs['audit-service']({ check });
  assert.ok(Array.isArray(seen.allowedTools));
  assert.ok(!seen.allowedTools.includes('Write') && !seen.allowedTools.includes('Edit'));
});

test('buildAuditPrompt names the skill, the scope, and demands read-only json', () => {
  const p = buildAuditPrompt('audit-domain', ['services/**', 'libs/**']);
  assert.match(p, /audit-domain/);
  assert.match(p, /services\/\*\*/);
  assert.match(p, /READ-ONLY/i);
  assert.match(p, /```json/);
});

test('all four audit skills are present', () => {
  const procs = makeAuditProcedures({ runScenario: async () => ({ result: '{"findings":[]}' }) });
  assert.deepEqual(Object.keys(procs).sort(),
    ['audit-domain', 'audit-e2e-test', 'audit-service', 'audit-system']);
});
