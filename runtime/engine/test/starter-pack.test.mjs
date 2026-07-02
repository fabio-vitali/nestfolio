import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/load-registry.mjs';
import { metaCheck } from '../lib/meta-check.mjs';

test('the 6 starter checks all validate (loadRegistry reports no errors)', () => {
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  assert.deepEqual(reg.errors, []);
  assert.equal(reg.checks.length, 6);
});

test('B4: the starter pack is cheap-by-construction — no invariant declares a non-cheap tier', () => {
  const reg = loadRegistry({ checksDir: 'runtime/starter/checks' });
  const findings = metaCheck({ registry: reg, env: { resolveGlobs: () => ['x'] } });
  const cheapViolations = findings.filter((f) => f.kind === 'inconsistency' && /cheap|invariant/i.test(f.detail));
  assert.deepEqual(cheapViolations, []);
});
