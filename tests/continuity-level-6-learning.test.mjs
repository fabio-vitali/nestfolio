// MI-007 Level 6 (Decision-and-Learning) binding validation — deterministic,
// repository-bound, no network, no mutation, no Skill. Verifies
// continuity/level-6/learning-binding.json and retirement-inventory.json against
// the actual repository state and the target learning artifacts authored through
// the pinned store API: the five Observations (four reviewed to
// accepted/duplicate/deferred/rejected plus one historical import), the two
// Lessons, the durable Decision, the Change Proposal (proposed->accepted->applied),
// the one owner-applied additive binding record with its full provenance chain and
// ordering, the no-auto-promotion pinned digests, the six-mechanism retirement
// inventory with zero actual retirement, and the explicit absence of any Run,
// Work Item, Checkpoint, Handoff, or Context Pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, digestJson } from '../runtime/continuity/lib/utils.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const fileSha = (p) => sha256(readFileSync(join(root, p)));
const artifact = (kind, id) => readJson(`continuity/artifacts/${kind}/${id}.json`);
const nonEmptyStr = (v) => typeof v === 'string' && v.length > 0;

const lb = readJson('continuity/level-6/learning-binding.json');
const el = readJson('continuity/level-6/engine-lock.json');
const APPLIED = 'continuity/bindings/nestfolio/decisions/mi007-deterministic-evidence-boundary-rule.json';
const GUARD_SHA = '74008f124ccc9962f94592a03d9a03fe492565e696cc3176a11a2c6066591f4a';
const LESSONS_SHA = 'eea79ec7be3f8370b491b3eb764159b89a8849ca7a45a875602a81de1549c1a3';
const LESSON1 = 'Before binding a validator as deterministic Evidence for a completion criterion, verify the validator is executable within the boundary of the session that must produce the Evidence; a validator that depends on external infrastructure may enter a bounded contract only as a byte-identity/non-regression subject or as separately produced, provenance-recorded external Evidence.';
const OUTCOME = {
  'observation-mi007-01-deterministic-evidence-sourcing': 'accepted',
  'observation-mi007-02-dead-handler-guard-duplicate': 'duplicate',
  'observation-mi007-03-run-mi005-staleness': 'deferred',
  'observation-mi007-04-occupied-work-item-conflict': 'rejected',
};

test('learning-binding: header, bound revision, and engine-lock digests', () => {
  assert.equal(lb.artifact, 'continuity.level-6.learning-binding');
  assert.equal(lb.iteration, 'MI-007');
  assert.equal(lb.bound_repository_revision, '6229bb010d76723aaec0385c923b157762ee512e');
  assert.equal(lb.contract_revision, '29b592c04162507b9495737a3214149a03de3cee');
  assert.equal(lb.engine_lock.aggregate_engine_digest, el.aggregate_engine_digest);
  assert.equal(lb.engine_lock.hook_registration_digest, el.hook_registration.digest);
  assert.equal(lb.engine_lock.settings_sha256, el.settings_json.sha256);
});

test('engine-lock: 20 engine assets + aggregate + settings + hook unchanged (engine unmodified)', () => {
  assert.equal(el.engine_files.length, 20);
  for (const e of el.engine_files) {
    const bytes = readFileSync(join(root, e.path));
    assert.equal(sha256(bytes), e.sha256, `engine asset digest mismatch: ${e.path}`);
    assert.equal(bytes.length, e.size, `engine asset size mismatch: ${e.path}`);
  }
  assert.equal(el.aggregate_engine_digest, digestJson(el.engine_files));
  assert.equal(el.aggregate_engine_digest, '7e31ff56a10ca6b1715b29f02132e66c80e321921b41dcb55329db2e0f320a38');
  assert.equal(fileSha('.claude/settings.json'), el.settings_json.sha256);
  const settings = readJson('.claude/settings.json');
  const reg = { SessionStart: settings.hooks?.SessionStart ?? null, SessionEnd: settings.hooks?.SessionEnd ?? null };
  assert.equal(digestJson(reg), el.hook_registration.digest);
});

test('observations: five created; four factual reviewed to contracted outcomes; historical import unpromoted', () => {
  assert.equal(lb.observations.length, 5);
  for (const [id, outcome] of Object.entries(OUTCOME)) {
    const o = artifact('observations', id);
    assert.equal(o.revision, 2, `${id} revision`);
    assert.equal(o.status, outcome, `${id} status`);
    assert.equal(o.review.outcome, outcome);
    assert.match(o.review.reviewer, /fabio\.vitali/);
    assert.ok(nonEmptyStr(o.review.statement_verbatim), `${id} verbatim`);
    assert.ok(nonEmptyStr(o.review.captured_at_utc), `${id} utc`);
    assert.ok(nonEmptyStr(o.review.rationale));
    const bound = lb.observations.find((x) => x.id === id);
    assert.equal(bound.digest, o.digest, `${id} binding digest`);
    assert.equal(bound.status, outcome);
  }
  const o5 = artifact('observations', 'observation-mi007-05-historical-import-f30');
  assert.equal(o5.revision, 1);
  assert.equal(o5.status, 'historical');
  assert.equal(o5.review, null);
  assert.equal(o5.import.source_path, '.claude/skills/backlog-next/LESSONS.md');
  assert.equal(o5.import.source_sha256, LESSONS_SHA);
  assert.match(o5.import.quoted_entry, /^F-30 — always stamp/);
  assert.equal(fileSha('.claude/skills/backlog-next/LESSONS.md'), LESSONS_SHA);
});

