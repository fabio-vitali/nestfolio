import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEnsure, planCleanup } from '../worktree-ops.mjs';

test('planEnsure: worktree already present → NOOP', () => {
  assert.equal(planEnsure({ worktreeExists: true, branchExists: true }).op, 'NOOP');
  assert.equal(planEnsure({ worktreeExists: true, branchExists: false }).op, 'NOOP');
});

test('planEnsure: branch exists, worktree gone (resume after prune) → ATTACH', () => {
  assert.equal(planEnsure({ worktreeExists: false, branchExists: true }).op, 'ATTACH');
});

test('planEnsure: neither exists (fresh run) → CREATE', () => {
  assert.equal(planEnsure({ worktreeExists: false, branchExists: false }).op, 'CREATE');
});

test('planCleanup delete-branch + merged → remove + delete + prune (Step 6.8)', () => {
  const p = planCleanup({ worktreeExists: true, branchMerged: true, mode: 'delete-branch' });
  assert.deepEqual(p, { removeWorktree: true, deleteBranch: true, prune: true, refuseReason: null });
});

test('planCleanup delete-branch + NOT merged → refuse branch delete (safety guard)', () => {
  const p = planCleanup({ worktreeExists: true, branchMerged: false, mode: 'delete-branch' });
  assert.equal(p.deleteBranch, false);
  assert.equal(p.removeWorktree, true);
  assert.match(p.refuseReason, /not merged/i);
});

test('planCleanup keep-branch never deletes, even when merged (E8.2 PR-open stop)', () => {
  const p = planCleanup({ worktreeExists: true, branchMerged: true, mode: 'keep-branch' });
  assert.equal(p.deleteBranch, false);
  assert.equal(p.removeWorktree, true);
  assert.equal(p.refuseReason, null);
});

test('planCleanup idempotent: worktree already gone → removeWorktree false (E8.4 post-tail)', () => {
  const p = planCleanup({ worktreeExists: false, branchMerged: true, mode: 'delete-branch' });
  assert.equal(p.removeWorktree, false);
  assert.equal(p.deleteBranch, true);
  assert.equal(p.prune, true);
});
