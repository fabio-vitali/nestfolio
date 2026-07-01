import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentFloor } from '../lib/present-floor.mjs';
import { validDraft } from './_fixtures.mjs';

const mintChoice = () => ({ act: 'mint', candidate: validDraft().entry, lesson: 'feedback_sample.md',
  rationale: 'r', recommended: 'ratify', options: ['ratify', 'edit', 'decline'] });

test('PF1 default (headless) ask → paused with sentinel, no selected', () => {
  const r = presentFloor({ choice: mintChoice() });
  assert.match(r.sentinel, /HARNESS-PAUSE: mint sample-mint/);
  assert.equal(r.selected, undefined);
});

test('PF2 an injected ask returning {selected:ratify} resolves', () => {
  const r = presentFloor({ choice: mintChoice(), ask: () => ({ selected: 'ratify' }) });
  assert.equal(r.selected, 'ratify');
  assert.equal(r.sentinel, undefined);
});

test('PF3 an injected ask returning an out-of-set selection degrades to a pause (never a silent default)', () => {
  const r = presentFloor({ choice: mintChoice(), ask: () => ({ selected: 'yolo' }) });
  assert.equal(r.selected, undefined);
  assert.match(r.sentinel, /HARNESS-PAUSE/);
});