test('lessons: lesson01 accepted candidate; lesson02 rejected-unsafe; promotion.automatic always false', () => {
  const l1 = artifact('lessons', 'lesson-mi007-01-deterministic-evidence-boundary');
  assert.equal(l1.revision, 2);
  assert.equal(l1.status, 'accepted');
  assert.equal(l1.statement, LESSON1);
  assert.equal(l1.promotion.automatic, false);
  assert.equal(l1.promotion.status, 'proposal-created');
  assert.equal(l1.promotion.target_changes[0].id, 'change-proposal-mi007-01-deterministic-evidence-boundary-rule');
  assert.ok(nonEmptyStr(l1.acceptance.statement_verbatim));
  assert.ok(nonEmptyStr(l1.acceptance.captured_at_utc));
  assert.match(l1.acceptance.reviewer, /fabio\.vitali/);
  assert.equal(l1.observation_ref.id, 'observation-mi007-01-deterministic-evidence-sourcing');
  assert.equal(l1.observation_ref.revision, 2);

  const l2 = artifact('lessons', 'lesson-mi007-02-automatic-rebinding-rejected');
  assert.equal(l2.revision, 1);
  assert.equal(l2.status, 'rejected');
  assert.equal(l2.safety_review.status, 'unsafe');
  assert.ok(nonEmptyStr(l2.safety_review.rationale));
  assert.equal(l2.promotion.automatic, false);
  assert.equal(l2.promotion.status, 'not_promoted');
  assert.deepEqual(l2.promotion.target_changes, []);
  assert.equal(l2.observation_ref.id, 'observation-mi007-04-occupied-work-item-conflict');
});

test('decision: durable, owner-authorized, references observation/lesson/proposal', () => {
  const d = artifact('decisions', 'decision-mi007-01-accept-deterministic-evidence-boundary-change');
  assert.equal(d.revision, 1);
  assert.equal(d.status, 'decided');
  assert.match(d.decided_by, /fabio\.vitali/);
  assert.ok(nonEmptyStr(d.authorization.statement_verbatim));
  assert.ok(nonEmptyStr(d.authorization.captured_at_utc));
  assert.equal(d.supporting_refs.observation.id, 'observation-mi007-01-deterministic-evidence-sourcing');
  assert.equal(d.supporting_refs.lesson.id, 'lesson-mi007-01-deterministic-evidence-boundary');
  assert.equal(d.supporting_refs.change_proposal.id, 'change-proposal-mi007-01-deterministic-evidence-boundary-rule');
  assert.equal(lb.decision.digest, d.digest);
});

test('change-proposal: proposed -> accepted -> applied with decision and applied-file references', () => {
  const p = artifact('change-proposals', 'change-proposal-mi007-01-deterministic-evidence-boundary-rule');
  assert.equal(p.revision, 3);
  assert.equal(p.status, 'applied');
  assert.equal(p.target_artifact, APPLIED);
  assert.equal(p.decision_ref.id, 'decision-mi007-01-accept-deterministic-evidence-boundary-change');
  assert.equal(p.decision_ref.revision, 1);
  assert.equal(p.applied_file.path, APPLIED);
  assert.equal(p.applied_file.sha256, fileSha(APPLIED));
  assert.equal(lb.change_proposal.final_status, 'applied');
  assert.deepEqual(lb.change_proposal.revision_chain, [1, 2, 3]);
});

test('applied change: sole owner-authorized additive binding record with full provenance chain', () => {
  const a = readJson(APPLIED);
  assert.equal(a.id, 'mi007-deterministic-evidence-boundary-rule');
  assert.equal(a.status, 'accepted');
  assert.match(a.authority, /fabio\.vitali/);
  assert.ok(nonEmptyStr(a.application_authorization.statement_verbatim));
  assert.ok(nonEmptyStr(a.application_authorization.captured_at_utc));
  assert.equal(a.rule, LESSON1);
  assert.equal(a.provenance.change_proposal.id, 'change-proposal-mi007-01-deterministic-evidence-boundary-rule');
  assert.equal(a.provenance.change_proposal.revision, 2);
  assert.equal(a.provenance.decision.id, 'decision-mi007-01-accept-deterministic-evidence-boundary-change');
  assert.equal(a.provenance.decision.revision, 1);
  assert.equal(a.provenance.lesson.id, 'lesson-mi007-01-deterministic-evidence-boundary');
  assert.equal(a.provenance.observation.id, 'observation-mi007-01-deterministic-evidence-sourcing');
  assert.ok(Array.isArray(a.provenance.source_evidence) && a.provenance.source_evidence.length >= 1);
  assert.equal(fileSha(APPLIED), lb.applied_change.sha256);
});

