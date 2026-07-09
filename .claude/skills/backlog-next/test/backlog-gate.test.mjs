import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backlogGate } from '../backlog-gate.mjs';

test('backlogGate is the runtime backlog-scoped watch gate (commit trigger, backlog scope)', () => {
  const g = backlogGate();
  assert.match(g.cmd, /run-watch\.mjs --on=commit/);
  assert.match(g.cmd, /--changed='docs\/backlog\/\*\.md'/);   // quoted glob is load-bearing
  assert.equal(g.rule, 'backlog-gate');
  assert.doesNotMatch(g.cmd, /lint\.mjs/);                    // the legacy validation arm is retired
});

test('label is present (used in the failure report)', () => {
  assert.ok(backlogGate().label.length > 0);
});
