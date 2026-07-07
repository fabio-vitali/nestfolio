import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backlogGate } from '../backlog-gate.mjs';

test('flag off → legacy backlog-lint command', () => {
  const g = backlogGate({});
  assert.match(g.cmd, /\.claude\/skills\/backlog-lint\/lint\.mjs/);
  assert.doesNotMatch(g.cmd, /run-watch/);
  assert.equal(g.rule, 'backlog-lint');
});

test('flag on → runtime backlog-scoped watch gate (commit trigger, backlog scope)', () => {
  const g = backlogGate({ RUNTIME_ENGINE: '1' });
  assert.match(g.cmd, /run-watch\.mjs --on=commit/);
  assert.match(g.cmd, /--changed='docs\/backlog\/\*\.md'/);   // quoted glob is load-bearing
  assert.equal(g.rule, 'backlog-gate');
});

test('label is present on both branches (used in the failure report)', () => {
  assert.ok(backlogGate({}).label.length > 0);
  assert.ok(backlogGate({ RUNTIME_ENGINE: '1' }).label.length > 0);
});
