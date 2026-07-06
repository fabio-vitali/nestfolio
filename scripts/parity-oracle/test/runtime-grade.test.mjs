// scripts/parity-oracle/test/runtime-grade.test.mjs — the 4th grading layer: journal invariants
// (has / awaiting / absent) read from the sandbox's git-common journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gradeJournal } from '../runtime-grade.mjs';
import { makeJournal } from '../../../runtime/engine/lib/journal.mjs';

function sandboxWithJournal() {
  const dir = mkdtempSync(join(tmpdir(), 'po-grade-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const j = makeJournal({ root: join(dir, '.git') });
  j.begin('item-x', { runId: 'item-x', auto: false });
  j.record('item-x', 'gate.start', { passed: true, findings: [] });
  // options must be well-formed (min 1 {label,value}) — a malformed decision record is DROPPED on read
  j.awaiting('item-x', 'ship-x', { id: 'ship-x', question: 'Ship?', options: [{ label: 'Ship', value: 'ship' }] });
  return dir;
}

test('has / awaiting / absent journal assertions', () => {
  const dir = sandboxWithJournal();
  const ok = gradeJournal({ journal: [
    { runId: 'item-x', has: 'gate.start' },
    { runId: 'item-x', awaiting: 'ship-x' },
    { runId: 'item-x', absent: 'gate.ship' },
  ] }, dir);
  assert.deepEqual(ok, { pass: true, failures: [] });

  const bad = gradeJournal({ journal: [
    { runId: 'item-x', has: 'gate.ship' },          // never recorded
    { runId: 'item-x', absent: 'gate.start' },       // recorded → violation
    { runId: 'missing-run', has: 'anything' },       // FRESH ledger
  ] }, dir);
  assert.equal(bad.pass, false);
  assert.equal(bad.failures.length, 3);
});

test('no journal spec → vacuous pass', () => {
  assert.deepEqual(gradeJournal({}, '/nonexistent'), { pass: true, failures: [] });
});
