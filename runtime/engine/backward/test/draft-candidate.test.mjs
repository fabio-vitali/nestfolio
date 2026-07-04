import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftCandidate } from '../lib/draft-candidate.mjs';

const proposal = (over = {}) => ({
  id: 'no-ddb-scan',
  property: 'No ScanCommand under services/**/src',
  kind: 'drift',
  evaluator: { type: 'deterministic', run: 'cmd:node tools/check-no-ddb-scan.mjs' },
  cost_tier: 'cheap',
  contexts: ['invariant', 'gate'],
  scope: { paths: ['services/**/src/**/*.ts'], dossiers: ['feedback_no_scan_no_filter.md'] },
  eval_scenario: { path: 'runtime/eval/scenarios/no-ddb-scan.scenario.mjs',
    fixtures: { good: ['fixtures/no-ddb-scan/good/query.ts'], bad: ['fixtures/no-ddb-scan/bad/scan.ts'] }, target_pass_rate: 1.0 },
  rationale: 'mechanizable forbidden-token set, recurring cost blowups, still intended',
  gates: { mechanizable: true, recurring: true, stillIntended: true },
  ...over,
});

test('DC1 all three §8 gates pass → a valid candidate draft (minted_by set, NO ratified)', () => {
  const d = draftCandidate({ item: { id: 'no-ddb-scan-guard' }, lesson: 'feedback_no_scan_no_filter.md', proposal: proposal() });
  assert.ok(d);
  assert.equal(d.entry.status, 'candidate');
  assert.equal(d.entry.evaluator.type, 'deterministic');
  assert.equal(d.entry.provenance.minted_by, 'no-ddb-scan-guard');
  assert.equal(d.entry.provenance.lesson, 'feedback_no_scan_no_filter.md');
  assert.equal(d.entry.provenance.ratified, undefined);      // Δ2
});

test('DC2 §8 category error: gate 1 (not mechanizable) fails → null, no draft', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'feedback_cleanest_over_blast_radius.md',
    proposal: proposal({ gates: { mechanizable: false, recurring: true, stillIntended: true } }) });
  assert.equal(d, null);
});

test('DC3 gate 2 (not recurring) fails → null', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'x', proposal: proposal({ gates: { mechanizable: true, recurring: false, stillIntended: true } }) });
  assert.equal(d, null);
});

test('DC4 gate 3 (not still intended) fails → null', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'x', proposal: proposal({ gates: { mechanizable: true, recurring: true, stillIntended: false } }) });
  assert.equal(d, null);
});

test('DC5 a superseding draft carries supersedes_candidate', () => {
  const d = draftCandidate({ item: { id: 'i' }, lesson: 'x', proposal: proposal({ id: 'no-ddb-scan-v2', supersedes_candidate: 'no-ddb-scan' }) });
  assert.equal(d.supersedes_candidate, 'no-ddb-scan');
});

test('EPOCH-D1 proposal.generation lands on entry.provenance.generation; absent = no key', () => {
  const item = { id: 'no-ddb-scan-guard' };
  const lesson = 'feedback_no_scan_no_filter.md';
  const d2 = draftCandidate({ item, lesson, proposal: { ...proposal(), generation: 2 } });
  assert.equal(d2.entry.provenance.generation, 2);
  const d1 = draftCandidate({ item, lesson, proposal: proposal() });
  assert.equal('generation' in d1.entry.provenance, false);
});
