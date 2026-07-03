import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { driveItem } from '../run-item.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';
import { makeAsk } from '../ask.mjs';
import { makeExecute } from '../execute.mjs';
import { makeFanOut } from '../fan-out.mjs';
import { makeOnTrigger } from '../on-trigger.mjs';
import { makeRunProcedure } from '../run-procedure.mjs';

function tmpBacklog() {
  const root = mkdtempSync(join(tmpdir(), 'nf-drive-'));
  const dir = join(root, 'backlog'); mkdirSync(dir);
  writeFileSync(join(dir, 'probe-x.md'), '---\nid: probe-x\nstatus: active\ntype: feature\nscope: "tools/check-x.mjs"\n---\n# x\n', 'utf8');
  const checks = join(root, 'checks'); mkdirSync(checks);   // empty registry — gates trivially pass
  return { root, dir, checks };
}
function caps(j) {
  return { journal: j, ask: makeAsk({}), execute: makeExecute({}), fanOut: makeFanOut({}), onTrigger: makeOnTrigger({}), runProcedure: makeRunProcedure({}) };
}

test('DRV1 fresh drive parks execute → exit 3 + pending decision listed', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const j = inMemoryJournal();
    const { exit, out } = await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j) });
    assert.equal(exit, 3);
    assert.equal(out.pending[0].key, 'execute:probe-x');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('DRV2 --fulfil advances: execute fulfilment reaches the ship ask (parks again) then ship fulfilment completes', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const j = inMemoryJournal();
    await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j) });
    const r2 = await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j),
      fulfil: { key: 'execute:probe-x', value: { taskId: 'probe-x', status: 'done', summary: 'session did it' } } });
    assert.equal(r2.exit, 3);
    assert.equal(r2.out.pending[0].key, 'ship-probe-x');
    const r3 = await driveItem({ itemId: 'probe-x', backlogDir: dir, checksDir: checks, capabilities: caps(j),
      fulfil: { key: 'ship-probe-x', value: { decisionId: 'ship-probe-x', value: 'ship' } } });
    assert.equal(r3.exit, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('DRV3 unknown item → exit 2', async () => {
  const { root, dir, checks } = tmpBacklog();
  try {
    const { exit } = await driveItem({ itemId: 'nope', backlogDir: dir, checksDir: checks, capabilities: caps(inMemoryJournal()) });
    assert.equal(exit, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('DRV4 CLI --fulfil with a missing/malformed trailing value prints usage and exits 2 (no crash)', () => {
  const r = spawnSync('node', ['runtime/adapters/claude-code/run-item.mjs', 'x', '--fulfil', 'k'], { encoding: 'utf8', cwd: process.cwd() });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: run-item\.mjs/);
});
