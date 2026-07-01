import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlessAsk, inMemoryJournal } from '../lib/capabilities.mjs';
import { validDraft, validCheck } from './_fixtures.mjs';

test('CAP1 headlessAsk on a mint choice returns a HARNESS-PAUSE sentinel naming the candidate', () => {
  const a = headlessAsk({ choice: { act: 'mint', candidate: validDraft().entry } });
  assert.match(a.sentinel, /^<<HARNESS-PAUSE: mint sample-mint>>$/);
  assert.equal(a.selected, undefined);   // NEVER self-resolves
});

test('CAP2 headlessAsk on a curate choice names the guard', () => {
  const a = headlessAsk({ choice: { act: 'curate', guard: validCheck({ id: 'no-ddb-scan' }) } });
  assert.match(a.sentinel, /curate no-ddb-scan/);
});

test('CAP3 inMemoryJournal records once and replays the same value (idempotent)', () => {
  const j = inMemoryJournal();
  assert.equal(j.has('k'), false);
  const first = j.record('k', { v: 1 });
  assert.equal(j.has('k'), true);
  const second = j.record('k', { v: 2 });   // second write ignored
  assert.deepEqual(first, { v: 1 });
  assert.deepEqual(second, { v: 1 });
  assert.deepEqual(j.get('k'), { v: 1 });
});
