import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConflicts } from '../pr-conflict-resolve.mjs';

test('docs/BACKLOG.md → REGEN_VIA_LINT (the auto-index, never hand-resolved)', () => {
  assert.deepEqual(classifyConflicts(['docs/BACKLOG.md']), [{ path: 'docs/BACKLOG.md', action: 'REGEN_VIA_LINT' }]);
});

test('epic + member files → TAKE_BRANCH_SIDE (branch carries shipped frontmatter — F-25)', () => {
  const out = classifyConflicts(['docs/backlog/epic-x.md', 'docs/backlog/member-y.md']);
  assert.deepEqual(out, [
    { path: 'docs/backlog/epic-x.md', action: 'TAKE_BRANCH_SIDE' },
    { path: 'docs/backlog/member-y.md', action: 'TAKE_BRANCH_SIDE' },
  ]);
});

test('mixed: index regen + frontmatter take-branch-side, in input order', () => {
  const out = classifyConflicts(['docs/BACKLOG.md', 'docs/backlog/epic-x.md']);
  assert.deepEqual(out.map((e) => e.action), ['REGEN_VIA_LINT', 'TAKE_BRANCH_SIDE']);
});

test('a non-backlog conflict → UNKNOWN (escalate, not auto-resolvable)', () => {
  assert.deepEqual(classifyConflicts(['src/foo.ts']), [{ path: 'src/foo.ts', action: 'UNKNOWN' }]);
});

test('no conflicts → []', () => {
  assert.deepEqual(classifyConflicts([]), []);
});
