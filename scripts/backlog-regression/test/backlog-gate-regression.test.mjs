// scripts/backlog-regression/test/backlog-gate-regression.test.mjs — THE deterministic regression table:
// the runtime commit gate must catch every backlog-lint violation class over the shared good/bad stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULE_MAP, runRegression } from '../backlog-gate-regression.mjs';

test('RULE_MAP totality: all 11 lint rules + index + element-shape present', () => {
  const rules = RULE_MAP.map((r) => r.rule);
  for (const r of ['r1-id-matches-filename', 'r2-single-active', 'r3-references-valid', 'r4-active-out-of-scope',
    'r5-shipped-validation-gate', 'r6-queued-ranks', 'r8-promotion-trigger', 'r9-epic-closure',
    'r10-epic-pointer', 'r11-single-active-epic', 'index-matches', 'element-shape']) {
    assert.ok(rules.includes(r), r);
  }
  for (const row of RULE_MAP) if (row.mapped) assert.ok(row.checks.length > 0, `${row.rule}: mapped needs checks`);
});

test('regression over all fixtures: the runtime gate catches every rule; no good false-positive', async () => {
  const { rows } = await runRegression();
  const byRule = Object.fromEntries(rows.map((r) => [r.rule, r]));
  // every mapped rule (all of them post-P4-migration, incl. element-shape which legacy lint was blind to)
  // must be caught by the runtime commit gate.
  for (const row of RULE_MAP)
    assert.equal(byRule[row.rule].class, 'runtime-catches', `${row.rule}: ${JSON.stringify(byRule[row.rule])}`);
  // no clean store may false-positive
  assert.ok(rows.every((r) => r.class !== 'good-false-positive'),
    JSON.stringify(rows.filter((r) => r.class === 'good-false-positive')));
});
