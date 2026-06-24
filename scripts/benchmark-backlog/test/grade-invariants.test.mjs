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
test('terminal mismatch fails', () => {
  const r = gradeInvariants({ terminal: 'pause' }, { terminalKind: 'completed' }, repo(), '');
  assert.ok(r.failures.some((f) => /terminal/i.test(f)));
});
