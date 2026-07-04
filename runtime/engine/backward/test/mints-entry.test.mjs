import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMintsEntry } from '../schema/mints-entry.ts';

test('M1 a valid active mints entry passes', () => {
  const r = validateMintsEntry({ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'active' });
  assert.equal(r.ok, true);
});

test('M2 status superseded REQUIRES superseded_by', () => {
  const r = validateMintsEntry({ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'superseded' });
  assert.equal(r.ok, false);
  assert.match(r.error, /superseded_by/);
});

test('M3 superseded WITH superseded_by passes', () => {
  const r = validateMintsEntry({ check: 'no-ddb-scan', ratified: '2026-07-02', status: 'superseded', superseded_by: 'no-ddb-scan-v2' });
  assert.equal(r.ok, true);
});

test('M4 unknown status is rejected (closed enum)', () => {
  const r = validateMintsEntry({ check: 'x', ratified: '2026-07-02', status: 'draft' });
  assert.equal(r.ok, false);
});

test('M5 unknown extra field is rejected (strict)', () => {
  const r = validateMintsEntry({ check: 'x', ratified: '2026-07-02', status: 'active', note: 'nope' });
  assert.equal(r.ok, false);
});

test('EPOCH: generation is accepted as an int ≥ 1 and optional (absent = 1)', () => {
  const ok = validateMintsEntry({ check: 'x', ratified: '2026-07-04', status: 'active', generation: 2 });
  assert.equal(ok.ok, true);
  const bad = validateMintsEntry({ check: 'x', ratified: '2026-07-04', status: 'active', generation: 0 });
  assert.equal(bad.ok, false);
});
