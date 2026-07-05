import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/load-registry.mjs';
import { metaCheck } from '../lib/meta-check.mjs';

const CHECKS_DIR = 'runtime/content/checks';   // resolved against repo root (cwd of `node --test`)

test('the content ring loads with zero errors (schema accepts every real entry)', () => {
  const reg = loadRegistry({ checksDir: CHECKS_DIR });
  assert.deepEqual(reg.errors, [], `content-ring load errors: ${JSON.stringify(reg.errors)}`);
  assert.ok(reg.checks.length >= 6, `expected >=6 content-ring checks, got ${reg.checks.length}`);
});

test('every content-ring evaluator resolves (metaCheck assertion 2 raises no gap for a real ref)', () => {
  const reg = loadRegistry({ checksDir: CHECKS_DIR });
  const env = { enforcedSurfaces: [], storedKnobs: [], resolveGlobs: (paths) => paths /* treat as non-empty */ };
  const findings = metaCheck({ registry: reg, env });
  const unresolved = findings.filter((f) => f.kind === 'gap' && /does not resolve/.test(f.detail));
  assert.deepEqual(unresolved, [], `unresolved evaluators: ${JSON.stringify(unresolved)}`);
});

test('the content ring is fully clean under a real env (no meta-check findings at all)', () => {
  const reg = loadRegistry({ checksDir: CHECKS_DIR });
  const env = { enforcedSurfaces: [], storedKnobs: [], resolveGlobs: (paths) => paths };
  const findings = metaCheck({ registry: reg, env });
  assert.deepEqual(findings, [], `unexpected meta-check findings: ${JSON.stringify(findings, null, 2)}`);
});

test('no-states-runtime-catch scope matches its tool filters (services+libs+infrastructure .ts)', () => {
  const reg = loadRegistry({ checksDir: CHECKS_DIR });
  const c = reg.byId.get('no-states-runtime-catch');
  assert.deepEqual(c.scope.paths.slice().sort(),
    ['infrastructure/**/*.ts', 'libs/**/*.ts', 'services/**/*.ts']);
});
