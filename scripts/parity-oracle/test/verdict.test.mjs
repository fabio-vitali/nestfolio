// scripts/parity-oracle/test/verdict.test.mjs — D2 strict-dominance math edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureClasses, pairVerdict, overallParity } from '../verdict.mjs';

const row = (gatePassRate, diagnostics) => ({ gatePassRate, tokens: { total: 1 }, diagnostics });

test('failureClasses normalizes diagnostics into class labels', () => {
  const c = failureClasses(row(0.5, {
    terminalOk: false,
    goldenFailures: ['x.status: expected "shipped", got "active"'],
    invariantFailures: ['expected call-log "deploy.sh" not found', 'run timed out'],
    rubricScores: null,
  }));
  assert.ok(c.has('terminal'));
  assert.ok(c.has('golden:x.status'));
  assert.ok(c.has('invariant:expected call-log "deploy.sh" not found'));
});

test('dominance: rate >= and no new failure class', () => {
  assert.equal(pairVerdict({ legacy: row(1), runtime: row(1) }).dominant, true);
  assert.equal(pairVerdict({ legacy: row(0.5, { invariantFailures: ['a'] }), runtime: row(1) }).dominant, true);
  const worse = pairVerdict({ legacy: row(1), runtime: row(0.5, { invariantFailures: ['a'] }) });
  assert.equal(worse.dominant, false);
  assert.ok(worse.reasons.some((r) => r.includes('gatePassRate')));
  // equal rate but a NEW class on the runtime side → not dominant
  const newClass = pairVerdict({
    legacy: row(0.5, { invariantFailures: ['a'] }),
    runtime: row(0.5, { invariantFailures: ['b'] }),
  });
  assert.equal(newClass.dominant, false);
});

test('errored rows are never dominant; overall parity composes pairs + differential', () => {
  assert.equal(pairVerdict({ legacy: row(1), runtime: { error: 'boom' } }).dominant, false);
  const parity = overallParity({
    pairs: [
      { id: 'p1', verdict: { dominant: true, reasons: [] } },
      { id: 'p2', verdict: { dominant: false, reasons: ['x'] } },
    ],
    differential: { rows: [
      { rule: 'r1', mapped: true, class: 'legacy-only' },
      { rule: 'r5', mapped: false, class: 'legacy-only' },
    ] },
  });
  assert.equal(parity.green, false);
  assert.deepEqual(parity.nonDominant, ['p2']);
  assert.deepEqual(parity.redRules, ['r1']);   // unmapped legacy-only rows are honest gaps, not red
});
