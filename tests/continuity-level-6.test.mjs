// MI-006-R1 Level 6 (Assurance — Evidence-bound completion & Guard coexistence)
// binding validation — deterministic, repository-bound. Verifies
// continuity/level-6/completion-binding.json and engine-lock.json against the
// actual repository state and the target artifacts the pinned engine produced:
// the rev 2->3->4->5 Work Item advancement, the completed run-mi006-r1, the three
// criterion Evidence artifacts across distinct modes, the classified Guard, the
// truthful backlog write-back, the four corrected published assertions' semantics,
// and the explicit absence of any MI-007 Decision-and-Learning state.
// No network, no mutation, no Skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, digestJson } from '../runtime/continuity/lib/utils.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const fileSha = (p) => sha256(readFileSync(join(root, p)));

const cb = readJson('continuity/level-6/completion-binding.json');
const el = readJson('continuity/level-6/engine-lock.json');
const WORK_PATH = 'continuity/artifacts/work-items/dashboard-bff-awaiting-confirmation-activity-gap.json';
const RECORDED = 'b656733991c96c4275d11e9a9f2bff7f5ac72cdd298cbc68a4b94b6799dc742d';

test('engine-lock: 20 engine assets and aggregate match the working tree', () => {
  assert.equal(el.artifact, 'continuity.level-6.engine-lock');
  assert.equal(el.engine_file_count, 20);
  assert.equal(el.engine_files.length, 20);
  for (const e of el.engine_files) {
    const bytes = readFileSync(join(root, e.path));
    assert.equal(sha256(bytes), e.sha256, `engine asset digest mismatch: ${e.path}`);
    assert.equal(bytes.length, e.size, `engine asset size mismatch: ${e.path}`);
  }
  assert.equal(el.aggregate_engine_digest, digestJson(el.engine_files));
  assert.equal(el.aggregate_engine_digest, '7e31ff56a10ca6b1715b29f02132e66c80e321921b41dcb55329db2e0f320a38');
  assert.equal(el.engine_modification_permitted, false);
});

test('engine-lock: settings.json and hook registration match', () => {
  assert.equal(fileSha('.claude/settings.json'), el.settings_json.sha256);
  const settings = readJson('.claude/settings.json');
  const reg = { SessionStart: settings.hooks?.SessionStart ?? null, SessionEnd: settings.hooks?.SessionEnd ?? null };
  assert.equal(digestJson(reg), el.hook_registration.digest);
  assert.equal(el.hook_registration.digest, '73387f347f43d0f6a154f83ed54c3bdaee0e0b6ba6dbf3120ebf5b8c28834378');
});

test('completion-binding: bound digests match the working tree', () => {
  assert.equal(cb.artifact, 'continuity.level-6.completion-binding');
  assert.equal(cb.iteration, 'MI-006-R1');
  assert.equal(cb.bound_digests.context_pack_v1, fileSha('continuity/level-4/context-pack.json'));
  assert.equal(cb.bound_digests.context_pack_v1, 'e58c9bc1978d6799cccda96c2520ea1f7f41ab8b88e8a055ff968cd7b8ce15c1');
  assert.equal(cb.bound_digests.level_3_scope, fileSha('continuity/level-3/scope.json'));
  assert.equal(cb.bound_digests.level_2_aggregate, readJson('continuity/level-2/activation.json').activeLock.aggregateDigest);
  assert.equal(cb.bound_digests.effort_source, RECORDED);
});

test('work-item advancement: rev 2 base -> rev 5 completed via the three contracted transitions', () => {
  const wi = readJson(WORK_PATH);
  assert.equal(cb.target_work_item.store_path, WORK_PATH);
  assert.equal(cb.target_work_item.revision_2_base_sha256, '313af5905dbb3fda35dc9c193502df667812f0044c91f6c3b3691d136313aa60');
  const adv = cb.target_work_item.advancement;
  assert.equal(adv.length, 3);
  assert.deepEqual(adv.map((a) => a.revision), [3, 4, 5]);
  assert.deepEqual(adv.map((a) => a.transition), ['rebinding-write', 'engine-startRun', 'engine-completeRun']);
  assert.equal(wi.revision, 5);
  assert.equal(wi.status, 'completed');
  assert.equal(wi.digest, adv[2].envelope_digest);
  assert.equal(fileSha(WORK_PATH), adv[2].file_sha256);
  // source unchanged from the immutable MI-005 base (completeRun verified it).
  assert.equal(wi.source.sha256, RECORDED);
  // every completion criterion passed with linked Evidence.
  assert.equal(wi.completion_criteria.length, 3);
  for (const c of wi.completion_criteria) assert.equal(c.status, 'passed', c.id);
  assert.equal(wi.evidence_refs.length, 3);
  assert.equal(wi.completed_run_refs[0].id, 'run-mi006-r1');
  // guards reference exactly the classified Guard.
  assert.equal(wi.guards.length, 1);
  assert.equal(wi.guards[0].id, 'nestfolio-dashboard-bff-no-dead-user-confirmation-requested-handler');
});

