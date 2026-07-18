// MI-005 Level 5 binding validation — deterministic, repository-bound.
// Verifies continuity/level-5/engine-lock.json and run-binding.json against the
// actual repository state: engine asset digests, the pinned bound-revision
// digests (Context Pack v1, Level 3 scope, Level 2 aggregate, effort source),
// the read-only route-check result, and the explicit Level-5-only closure and
// absent-Level-6 declarations. No network, no mutation, no Skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, digestJson } from '../runtime/continuity/lib/utils.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const fileSha = (p) => sha256(readFileSync(join(root, p)));

const engineLock = readJson('continuity/level-5/engine-lock.json');
const runBinding = readJson('continuity/level-5/run-binding.json');

test('engine-lock: every recorded engine asset digest matches the working tree', () => {
  assert.equal(engineLock.bound_revision, '363283bcc97b1e04710db0e7f759ffffddb18b69');
  assert.ok(engineLock.engine_files.length >= 20);
  for (const entry of engineLock.engine_files) {
    const bytes = readFileSync(join(root, entry.path));
    assert.equal(sha256(bytes), entry.sha256, `engine asset digest mismatch: ${entry.path}`);
    assert.equal(bytes.length, entry.size, `engine asset size mismatch: ${entry.path}`);
  }
  assert.equal(engineLock.aggregate_engine_digest, digestJson(engineLock.engine_files));
});

test('engine-lock: .claude/settings.json and hook registration match', () => {
  assert.equal(fileSha('.claude/settings.json'), engineLock.settings_json.sha256);
  const settings = readJson('.claude/settings.json');
  const reg = { SessionStart: settings.hooks?.SessionStart ?? null, SessionEnd: settings.hooks?.SessionEnd ?? null };
  assert.equal(digestJson(reg), engineLock.hook_registration.digest);
  assert.equal(engineLock.engine_modification_permitted, false);
});

test('run-binding: bound Context Pack v1 digests match Level 4 artifacts', () => {
  assert.equal(runBinding.bound_context_pack.context_pack_sha256, fileSha('continuity/level-4/context-pack.json'));
  assert.equal(runBinding.bound_context_pack.context_pack_sha256, 'e58c9bc1978d6799cccda96c2520ea1f7f41ab8b88e8a055ff968cd7b8ce15c1');
  assert.equal(runBinding.bound_context_pack.authorization_record_sha256, fileSha('continuity/level-4/authorization-record.json'));
  assert.equal(runBinding.bound_context_pack.adapter_view_sha256, fileSha('continuity/level-4/adapter-view.json'));
  assert.equal(runBinding.bound_context_pack.formation_trace_sha256, fileSha('continuity/level-4/formation-trace.json'));
  assert.equal(runBinding.bound_context_pack.version, 1);
});

test('run-binding: bound Level 3 scope and Level 2 aggregate match', () => {
  assert.equal(runBinding.bound_level_3_scope.scope_sha256, fileSha('continuity/level-3/scope.json'));
  assert.equal(runBinding.bound_level_3_scope.scope_sha256, 'db7a45278e8f4a270552e3ae1db3695b70e07d1624b27bcdc28f6417883a5ad6');
  const activation = readJson('continuity/level-2/activation.json');
  const aggregate = activation.activeLock.aggregateDigest;
  assert.equal(runBinding.bound_level_2_lock.aggregate_sha256, aggregate);
  assert.equal(runBinding.bound_level_2_lock.aggregate_sha256, '73bbb7c9199a79e00208115f1f7ba469be7e42e1bd20d1d72bfc726ac048df26');
});

test('run-binding: bound effort source is byte-identical to the recorded digest', () => {
  assert.equal(runBinding.target_route.effort_identity, 'dashboard-bff-awaiting-confirmation-activity-gap');
  // MI-006-R1 completion-aware correction (published_suite_correction): verify the
  // recorded digest against the bound-revision COMMITTED backlog bytes (permanent
  // historical truth); when the working tree has advanced past the Evidence-bound
  // completion write-back, additionally require the recorded transition in the
  // Level 6 completion-binding.
  {
    const committed = sha256(execFileSync('git', ['-C', root, 'show', `${runBinding.bound_repository_revision}:docs/backlog/dashboard-bff-awaiting-confirmation-activity-gap.md`]));
    assert.equal(runBinding.target_route.effort_source_sha256, committed);
    const current = fileSha('docs/backlog/dashboard-bff-awaiting-confirmation-activity-gap.md');
    if (current !== runBinding.target_route.effort_source_sha256) {
      const cb = readJson('continuity/level-6/completion-binding.json');
      assert.equal(cb.backlog_writeback.before_sha256, runBinding.target_route.effort_source_sha256);
      assert.equal(cb.backlog_writeback.after_sha256, current);
    }
  }
  assert.equal(runBinding.target_route.effort_source_sha256, 'b656733991c96c4275d11e9a9f2bff7f5ac72cdd298cbc68a4b94b6799dc742d');
  assert.equal(runBinding.bound_repository_revision, '363283bcc97b1e04710db0e7f759ffffddb18b69');
});

test('run-binding: read-only route check records no dual Run for the effort', () => {
  const rc = runBinding.cutover_and_drain.route_check;
  assert.equal(rc.active_current_run_for_effort, false);
  assert.equal(rc.existing_target_run_for_effort, false);
  assert.equal(rc.result, 'clear');
  assert.equal(typeof rc.journal_tree_digest, 'string');
  assert.ok(rc.journal_tree_digest.length === 64);
});

test('run-binding: closure is Level-5 operational only with Level 6 absent', () => {
  assert.equal(runBinding.closure_policy.kind, 'level-5-operational-only');
  assert.equal(runBinding.closure_policy.work_item_completed, false);
  assert.equal(runBinding.closure_policy.backlog_status_change, false);
  assert.equal(runBinding.closure_policy.evidence_bound_completion, false);
  assert.match(runBinding.level_6_guarantees, /^ABSENT/);
  assert.equal(runBinding.effect_key_policy.sole_material_effect.key, 'mi005-material-effect');
  assert.equal(runBinding.run_id, 'run-mi005');
});
