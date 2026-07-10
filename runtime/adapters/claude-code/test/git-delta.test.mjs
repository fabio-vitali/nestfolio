// runtime/adapters/claude-code/test/git-delta.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchDelta } from '../git-delta.mjs';

test('GD1 diffs HEAD vs the merge-base of `base` (three-dot), splitting non-empty paths', () => {
  let cmd;
  const paths = branchDelta('origin/main', (c) => { cmd = c; return 'runtime/a.mjs\ndocs/b.md\n'; });
  assert.equal(cmd, 'git diff --name-only origin/main...HEAD');
  assert.deepEqual(paths, ['runtime/a.mjs', 'docs/b.md']);   // trailing blank line dropped
});

test('GD2 returns [] on git failure (caller decides broad vs narrow — the helper never guesses)', () => {
  assert.deepEqual(branchDelta('origin/main', () => { throw new Error('not a git repo'); }), []);
});
