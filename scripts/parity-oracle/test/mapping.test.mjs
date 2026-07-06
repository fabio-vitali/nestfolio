// scripts/parity-oracle/test/mapping.test.mjs — totality is THE no-silent-caps enforcement: every
// legacy scenario id appears exactly once (mapped or unmapped-with-reason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { MAPPING, mappedIds, unmappedIds, OPERATOR_PROMPT } from '../mapping.mjs';

const legacyIds = readdirSync(new URL('../../benchmark-backlog/scenarios/', import.meta.url))
  .filter((f) => f.endsWith('.scenario.mjs')).map((f) => f.replace('.scenario.mjs', ''));

test('totality: every legacy scenario id appears exactly once', () => {
  assert.deepEqual(Object.keys(MAPPING).sort(), legacyIds.sort());
});

test('unmapped entries carry a reason; mapped entries name an rt scenario module', () => {
  for (const [id, m] of Object.entries(MAPPING)) {
    if (m.unmapped) { assert.equal(m.unmapped, 'P5'); assert.ok(m.reason?.length > 10, `${id} needs a reason`); }
    else assert.match(m.runtime.scenario, /^rt-.+\.scenario\.mjs$/);
  }
});

test('mapped and unmapped partition the full MAPPING (no id is both or neither)', () => {
  const all = Object.keys(MAPPING).sort();
  assert.deepEqual([...mappedIds(), ...unmappedIds()].sort(), all);
  assert.equal(new Set([...mappedIds(), ...unmappedIds()]).size, all.length); // disjoint
});

test('the mapped set is the engine-expressible subset (D3)', () => {
  const mapped = mappedIds();
  assert.equal(mapped.length, 11);
  for (const id of ['add-fold-core', 'add-orphan', 'next-lane-complex-ship', 'next-auto-floor-pause']) assert.ok(mapped.includes(id), id);
  for (const id of ['bne-e8-pr-route', 'themes-cluster-root-cause', 'next-lane-doc-layer', 'add-id-collision-suffix']) assert.ok(!mapped.includes(id), id);
});

test('operator prompt encodes park/fulfil + floor-stop contract', () => {
  const p = OPERATOR_PROMPT('File finding X.');
  for (const needle of ['exit code 3', '--fulfil', 'execute:', '"status":"done"', '<<HARNESS-PAUSE:', 'File finding X.']) assert.ok(p.includes(needle), needle);
});
