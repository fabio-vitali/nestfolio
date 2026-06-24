import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKER = new URL('../stubs/_stubs/worker.mjs', import.meta.url).pathname;
function setup() {
  const d = mkdtempSync(join(tmpdir(), 'bef-w-'));
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
