import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKER = new URL('../stubs/_stubs/worker.mjs', import.meta.url).pathname;
// Track every throwaway dir and rm them after the suite so the tests don't pile up bef-* dirs in $TMPDIR.
const tmpDirs = [];
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'bef-w-')); tmpDirs.push(d);
  writeFileSync(join(d, 'm1.md'), '---\nid: m1\nstatus: active\nepic: e\nepic_role: core\n---\n# M1\n');
  return d;
}
test('worker ships the member + logs to stubs.log', () => {
  const d = setup();
  execFileSync('node', [WORKER, 'm1'], { cwd: d });
  assert.match(readFileSync(join(d, 'm1.md'), 'utf8'), /status: shipped/);
  assert.match(readFileSync(join(d, 'stubs.log'), 'utf8'), /backlog-next-worker m1/);
});
test('worker honors --fail-cycles=2 (fails twice, ships on 3rd)', () => {
  const d = setup();
  let failed = 0;
  for (let i = 0; i < 3; i++) {
    try { execFileSync('node', [WORKER, 'm1', '--fail-cycles=2'], { cwd: d }); }
    catch { failed++; }
  }
  assert.equal(failed, 2);
  assert.match(readFileSync(join(d, 'm1.md'), 'utf8'), /status: shipped/);
});
test('worker honors BEF_WORKER_FAIL_CYCLES from env', () => {
  const d = setup();
  let failed = 0;
  for (let i = 0; i < 2; i++) {
    try { execFileSync('node', [WORKER, 'm1'], { cwd: d, env: { ...process.env, BEF_WORKER_FAIL_CYCLES: '1' } }); }
    catch { failed++; }
  }
  assert.equal(failed, 1);
  assert.match(readFileSync(join(d, 'm1.md'), 'utf8'), /status: shipped/);
});
test('worker surfaces an in-member fork (env BEF_WORKER_FORK) without shipping', () => {
  const d = setup();
  const out = execFileSync('node', [WORKER, 'm1'], { cwd: d, env: { ...process.env, BEF_WORKER_FORK: 'EventNameX' } }).toString();
  assert.match(out, /<<MEMBER-FORK: symbol=EventNameX>>/);
  assert.match(readFileSync(join(d, 'm1.md'), 'utf8'), /status: active/);   // NOT shipped — orchestrator must decide
  assert.match(readFileSync(join(d, 'stubs.log'), 'utf8'), /backlog-next-worker m1/);   // loop still entered
});
