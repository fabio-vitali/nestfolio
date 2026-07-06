import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/load-registry.mjs';
import { loadTriggers } from '../lib/run-watch.mjs';

const AUDITS = ['audit-service', 'audit-domain', 'audit-system', 'audit-e2e-test'];

test('the 4 audit-* judgment checks load, are valid, judgment, audit-context, expensive, with a flake_contract', () => {
  const reg = loadRegistry({ checksDir: 'runtime/content/checks' });
  assert.deepEqual(reg.errors, [], 'registry has no load/validation errors');
  for (const id of AUDITS) {
    const c = reg.byId.get(id);
    assert.ok(c, `${id} present`);
    assert.equal(c.evaluator.type, 'judgment');
    assert.equal(c.evaluator.run, `skill:${id}`);
    assert.equal(c.cost_tier, 'expensive');
    assert.deepEqual(c.contexts, ['audit']);
    assert.ok(c.flake_contract, `${id} carries a flake_contract`);
  }
});

test('the schedule trigger can afford expensive audit checks', () => {
  const t = loadTriggers('runtime/content/triggers.yaml').find((x) => x.on === 'schedule');
  assert.ok(t.contexts.includes('audit'));
  assert.equal(t.cost_ceiling, 'expensive');
});
