import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectChecks, runWatch } from '../lib/run-watch.mjs';

const check = (over) => ({ id: 'c', property: 'p', kind: 'inconsistency', cost_tier: 'cheap',
  contexts: ['invariant'], status: 'active', scope: { paths: ['services/foo/**'] },
  evaluator: { type: 'deterministic', run: 'cmd:true' }, provenance: { minted_by: 'x' }, ...over });
const registry = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });

test('C1: a cheap global invariant fires even when its scope does not overlap changed files', () => {
  const inv = check({ id: 'inv', contexts: ['invariant'], cost_tier: 'cheap' });
  const sel = selectChecks({ registry: registry([inv]), trigger: { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' }, changedScope: ['services/other/x.ts'] });
  assert.deepEqual(sel.map((c) => c.id), ['inv']);   // global invariants always ride
});

test('C2: an expensive check in an ACTIVATED context does NOT fire on a cheap-ceiling commit (cost filter)', () => {
  // contexts:['gate'] IS in the commit trigger, so ONLY the cost_ceiling can exclude it — this exercises
  // affordable(), not activated(). (An [audit] check would be excluded by the context filter, proving nothing about cost.)
  const exp = check({ id: 'exp', contexts: ['gate'], cost_tier: 'expensive', scope: { paths: ['services/other/x.ts'] } });
  const sel = selectChecks({ registry: registry([exp]), trigger: { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' }, changedScope: ['services/other/x.ts'] });
  assert.deepEqual(sel, []);   // cost_ceiling refuses it despite the context overlap
});

test('C3: an epic-pre-done trigger fires an expensive audit', () => {
  const aud = check({ id: 'aud', contexts: ['audit'], cost_tier: 'expensive', scope: { paths: ['a/**'] } });
  const sel = selectChecks({ registry: registry([aud]), trigger: { on: 'epic-pre-done', contexts: ['audit', 'gate'], cost_ceiling: 'expensive' }, changedScope: ['a/x'] });
  assert.deepEqual(sel.map((c) => c.id), ['aud']);
});

test('C4: a schedule/moderate trigger fires moderate audits but not expensive ones', () => {
  const mod = check({ id: 'mod', contexts: ['audit'], cost_tier: 'moderate', scope: { paths: ['a/**'] } });
  const exp = check({ id: 'exp', contexts: ['audit'], cost_tier: 'expensive', scope: { paths: ['a/**'] } });
  const sel = selectChecks({ registry: registry([mod, exp]), trigger: { on: 'schedule', cron: '0 6 * * *', contexts: ['audit'], cost_ceiling: 'moderate' }, changedScope: ['a/x'] });
  assert.deepEqual(sel.map((c) => c.id), ['mod']);
});

test('C5: runWatch completes partial findings (id/check/raised_at) and reports them', async () => {
  const bad = check({ id: 'bad', contexts: ['gate'], evaluator: { type: 'deterministic', run: 'cmd:false' } });
  const findings = await runWatch({ registry: registry([bad]), trigger: { on: 'manual', contexts: ['gate'], cost_ceiling: 'expensive' }, changedScope: ['services/foo/x'] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'bad');
  assert.equal(findings[0].id, 'bad#0');
  assert.ok(findings[0].raised_at);
});
