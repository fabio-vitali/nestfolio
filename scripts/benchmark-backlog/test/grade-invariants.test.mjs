import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeInvariants } from '../grade.mjs';

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'bef-i-')); execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--allow-empty', '-q', '-m', 'x'], { cwd: d });
  return d;
}
test('neverCalled passes when the binary is absent from stubs.log', () => {
  const r = gradeInvariants({ callLog: { neverCalled: ['gh pr merge'] } }, {}, repo(), 'gh pr create x\ndeploy.sh y\n');
  assert.equal(r.pass, true, r.failures.join('; '));
});
test('neverCalled fails when present', () => {
  const r = gradeInvariants({ callLog: { neverCalled: ['gh pr merge'] } }, {}, repo(), 'gh pr merge 7\n');
  assert.equal(r.pass, false);
});
test('state.branchAbsent passes when branch does not exist', () => {
  const r = gradeInvariants({ state: { branchAbsent: 'feat/epic-x' } }, {}, repo(), '');
  assert.equal(r.pass, true);
});
test('state.branchCreated reflects whether a non-main branch exists (Complex-adoption proxy)', () => {
  const d = mkdtempSync(join(tmpdir(), 'bef-i-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
  execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '--allow-empty', '-q', '-m', 'x'], { cwd: d });
  // only `main` → no isolation branch → branchCreated:true must FAIL, branchCreated:false passes
  assert.equal(gradeInvariants({ state: { branchCreated: true } }, {}, d, '').pass, false);
  assert.equal(gradeInvariants({ state: { branchCreated: false } }, {}, d, '').pass, true);
  // an isolation branch (any non-main name) → Complex adoption → branchCreated:true passes
  execFileSync('git', ['branch', 'worktree-standalone-complex'], { cwd: d });
  assert.equal(gradeInvariants({ state: { branchCreated: true } }, {}, d, '').pass, true);
});
test('terminal mismatch fails', () => {
  const r = gradeInvariants({ terminal: 'pause' }, { terminalKind: 'completed' }, repo(), '');
  assert.ok(r.failures.some((f) => /terminal/i.test(f)));
});
