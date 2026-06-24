import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintScenario } from '../structural-lint.mjs';

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
