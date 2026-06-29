import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideResume, RESUME_ACTIONS } from '../resume-gate.mjs';

const present = (state) => ({ kind: 'present', state });

test('absent run-state → FRESH', () => {
  assert.equal(decideResume({ runState: { kind: 'absent' } }).action, 'FRESH');
  assert.equal(decideResume({}).action, 'FRESH'); // undefined runState defaults to FRESH
});

test('present run-state, no e8 → RESUME (re-enter member loop)', () => {
  assert.equal(decideResume({ runState: present({ branch: 'feat/epic-x' }) }).action, 'RESUME');
});

test('e8 set + PR MERGED → POST_MERGE_TAIL', () => {
  const runState = present({ branch: 'feat/epic-x', e8: 'PR_OPEN_AWAITING_MERGE' });
  assert.equal(decideResume({ runState, prState: 'MERGED' }).action, 'POST_MERGE_TAIL');
});

test('e8 set + PR OPEN → PR_STILL_OPEN (re-print, stop)', () => {
  const runState = present({ branch: 'feat/epic-x', e8: 'PR_OPEN_AWAITING_MERGE' });
  assert.equal(decideResume({ runState, prState: 'OPEN' }).action, 'PR_STILL_OPEN');
});

test('e8 set + PR state unknown/absent → PR_STILL_OPEN (safe: never auto-tail unconfirmed)', () => {
  const runState = present({ branch: 'feat/epic-x', e8: 'PR_OPEN_AWAITING_MERGE' });
  assert.equal(decideResume({ runState }).action, 'PR_STILL_OPEN');
  assert.equal(decideResume({ runState, prState: 'CLOSED' }).action, 'PR_STILL_OPEN');
});

test('malformed run-state → ERROR with clean message (F-11/F-13)', () => {
  const r = decideResume({ runState: { kind: 'malformed', error: 'bad json at line 3' } });
  assert.equal(r.action, 'ERROR');
  assert.match(r.reason, /bad json/);
});

test('RESUME_ACTIONS lists exactly the five actions', () => {
  assert.deepEqual([...RESUME_ACTIONS].sort(), ['ERROR', 'FRESH', 'POST_MERGE_TAIL', 'PR_STILL_OPEN', 'RESUME'].sort());
});
