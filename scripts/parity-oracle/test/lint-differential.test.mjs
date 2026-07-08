// scripts/parity-oracle/test/lint-differential.test.mjs — THE deterministic parity table: expected
// verdict class per rule over the shared good/bad stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULE_MAP, runDifferential } from '../lint-differential.mjs';

test('RULE_MAP totality: all 11 lint rules + index + element-shape present', () => {
  const rules = RULE_MAP.map((r) => r.rule);
  for (const r of ['r1-id-matches-filename', 'r2-single-active', 'r3-references-valid', 'r4-active-out-of-scope',
    'r5-shipped-validation-gate', 'r6-queued-ranks', 'r8-promotion-trigger', 'r9-epic-closure',
    'r10-epic-pointer', 'r11-single-active-epic', 'index-matches', 'element-shape']) {
    assert.ok(rules.includes(r), r);
  }
  for (const row of RULE_MAP) if (row.mapped) assert.ok(row.checks.length > 0, `${row.rule}: mapped needs checks`);
});

test('differential over all fixtures: expected classes', async () => {
  const { rows } = await runDifferential();
  const byRule = Object.fromEntries(rows.map((r) => [r.rule, r]));
  // mapped rules: runtime must catch what legacy catches. r9/r10 are dedicated content checks
  // since the P4 migration (backlog-epic-closure / backlog-epic-pointer-integrity) — mapped,
  // no longer transitive. See RULE_MAP comment.
  for (const rule of ['r1-id-matches-filename', 'r2-single-active', 'r3-references-valid',
    'r4-active-out-of-scope', 'r5-shipped-validation-gate', 'r6-queued-ranks', 'r8-promotion-trigger',
    'r9-epic-closure', 'r10-epic-pointer', 'r11-single-active-epic', 'index-matches'])
    assert.equal(byRule[rule].class, 'both-catch', `${rule}: ${JSON.stringify(byRule[rule])}`);
  for (const row of rows) assert.equal(row.mapped, true, `${row.rule}: every rule is mapped post-P4-migration`);
  // the runtime-only bonus: the element-shape class legacy lint is blind to
  assert.equal(byRule['element-shape'].class, 'runtime-only', JSON.stringify(byRule['element-shape']));
  // no good fixture may false-positive on either engine
  assert.ok(rows.every((r) => r.class !== 'good-false-positive'), JSON.stringify(rows.filter((r) => r.class === 'good-false-positive')));
});