test('run-mi006-r1: completed, three passing validation results and Evidence, final Checkpoint', () => {
  const run = readJson('continuity/artifacts/runs/run-mi006-r1.json');
  assert.equal(run.status, 'completed');
  assert.equal(run.validation_result_refs.length, 3);
  assert.equal(run.evidence_refs.length, 3);
  const head = readJson('.continuity/runs/run-mi006-r1/head.json');
  assert.equal(head.status, 'completed');
  assert.ok(head.latest_checkpoint_id.startsWith('run-mi006-r1-final-'));
  for (const ref of run.evidence_refs) {
    const ev = readJson(`continuity/artifacts/evidence/${ref.id}.json`);
    assert.equal(ev.status, 'accepted');
    assert.equal(ev.run_id, 'run-mi006-r1');
  }
});

test('criterion matrix: three criteria span distinct deterministic, agent-review, and human-review modes', () => {
  const ids = cb.criterion_matrix.map((c) => c.id);
  assert.deepEqual(ids, ['mi006r1-c1-investigation', 'mi006r1-c2-cdc-sourcing', 'mi006r1-c3-non-regression']);
  const modeUnion = new Set(cb.criterion_matrix.flatMap((c) => c.modes));
  for (const mode of ['deterministic', 'agent-review', 'human-review']) assert.ok(modeUnion.has(mode), `mode present: ${mode}`);
  // c1 review record carries the human-review authorization marker.
  const review = readFileSync(join(root, 'continuity/level-6/criterion-1-investigation-review.json'), 'utf8');
  assert.ok(review.includes('"mode": "human-review-authorization"'));
  assert.ok(review.includes('Autorizzo il finding'));
});

test('guard classification: one target Guard, evaluated true, referenced; suites are validators; no auto-mint', () => {
  const guard = readJson(cb.guard_classification.classified_guard.binding_path);
  assert.equal(guard.id, 'nestfolio-dashboard-bff-no-dead-user-confirmation-requested-handler');
  assert.equal(guard.evaluation_mode, 'deterministic');
  assert.equal(guard.severity, 'blocking');
  assert.equal(cb.guard_classification.classified_guard.evaluation, 'true');
  assert.equal(cb.guard_classification.no_auto_guard_minting, true);
  assert.equal(fileSha(cb.guard_classification.classified_guard.binding_path), cb.guard_classification.classified_guard.definition_sha256);
});

test('backlog write-back is truthful and completion-aware corrected suites are anchored', () => {
  const backlog = 'docs/backlog/dashboard-bff-awaiting-confirmation-activity-gap.md';
  assert.equal(cb.backlog_writeback.path, backlog);
  assert.equal(cb.backlog_writeback.before_sha256, RECORDED);
  const committed = sha256(execFileSync('git', ['-C', root, 'show', `${cb.bound_repository_revision}:${backlog}`]));
  assert.equal(cb.backlog_writeback.before_sha256, committed);
  assert.equal(cb.backlog_writeback.after_sha256, fileSha(backlog));
  assert.notEqual(cb.backlog_writeback.before_sha256, cb.backlog_writeback.after_sha256);
  assert.match(readFileSync(join(root, backlog), 'utf8'), /^status: shipped$/m);
  assert.deepEqual(cb.published_suite_correction.corrected_paths.sort(), ['tests/continuity-level-4.test.mjs', 'tests/continuity-level-5.test.mjs']);
  assert.equal(cb.published_suite_correction.corrected_assertions.length, 4);
});

test('non-regression: integration files byte-identical; no non-comment dead handler', () => {
  assert.equal(fileSha('services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts'), 'aa7c11fc1e975deecb8cd5329a2c831aef5dd36e2374473831141f2d1999fc50');
  assert.equal(fileSha('services/investor/dashboard-bff/test/integration/read-model-projection.integration.test.ts'), 'bad65ddec03bffb7fdf78031e42d8fc69c53a3cdccee63024f990e3664b2f8e8');
  const code = execFileSync('node', ['continuity/level-6/checks/criterion-3-non-regression-check.mjs'], { cwd: root });
  assert.match(code.toString('utf8'), /"result":"pass"/);
});

test('no MI-007 state: no Observation or Lesson artifact for run-mi006-r1; run-mi005 untouched', () => {
  const run = readJson('continuity/artifacts/runs/run-mi006-r1.json');
  assert.equal(run.observation_refs.length, 0);
  assert.equal(run.lesson_refs.length, 0);
  assert.match(cb.no_mi007_state, /No Observation/);
  // run-mi005 remains byte-identical (spot check the run and its head).
  assert.equal(fileSha('continuity/artifacts/runs/run-mi005.json'), '86717732a73fdd80bb2071dfca742ee79b08ba8361547423891aa14520c5e0be');
  assert.equal(fileSha('.continuity/runs/run-mi005/head.json'), 'ea8488d19f3db2142839104b729afa382aae0bf8cd1a3b9fdba839c629211513');
});
