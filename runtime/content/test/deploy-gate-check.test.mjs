// runtime/content/test/deploy-gate-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'yaml';
import { validateCheck } from '../../engine/schema/check.schema.ts';
import { selectChecks } from '../../engine/lib/run-watch.mjs';

const load = (p) => validateCheck(yaml.parse(readFileSync(p, 'utf8')));

test('DGC1 deploy-gate.yaml is schema-valid, deterministic, audit/expensive', () => {
  const r = load('runtime/content/checks/deploy-gate.yaml');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.value.evaluator.type, 'deterministic');
  assert.deepEqual(r.value.contexts, ['audit']);
  assert.equal(r.value.cost_tier, 'expensive');
});

test('DGC2 selected by an item-pre-ship expensive audit trigger, NOT by a gate trigger', () => {
  const check = load('runtime/content/checks/deploy-gate.yaml').value;
  const registry = { checks: [check], byId: new Map([[check.id, check]]), errors: [] };
  const picked = selectChecks({ registry, trigger: { on: 'item-pre-ship', contexts: ['audit'], cost_ceiling: 'expensive' }, changedScope: ['services/x/y/src/a.ts'] });
  assert.deepEqual(picked.map((c) => c.id), ['deploy-gate']);
  const notPicked = selectChecks({ registry, trigger: { on: 'ship', contexts: ['gate'], cost_ceiling: 'cheap' }, changedScope: ['services/x/y/src/a.ts'] });
  assert.deepEqual(notPicked.map((c) => c.id), []);   // gate-context run never selects it
});

test('DGC3 starter-pack copy is identical (sandbox visibility)', () => {
  const a = readFileSync('runtime/content/checks/deploy-gate.yaml', 'utf8');
  const b = readFileSync('runtime/starter/checks/deploy-gate.yaml', 'utf8');
  assert.equal(a, b);
});
