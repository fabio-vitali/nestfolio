import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintScenario, lintScenarioFs } from '../structural-lint.mjs';

const base = { id: 'x', skill: 'backlog-add', fixture: 'f', prompt: 'p', terminal: 'completed' };
test('rejects a call-log entry that is not a stub binary', () => {
  const v = lintScenario({ ...base, callLog: { called: ['git checkout main'] } });
  assert.ok(v.some((m) => /not a stub binary/i.test(m)));
});
test('accepts call-log entries over stub binaries only', () => {
  assert.deepEqual(lintScenario({ ...base, callLog: { neverCalled: ['gh pr merge'] } }), []);
});
test('rejects a procedure step-name in any assertion', () => {
  const v = lintScenario({ ...base, rubric: ['Did it run E1 then E2?'] });
  assert.ok(v.some((m) => /procedure step-name/i.test(m)));
});
test('rejects a raw run-state schema seed (must be intent)', () => {
  const v = lintScenario({ ...base, runstate: { epic: 'x', branch: 'b', worktree: 'w', auto: false, decisions: [], e2e: null } });
  assert.ok(v.some((m) => /helper-intent/i.test(m)));
});
test('rejects an unknown top-level scenario key (typo guard)', () => {
  const v = lintScenario({ ...base, golen: {} });   // typo of `golden`
  assert.ok(v.some((m) => /unknown scenario key "golen"/i.test(m)));
});
test('rejects worker.fork on a non-backlog-next-epic scenario', () => {
  const v = lintScenario({ ...base, skill: 'backlog-add', worker: { fork: 'X' } });
  assert.ok(v.some((m) => /worker\.fork only applies to backlog-next-epic/i.test(m)));
});
test('accepts worker.{failCycles,fork} on a backlog-next-epic scenario', () => {
  const v = lintScenario({ ...base, skill: 'backlog-next-epic', terminal: 'pause', worker: { failCycles: 4, fork: 'EventX' } });
  assert.deepEqual(v, []);
});
test('rejects an unknown worker knob', () => {
  const v = lintScenario({ ...base, skill: 'backlog-next-epic', worker: { retries: 2 } });
  assert.ok(v.some((m) => /unknown worker knob "retries"/i.test(m)));
});
test('lintScenarioFs flags a missing fixture and accepts an existing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bef-lintfs-'));
  try {
    mkdirSync(join(dir, 'present'));
    assert.deepEqual(lintScenarioFs({ ...base, fixture: 'present' }, dir), []);
    assert.ok(lintScenarioFs({ ...base, fixture: 'missing' }, dir).some((m) => /does not exist/i.test(m)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
