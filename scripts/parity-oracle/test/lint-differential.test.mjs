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
  // mapped rules: runtime must catch what legacy catches
  for (const rule of ['r1-id-matches-filename', 'r2-single-active', 'r3-references-valid', 'r11-single-active-epic', 'index-matches'])
    assert.equal(byRule[rule].class, 'both-catch', `${rule}: ${JSON.stringify(byRule[rule])}`);
  // unmapped rules: legacy-only is the HONEST gap (feeds P4), never red here
  for (const rule of ['r4-active-out-of-scope', 'r5-shipped-validation-gate', 'r6-queued-ranks', 'r8-promotion-trigger'])
    assert.equal(byRule[rule].class, 'legacy-only', `${rule}: ${JSON.stringify(byRule[rule])}`);
  // r9/r10: no dedicated check (mapped:false, still P4 gaps) but caught TRANSITIVELY via index-fresh —
  // the render omits mis-anchored epic members, so the generic index law fires. See RULE_MAP comment.
  for (const rule of ['r9-epic-closure', 'r10-epic-pointer']) {
    assert.equal(byRule[rule].class, 'both-catch', `${rule}: ${JSON.stringify(byRule[rule])}`);
    assert.equal(byRule[rule].mapped, false, rule);
  }
  // the runtime-only bonus: the element-shape class legacy lint is blind to
  assert.equal(byRule['element-shape'].class, 'runtime-only', JSON.stringify(byRule['element-shape']));
  // no good fixture may false-positive on either engine
  assert.ok(rows.every((r) => r.class !== 'good-false-positive'), JSON.stringify(rows.filter((r) => r.class === 'good-false-positive')));
});
