// .claude/skills/backlog-next/test/next-driver.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDriver } from '../next-driver.mjs';

test('ND1 flag on → runtime driver', () => {
  assert.deepEqual(nextDriver({ RUNTIME_ENGINE: '1' }), { cmd: 'node runtime/adapters/claude-code/run-next.mjs', mode: 'runtime' });
});
test('ND2 flag off → legacy', () => {
  assert.deepEqual(nextDriver({}), { cmd: null, mode: 'legacy' });
});
