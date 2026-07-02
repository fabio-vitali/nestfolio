import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineSuite } from '../suite.mjs';
import { STUB_BINARIES } from '../structural-lint.mjs';

test('defineSuite carries the four-part contract incl. the stub set', () => {
  const s = defineSuite({ buildSandbox: () => {}, stubs: STUB_BINARIES, grade: () => {}, scenarios: [] });
  assert.deepEqual(s.stubs, STUB_BINARIES);
  assert.ok(typeof s.buildSandbox === 'function' && typeof s.grade === 'function');
});

test('run.mjs assembles its suite THROUGH defineSuite (the seam is live, not bypassed)', () => {
  const src = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8');
  assert.match(src, /defineSuite\(/);
  assert.match(src, /from ['"]\.\/suite\.mjs['"]/);
});
