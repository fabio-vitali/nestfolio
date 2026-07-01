import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidateDraft } from '../schema/candidate-draft.ts';
import { validDraft } from './_fixtures.mjs';

test('D1 a valid deterministic draft passes', () => {
  assert.equal(validateCandidateDraft(validDraft()).ok, true);
});

test('D2 a draft whose entry.status is NOT candidate is rejected', () => {
  const d = validDraft({ entry: { ...validDraft().entry, status: 'active' } });
  const r = validateCandidateDraft(d);
  assert.equal(r.ok, false);
  assert.match(r.error, /candidate/);
});

test('D3 Δ2: a draft carrying provenance.ratified is rejected', () => {
  const base = validDraft();
  const d = { ...base, entry: { ...base.entry, provenance: { ...base.entry.provenance, ratified: '2026-07-02' } } };
  const r = validateCandidateDraft(d);
  assert.equal(r.ok, false);
  assert.match(r.error, /ratified/);
});

test('D4 target_pass_rate out of [0,1] is rejected', () => {
  const base = validDraft();
  const d = { ...base, eval_scenario: { ...base.eval_scenario, target_pass_rate: 1.5 } };
  assert.equal(validateCandidateDraft(d).ok, false);
});

test('D5 supersedes_candidate is accepted (superseding mint)', () => {
  assert.equal(validateCandidateDraft(validDraft({ supersedes_candidate: 'no-ddb-scan' })).ok, true);
});