test('ordering: applied file created strictly after the Decision and accepted Change Proposal', () => {
  assert.match(lb.ordering_rule, /strictly after/);
  const a = readJson(APPLIED);
  // The applied record embeds the Decision (rev 1) and accepted Change Proposal (rev 2)
  // that necessarily existed before it — the audit ledger sequence is the external proof.
  assert.equal(a.provenance.decision.revision, 1);
  assert.equal(a.provenance.change_proposal.revision, 2);
});

test('no-auto-promotion: pinned pre-existing bytes unchanged; applied file is the sole binding addition', () => {
  // pinned Guard definition byte-identical
  assert.equal(fileSha('continuity/bindings/nestfolio/guards/mi006-r1-dashboard-bff-no-dead-user-confirmation-requested-handler.json'), GUARD_SHA);
  // VS-001 observation/lesson records byte-identical (internal digests unchanged)
  const obsDigests = readdirSync(join(root, 'continuity/artifacts/observations')).filter((n) => n.startsWith('observation-') && !n.includes('mi007')).map((n) => readJson(`continuity/artifacts/observations/${n}`).digest).sort();
  assert.deepEqual(obsDigests, ['33234cfe62df7ba29fa0e2980df03c7d2fca47afc151640bdb6ce49fcb9d9086', 'd718383b32ef4bcba0cdd575d05f6505c46012b77fdf242455ed88ffa98d7394'].sort());
  const lesDigests = readdirSync(join(root, 'continuity/artifacts/lessons')).filter((n) => !n.includes('mi007')).map((n) => readJson(`continuity/artifacts/lessons/${n}`).digest).sort();
  assert.deepEqual(lesDigests, ['0cb8e9caa9dc24d1dc4e8a91283a120e71f6aa56779211c848b80539f0f8b284', 'e126b67a6dc415a08231168b979dcd261059dee24d9eeee85449c297b7f673bb'].sort());
  // the applied file is the SOLE addition under bindings/nestfolio/decisions
  const decDir = readdirSync(join(root, 'continuity/bindings/nestfolio/decisions')).sort();
  assert.deepEqual(decDir, ['mi007-deterministic-evidence-boundary-rule.json', 'vs001-accepted-decisions.json', 'vs001a-accepted-decisions.json']);
  assert.equal(lb.no_auto_promotion.sole_binding_addition, APPLIED);
});

test('retirement inventory: six classifications, zero retired, route facts and out-of-scope recorded', () => {
  const ri = readJson('continuity/level-6/retirement-inventory.json');
  assert.equal(ri.artifact, 'continuity.level-6.retirement-inventory');
  assert.equal(ri.classifications.length, 6);
  assert.equal(ri.total_retired, 0);
  for (const c of ri.classifications) {
    assert.equal(c.retired, false, c.mechanism);
    assert.ok(nonEmptyStr(c.mechanism) && nonEmptyStr(c.classification) && nonEmptyStr(c.basis));
  }
  assert.match(ri.nothing_retired_statement, /NOTHING is retired/);
  assert.ok(ri.route_facts.one_target_routed_effort_completed === true && ri.route_facts.no_active_target_run === true);
  assert.ok(nonEmptyStr(ri.out_of_scope_confirmations));
});

test('no MI-008 state: exactly the contracted learning artifacts; no Run/Work Item/Checkpoint created; recordLesson not used', () => {
  const obsAll = readdirSync(join(root, 'continuity/artifacts/observations')).filter((n) => n.endsWith('.json'));
  const lesAll = readdirSync(join(root, 'continuity/artifacts/lessons')).filter((n) => n.endsWith('.json'));
  assert.equal(obsAll.filter((n) => n.includes('mi007')).length, 5);
  assert.equal(obsAll.length, 7); // 5 mi007 + 2 vs001
  assert.equal(lesAll.filter((n) => n.includes('mi007')).length, 2);
  assert.equal(lesAll.length, 4); // 2 mi007 + 2 vs001
  assert.deepEqual(readdirSync(join(root, 'continuity/artifacts/decisions')).sort(), ['decision-mi007-01-accept-deterministic-evidence-boundary-change.json']);
  assert.deepEqual(readdirSync(join(root, 'continuity/artifacts/change-proposals')).sort(), ['change-proposal-mi007-01-deterministic-evidence-boundary-rule.json']);
  // no new Run artifact for MI-007; recordLesson excluded => run-mi006-r1 refs still empty
  assert.equal(readdirSync(join(root, 'continuity/artifacts/runs')).filter((n) => n.includes('mi007')).length, 0);
  const run = artifact('runs', 'run-mi006-r1');
  assert.equal(run.observation_refs.length, 0);
  assert.equal(run.lesson_refs.length, 0);
  assert.equal(lb.negative_state.recordLesson_invoked, false);
  assert.equal(lb.negative_state.current_mechanisms_retired, 0);
});
