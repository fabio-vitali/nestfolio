import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorChoiceSchema } from '../schema/floor-choice.ts';
import { validateFloorDecision } from '../schema/floor-decision.ts';
import { validateEvalScenarioLanding } from '../schema/eval-landing.ts';
import { validDraft, validCheck } from './_fixtures.mjs';

const mintChoice = () => ({ act: 'mint', candidate: validDraft().entry, lesson: 'feedback_sample.md',
  rationale: 'r', recommended: 'ratify', options: ['ratify', 'edit', 'decline'] });
const finding = () => ({ id: 'f1', check: 'no-ddb-scan', kind: 'staleness', scope: ['x'], detail: 'gone', raised_at: '2026-07-02T00:00:00Z' });
const curateChoice = () => ({ act: 'curate', guard: validCheck({ id: 'no-ddb-scan' }), trigger: 'dangling-scope',
  finding: finding(), rationale: '', recommended: 'retire', options: ['retire', 'supersede', 'keep'] });

test('FC1 a MintChoice parses via the discriminated union', () => {
  assert.equal(FloorChoiceSchema.safeParse(mintChoice()).success, true);
});
test('FC2 a CurateChoice parses via the discriminated union', () => {
  assert.equal(FloorChoiceSchema.safeParse(curateChoice()).success, true);
});
test('FC3 an unknown act is rejected', () => {
  assert.equal(FloorChoiceSchema.safeParse({ ...mintChoice(), act: 'nope' }).success, false);
});
test('FC4 a proposed_successor as the §4.1 draft envelope (entry+eval_scenario+rationale) validates', () => {
  const successor = { entry: validCheck({ id: 'no-ddb-scan-v2' }),
    eval_scenario: { path: 'p', fixtures: { good: [], bad: [] }, target_pass_rate: 1 }, rationale: 'narrowed' };
  assert.equal(FloorChoiceSchema.safeParse({ ...curateChoice(), proposed_successor: successor }).success, true);
});
test('FC5 a proposed_successor as a bare CheckEntry (no envelope) is rejected', () => {
  const bareEntry = validCheck({ id: 'no-ddb-scan-v2' });
  assert.equal(FloorChoiceSchema.safeParse({ ...curateChoice(), proposed_successor: bareEntry }).success, false);
});
test('FD1 a ratify decision (empty rationale allowed) passes', () => {
  const r = validateFloorDecision({ act: 'mint', transition: 'ratify', check: 'no-ddb-scan', rationale: '',
    provenance: { minted_by: 'i', ratified: '2026-07-02' }, decided_by: 'human', decided_at: '2026-07-02T00:00:00Z', journal_key: 'mint:no-ddb-scan:ratify' });
  assert.equal(r.ok, true);
});
test('FD2 a retire decision with EMPTY rationale is rejected', () => {
  const r = validateFloorDecision({ act: 'curate', transition: 'retire', check: 'x', rationale: '   ',
    provenance: { minted_by: 'i' }, decided_by: 'human', decided_at: 't', journal_key: 'curate:x:retire' });
  assert.equal(r.ok, false);
  assert.match(r.error, /rationale/);
});
test('FD3 a supersede decision without successor is rejected', () => {
  const r = validateFloorDecision({ act: 'curate', transition: 'supersede', check: 'x', rationale: 'narrowed',
    provenance: { minted_by: 'i' }, decided_by: 'human', decided_at: 't', journal_key: 'curate:x:supersede' });
  assert.equal(r.ok, false);
  assert.match(r.error, /successor/);
});
test('FD4 decided_by must be human (closed literal)', () => {
  const r = validateFloorDecision({ act: 'mint', transition: 'ratify', check: 'x', rationale: '',
    provenance: { minted_by: 'i', ratified: 't' }, decided_by: 'auto', decided_at: 't', journal_key: 'k' });
  assert.equal(r.ok, false);
});
test('EL1 a deterministic landing (no flake_contract) passes', () => {
  const r = validateEvalScenarioLanding({ check: 'no-ddb-scan', evaluator_kind: 'deterministic',
    scenario_path: 'runtime/eval/scenarios/no-ddb-scan.scenario.mjs', fixtures: { good: ['g'], bad: ['b'] }, registered_via: 'harness:landScenario' });
  assert.equal(r.ok, true);
});
test('EL2 a judgment landing WITHOUT flake_contract is rejected', () => {
  const r = validateEvalScenarioLanding({ check: 'x', evaluator_kind: 'judgment',
    scenario_path: 'p', fixtures: { good: [], bad: [] }, registered_via: 'harness:landScenario' });
  assert.equal(r.ok, false);
  assert.match(r.error, /flake_contract/);
});
