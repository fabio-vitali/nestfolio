import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VALID_LANES as PRE_LANES,
  skipsBranchScopeChecks,
} from '../preflight.mjs';
import {
  VALID_LANES as POST_LANES,
  runsComplexChecks,
} from '../postflight.mjs';

test('preflight: epic-member is a recognized lane', () => {
  assert.ok(PRE_LANES.includes('epic-member'));
  assert.deepEqual(PRE_LANES, ['doc-layer', 'simple', 'complex', 'epic-member']);
});

test('preflight: only epic-member skips branch-scope checks', () => {
  assert.equal(skipsBranchScopeChecks('epic-member'), true);
  // standard lanes (and no lane) keep the full preflight (on-main, main-ahead, stale-worktrees, snapshot).
  assert.equal(skipsBranchScopeChecks(undefined), false);
  assert.equal(skipsBranchScopeChecks('doc-layer'), false);
  assert.equal(skipsBranchScopeChecks('simple'), false);
  assert.equal(skipsBranchScopeChecks('complex'), false);
});

test('postflight: epic-member is a recognized lane', () => {
  assert.ok(POST_LANES.includes('epic-member'));
  assert.deepEqual(POST_LANES, ['doc-layer', 'simple', 'complex', 'epic-member']);
});

test('postflight: only complex runs the complex-only checks 4-7', () => {
  assert.equal(runsComplexChecks('complex'), true);
  // epic-member defers merge/sync/branch-delete/stale-worktree checks to the epic close.
  assert.equal(runsComplexChecks('epic-member'), false);
  assert.equal(runsComplexChecks('doc-layer'), false);
  assert.equal(runsComplexChecks('simple'), false);
});
