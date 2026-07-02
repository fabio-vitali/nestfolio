import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentFloor, toDecision } from '../lib/present-floor.mjs';

const mintChoice = { act: 'mint', candidate: { id: 'no-x' }, lesson: 'feedback_x.md', rationale: 'because',
  recommended: 'ratify', options: ['ratify', 'edit', 'decline'] };

test('toDecision maps a FloorChoice to a well-formed Decision (exactly one recommended)', () => {
  const d = toDecision(mintChoice);
  assert.equal(d.id, 'mint-no-x');
  assert.equal(d.options.filter((o) => o.recommended).length, 1);
  assert.deepEqual(d.options.map((o) => o.value), ['ratify', 'edit', 'decline']);
});

test('a selection in options is returned as selected', async () => {
  const ask = async (d) => ({ decisionId: d.id, value: 'ratify' });
  const r = await presentFloor({ choice: mintChoice, ask });
  assert.equal(r.selected, 'ratify');
  assert.equal(r.sentinel, undefined);
});

test('a PAUSE-valued choice (headless) → sentinel, never a silent default', async () => {
  const r = await presentFloor({ choice: mintChoice });   // default headlessAsk → PAUSE
  assert.equal(r.selected, undefined);
  assert.equal(r.sentinel, '<<HARNESS-PAUSE: mint no-x>>');
});

test('an out-of-options answer is also treated as a pause', async () => {
  const ask = async (d) => ({ decisionId: d.id, value: 'bogus' });
  const r = await presentFloor({ choice: mintChoice, ask });
  assert.equal(r.sentinel, '<<HARNESS-PAUSE: mint no-x>>');
});
