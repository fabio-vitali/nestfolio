import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNSTATE_KEYS,
  E8_MARKER,
  runStatePath,
  initRunState,
  validateRunState,
  parseRunState,
  appendDecision,
  setE2e,
  e2eIsFresh,
  serializeRunState,
} from '../runstate.mjs';

const fresh = () => initRunState({ epic: 'e', branch: 'feat/epic-e', worktree: '.claude/worktrees/epic-e' });

test('initRunState: closed 6-key shape, decisions empty, e2e null', () => {
  const s = fresh();
  assert.deepEqual(Object.keys(s).sort(), [...RUNSTATE_KEYS].sort());
  assert.deepEqual(s.decisions, []);
  assert.equal(s.e2e, null);
  assert.equal(s.auto, false);
});

// F-13: path is built from the ABSOLUTE common-dir form, identical regardless of cwd.
test('runStatePath uses --path-format=absolute --git-common-dir', () => {
  let seen = null;
  const exec = (cmd) => { seen = cmd; return '/abs/repo/.git\n'; };
  const p = runStatePath('my-epic', exec);
  assert.equal(seen, 'git rev-parse --path-format=absolute --git-common-dir');
  assert.equal(p, '/abs/repo/.git/backlog-next-epic-my-epic.json');
});

// F-12: closed schema rejects invented keys (the real drift: paused_at / wsN_decisions).
test('validateRunState rejects unknown keys (paused_at, per-member decision arrays)', () => {
  assert.throws(() => validateRunState({ ...fresh(), paused_at: 'x' }), /unknown run-state key "paused_at"/);
  assert.throws(() => validateRunState({ ...fresh(), ws3_decisions: [] }), /unknown run-state key "ws3_decisions"/);
});

test('validateRunState requires all 6 keys and correct types', () => {
  const { e2e, ...missing } = fresh();
  assert.throws(() => validateRunState(missing), /missing required run-state key "e2e"/);
  assert.throws(() => validateRunState({ ...fresh(), auto: 'yes' }), /auto must be a boolean/);
  assert.throws(() => validateRunState({ ...fresh(), decisions: {} }), /decisions must be an array/);
});

test('validateRunState accepts the optional e8 marker only with its one sanctioned value', () => {
  assert.doesNotThrow(() => validateRunState({ ...fresh(), e8: E8_MARKER }));
  assert.throws(() => validateRunState({ ...fresh(), e8: 'WHATEVER' }), /must be "PR_OPEN_AWAITING_MERGE"/);
});

// F-11: a malformed file self-heals to a clean error, never a raw throw at a resume.
test('parseRunState self-heals malformed JSON (no throw, clean error)', () => {
  const res = parseRunState('{ "epic": "e",\n  ,\n  "paused_at":');   // the exact F-11 corruption shape
  assert.equal(res.ok, false);
  assert.match(res.error, /malformed JSON/);
});

test('parseRunState surfaces schema violations as a clean error too', () => {
  const res = parseRunState(JSON.stringify({ ...fresh(), bogus: 1 }));
  assert.equal(res.ok, false);
  assert.match(res.error, /unknown run-state key "bogus"/);
});

test('parseRunState ok on a valid serialized state round-trip', () => {
  const res = parseRunState(serializeRunState(fresh()));
  assert.equal(res.ok, true);
  assert.equal(res.state.epic, 'e');
});

// F-12: every decision lands in the ONE decisions[], tagged by member, append-only.
test('appendDecision appends to the single decisions[] and requires member', () => {
  let s = fresh();
  s = appendDecision(s, { member: 'm1', decision: 'd', chosen: 'a' });
  s = appendDecision(s, { member: 'm2', decision: 'd2', chosen: 'b' });
  assert.equal(s.decisions.length, 2);
  assert.deepEqual(s.decisions.map((d) => d.member), ['m1', 'm2']);
  assert.throws(() => appendDecision(s, { decision: 'no member' }), /decision\.member/);
});

test('appendDecision is append-only: prior entries are preserved verbatim', () => {
  const first = { member: 'm1', decision: 'original', chosen: 'a' };
  let s = appendDecision(fresh(), first);
  s = appendDecision(s, { member: 'm1', decision: 'reversal of #0', chosen: 'b' });
  assert.deepEqual(s.decisions[0], first);   // never mutated
});

// F-14: e2e evidence is pinned to a sha and goes stale when HEAD moves (re-opened member).
test('setE2e stores the evidence; e2eIsFresh only matches the recorded sha', () => {
  const s = setE2e(fresh(), { commands: ['jest', 'pw'], outcome: 'green', sha: 'abc123' });
  assert.equal(s.e2e.outcome, 'green');
  assert.equal(e2eIsFresh(s, 'abc123'), true);
  assert.equal(e2eIsFresh(s, 'def456'), false);     // HEAD moved → stale → must re-run E6
  assert.equal(e2eIsFresh(fresh(), 'abc123'), false); // no evidence → not fresh
});

test('serializeRunState is pretty-printed with a trailing newline and validates first', () => {
  const out = serializeRunState(fresh());
  assert.ok(out.endsWith('\n'));
  assert.ok(out.includes('\n  "epic"'));
  assert.throws(() => serializeRunState({ ...fresh(), nope: 1 }), /unknown run-state key/);
});
