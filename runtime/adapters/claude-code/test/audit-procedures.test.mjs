import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuditProcedures, buildAuditPrompt, AUDIT_SKILLS } from '../audit-procedures.mjs';
import { loadRegistry } from '../../../engine/lib/load-registry.mjs';
import { parseRun } from '../../../engine/schema/check.schema.ts';

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

test('all five audit skills are present (incl. audit-integration-test)', () => {
  const procs = makeAuditProcedures({ runScenario: async () => ({ result: '{"findings":[]}' }) });
  assert.deepEqual(Object.keys(procs).sort(),
    ['audit-domain', 'audit-e2e-test', 'audit-integration-test', 'audit-service', 'audit-system']);
});

test('audit-integration-test procedure runs and parses findings (regression: was unmapped, failed the pre-done gate)', async () => {
  const fake = async () => ({ result: '```json\n{"findings":[{"detail":"no OrphanReaper","evidence":"services/x/test/integration/x.spec.ts:1","scope":["services/x/test/integration/**"]}]}\n```' });
  const procs = makeAuditProcedures({ runScenario: fake });
  const proc = procs['audit-integration-test'];
  assert.ok(proc, 'audit-integration-test procedure is wired');
  const r = await proc({ check: { id: 'integration-test-completeness', scope: { paths: ['services/**/test/integration/**'] } } });
  assert.equal(r.status, 'done');
  assert.equal(r.taskId, 'audit-integration-test');
  assert.equal(r.findings.length, 1);
});

// Recurrence guard for the class: a check declaring `run: skill:<name>` whose <name> is not wired in
// AUDIT_SKILLS makes runProcedure return `unknown procedure`, deriveJudge throws, and the pre-ship /
// epic-pre-done gate hard-fails on a spurious `#err` finding. Assert the registry can never drift.
test('every skill: check in the registry has a wired procedure (no unmapped judge procedures)', () => {
  const reg = loadRegistry({ checksDir: 'runtime/content/checks' });
  assert.deepEqual(reg.errors, [], 'registry has no load/validation errors');
  const skillTargets = reg.checks
    .map((c) => parseRun(c.evaluator.run))
    .filter((p) => p && p.scheme === 'skill')
    .map((p) => p.target);
  assert.ok(skillTargets.length > 0, 'registry declares at least one skill: check');
  const unmapped = [...new Set(skillTargets)].filter((t) => !AUDIT_SKILLS.includes(t));
  assert.deepEqual(unmapped, [], `every skill: check target must be wired in AUDIT_SKILLS; unmapped: ${unmapped.join(', ')}`);
});
