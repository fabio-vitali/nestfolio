// runtime/adapters/claude-code/test/run-next.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { driveNext } from '../run-next.mjs';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'nf-rn-'));
  const bd = join(root, 'docs', 'backlog'); mkdirSync(bd, { recursive: true });
  writeFileSync(join(bd, 'i.md'), `---\nid: i\nstatus: active\ntype: refactor\nscope: docs/**\nout_of_scope: [x]\n---\nbody\n`, 'utf8');
  const cd = join(root, 'checks'); mkdirSync(cd, { recursive: true });
  return { root, bd, cd };
}

test('RN1 doc-layer item drives to ship floor park (exit 3), records path:runtime', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const j = inMemoryJournal();
    const capabilities = { journal: j,
      execute: async () => ({ taskId: 'i', status: 'done', summary: 'done' }),
      ask: async () => ({ value: '<<HARNESS-PAUSE>>' }),   // park at ship floor
      runProcedure: async () => ({ status: 'done', findings: [] }) };
    const { exit, out } = await driveNext({ itemId: 'i', backlogDir: bd, checksDir: cd,
      capabilities, diffPaths: ['docs/backlog/i.md'], headSha: 'S1' });
    assert.equal(exit, 3);                                  // parked at ship floor
    assert.equal(out.result.status, 'paused');
    const prov = j.read('item-i').steps.get('path:runtime');
    assert.equal(prov.value.path, 'runtime');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RN2 unknown item → exit 2', async () => {
  const { root, bd, cd } = sandbox();
  try {
    const { exit } = await driveNext({ itemId: 'nope', backlogDir: bd, checksDir: cd,
      capabilities: { journal: inMemoryJournal() }, diffPaths: [], headSha: 'S1' });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('RN3 CLI --fulfil with a missing/malformed trailing value prints usage and exits 2 (no orphan journal step)', () => {
  for (const argv of [
    ['x', '--fulfil', 'k'],             // --value missing entirely (parity)
    ['x', '--fulfil', '--value', '5'],  // flag swallows flag: key would parse as '--value'
    ['x', '--fulfil', 'k', '--value'],  // trailing --value with no json
  ]) {
    const r = spawnSync('node', ['runtime/adapters/claude-code/run-next.mjs', ...argv], { encoding: 'utf8', cwd: process.cwd() });
    assert.equal(r.status, 2, `argv: ${argv.join(' ')}`);
    assert.match(r.stderr, /usage: run-next\.mjs/, `argv: ${argv.join(' ')}`);
  }
});
