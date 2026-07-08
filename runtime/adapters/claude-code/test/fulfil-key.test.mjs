// runtime/adapters/claude-code/test/fulfil-key.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { resolveFulfilKey } from '../fulfil-key.mjs';

const decision = (id) => ({ id, question: 'q', options: [{ label: 'F', value: 'fulfil', recommended: true }] });

function ledgerWith(...parks) {
  const j = inMemoryJournal();
  j.begin('r', { runId: 'r', auto: false });
  for (const [key, decisionId] of parks) j.awaiting('r', key, decision(decisionId));
  return j.read('r');
}

test('FK1 exact pending step-key match wins — no translation', () => {
  const ledger = ledgerWith(['member.m1', 'execute:m1']);
  assert.equal(resolveFulfilKey(ledger, 'member.m1'), 'member.m1');
});

test('FK2 unique decision-id match translates to the pending step key (the epic-spine trap)', () => {
  const ledger = ledgerWith(['member.m1', 'execute:m1']);
  assert.equal(resolveFulfilKey(ledger, 'execute:m1'), 'member.m1');
});

test('FK3 coinciding key and decision id (worker spine) resolves to itself', () => {
  const ledger = ledgerWith(['execute:i1', 'execute:i1']);
  assert.equal(resolveFulfilKey(ledger, 'execute:i1'), 'execute:i1');
});

test('FK4 step-key match takes priority over another pending decision-id match', () => {
  const ledger = ledgerWith(['member.m1', 'execute:m1'], ['execute:m1', 'other']);
  assert.equal(resolveFulfilKey(ledger, 'execute:m1'), 'execute:m1');
});

test('FK5 ambiguous decision-id match throws — never guess which park to advance', () => {
  const ledger = ledgerWith(['member.m1', 'dup'], ['member.m2', 'dup']);
  assert.throws(() => resolveFulfilKey(ledger, 'dup'), /ambiguous.*member\.m1.*member\.m2/);
});

test('FK6 no pending match passes through unchanged (pre-seeded choice on a fresh run)', () => {
  assert.equal(resolveFulfilKey(ledgerWith(), 'ship-i1'), 'ship-i1');
  assert.equal(resolveFulfilKey(null, 'ship-i1'), 'ship-i1');   // FRESH run — no ledger yet
});

test('FK7 a fulfilled park is no longer pending — its decision id no longer translates', () => {
  const j = inMemoryJournal();
  j.begin('r', { runId: 'r', auto: false });
  j.awaiting('r', 'member.m1', decision('execute:m1'));
  j.fulfil('r', 'member.m1', { taskId: 'm1', status: 'done', summary: 'ok' });
  assert.equal(resolveFulfilKey(j.read('r'), 'execute:m1'), 'execute:m1');   // pass-through
});
