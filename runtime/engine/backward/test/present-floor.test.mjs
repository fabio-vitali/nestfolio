import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentFloor, toDecision } from '../lib/present-floor.mjs';
import { validCheck } from './_fixtures.mjs';

const mintChoice = { act: 'mint', candidate: { id: 'no-x' }, lesson: 'feedback_x.md', rationale: 'because',
  recommended: 'ratify', options: ['ratify', 'edit', 'decline'] };

test('toDecision maps a FloorChoice to a well-formed Decision (exactly one recommended)', () => {
  const d = toDecision(mintChoice);
  assert.equal(d.id, 'mint-no-x-g1');
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

test('FULL-RENDER mint: context carries the complete candidate YAML + rationale', () => {
  const entry = validCheck({ id: 'no-x', status: 'candidate', provenance: { minted_by: 'i', lesson: 'l.md' } });
  const d = toDecision({ act: 'mint', candidate: entry, lesson: 'l.md', rationale: 'why', recommended: 'ratify', options: ['ratify', 'edit', 'decline'] });
  assert.match(d.context, /RATIONALE: why/);
  assert.match(d.context, /candidate check \(full YAML\)/);
  assert.match(d.context, /id: no-x/);
  assert.match(d.context, /property:/);
});

test('FULL-RENDER curate: context carries guard YAML, trigger, finding, successor YAML', () => {
  const guard = validCheck({ id: 'no-x', status: 'active', provenance: { minted_by: 'i', ratified: 't' } });
  const successor = { entry: validCheck({ id: 'no-x-v2', status: 'active', provenance: { minted_by: 'i', ratified: 't' } }),
    eval_scenario: { path: 'p', fixtures: { good: [], bad: [] }, target_pass_rate: 1 }, rationale: 'narrower' };
  const d = toDecision({ act: 'curate', guard, trigger: 'ship-gate', finding: { id: 'f#0', check: 'no-x', kind: 'drift', scope: ['a.ts'], detail: 'x', raised_at: 't' },
    proposed_successor: successor, rationale: 'r', recommended: 'keep', options: ['retire', 'supersede', 'keep'] });
  assert.match(d.context, /TRIGGER: ship-gate/);
  assert.match(d.context, /current guard \(full YAML\)/);
  assert.match(d.context, /id: no-x-v2/);
  assert.match(d.context, /finding/);
});

test('EPOCH-P1 Decision ids are distinct across generations', () => {
  const g1 = validCheck({ id: 'no-x', status: 'candidate', provenance: { minted_by: 'i' } });
  const g2 = validCheck({ id: 'no-x', status: 'candidate', provenance: { minted_by: 'i', generation: 2 } });
  const mk = (c) => toDecision({ act: 'mint', candidate: c, lesson: 'l', rationale: 'r', recommended: 'ratify', options: ['ratify'] }).id;
  assert.equal(mk(g1), 'mint-no-x-g1');
  assert.equal(mk(g2), 'mint-no-x-g2');
});
