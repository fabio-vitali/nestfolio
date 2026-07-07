// .claude/skills/backlog-next-epic/test/epic-driver.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epicDriver } from '../epic-driver.mjs';

test('flag on → routes to run-epic.mjs', () => {
  assert.deepEqual(epicDriver({ RUNTIME_ENGINE: '1' }),
    { cmd: 'node runtime/adapters/claude-code/run-epic.mjs', mode: 'runtime' });
});

test('flag off → legacy (cmd null)', () => {
  assert.deepEqual(epicDriver({}), { cmd: null, mode: 'legacy' });
});
