import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUNSTATE_KEYS,
  E8_MARKER,
  E2E_FRESH_EXIT,
  runStatePath,
  initRunState,
  validateRunState,
  parseRunState,
  setE2e,
  e2eIsFresh,
  freshExitCode,
  serializeRunState,
} from '../runstate.mjs';

const fresh = () => initRunState({ epic: 'e', branch: 'feat/epic-e', worktree: '.claude/worktrees/epic-e' });

test('initRunState: closed 5-key shape, e2e null', () => {
  const s = fresh();
  assert.deepEqual(Object.keys(s).sort(), [...RUNSTATE_KEYS].sort());
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

test('validateRunState requires all 5 keys and correct types', () => {
  const { e2e, ...missing } = fresh();
  assert.throws(() => validateRunState(missing), /missing required run-state key "e2e"/);
  assert.throws(() => validateRunState({ ...fresh(), auto: 'yes' }), /auto must be a boolean/);
});

// The decision log moved to the committed workstream files (decision-log.mjs). A legacy
// run-state still carrying decisions[] must be rejected loudly, not silently accepted.
test('validateRunState rejects the legacy decisions key', () => {
  assert.throws(() => validateRunState({ ...fresh(), decisions: [] }), /unknown run-state key "decisions"/);
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

// ---------------------------------------------------------------------------
// CLI exit-code contract for the `e2e-fresh` freshness gate (E7.2 / F-14).
//
// The pure predicate e2eIsFresh is unit-tested above. What it does NOT assert — and
// what the orchestrator's E7.2 ship-precondition actually keys off — is the freshness
// → EXIT-CODE mapping of `node runstate.mjs e2e-fresh <epic-id>`: exit 0 (recorded
// green still matches HEAD → safe to ship) vs exit 1 (HEAD moved since the recorded
// green → a re-opened/reworked member, force a return to E6 before ship). That exit
// code is the deterministic SEAM the orchestrator reads.
//
// bne-e71-chained-gate-unit-coverage: the chained-second-gate invariant (after a
// captured-promote rework moves HEAD, the batched gate must re-run before ship) is NOT
// deterministically coverable as a live corpus scenario — its premise is the E7.1
// audit's model judgment and "the gate ran twice" is uncountable by the substring
// callLog teeth. This suite gates the deterministic exit-code seam beneath that
// behavior — the epic's sanctioned "unit test of the orchestrator predicate the live
// corpus cannot gate". Mirrors the shipped bef-closing-detector / bef-f21-shared-
// typecheck detect-CLI-exit-contract pattern.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNSTATE = resolve(HERE, '..', 'runstate.mjs');

// --- the documented codes themselves (pin the values + polarity, not just behavior) ---

test('e2e-fresh exit codes are the documented 0 (fresh) / 1 (stale)', () => {
  assert.equal(E2E_FRESH_EXIT.FRESH, 0);
  assert.equal(E2E_FRESH_EXIT.STALE, 1);
});

// --- the seam: real freshness verdict → real exit-code mapping ---

test('freshExitCode maps the chained-gate freshness verdict to the e2e-fresh exit code', () => {
  const recorded = setE2e(fresh(), { commands: ['jest', 'pw'], outcome: 'green', sha: 'A' });
  // (a) recorded green pinned at SHA-A, HEAD still A → fresh → exit 0 (safe to ship)
  assert.equal(freshExitCode(e2eIsFresh(recorded, 'A')), E2E_FRESH_EXIT.FRESH);
  // (b)+(c) HEAD moved to B (a re-opened/reworked member) → stale → exit 1 (re-run E6)
  assert.equal(freshExitCode(e2eIsFresh(recorded, 'B')), E2E_FRESH_EXIT.STALE);
  // no recorded evidence at all → not fresh → exit 1 (never ship on an unproduced gate)
  assert.equal(freshExitCode(e2eIsFresh(fresh(), 'A')), E2E_FRESH_EXIT.STALE);
});

test('freshExitCode is binary 0/1 on the boolean verdict', () => {
  assert.equal(freshExitCode(true), E2E_FRESH_EXIT.FRESH);
  assert.equal(freshExitCode(false), E2E_FRESH_EXIT.STALE);
});

// --- CLI wiring smoke: the real script honors the contract end-to-end, against a REAL
// HEAD move. Proves main()'s e2e-fresh case routes its exit through freshExitCode +
// e2eIsFresh + `git rev-parse HEAD` (catches a regression where main() hardcodes a
// different code or stops reading HEAD). Fully hermetic: a throwaway git repo whose
// own HEAD is the thing that moves — the literal member scenario "(a) record at SHA-A,
// (b) move HEAD, (c) assert stale". ---

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function runstate(cwd, args, input) {
  const r = spawnSync('node', [RUNSTATE, ...args], { cwd, encoding: 'utf8', input });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return r;
}

function freshRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'e2e-fresh-cli-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@nestfolio.dev']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'm0']);
  return repo;
}

test('CLI e2e-fresh: FRESH (exit 0) at the recorded SHA, STALE (exit 1) after HEAD moves', () => {
  const repo = freshRepo();
  try {
    const shaA = git(repo, ['rev-parse', 'HEAD']);
    // init run-state + record an e2e green pinned to SHA-A (the recorded batched-gate pass)
    assert.equal(runstate(repo, ['init', 'epic-x', '--branch=feat/epic-epic-x', '--worktree=w']).status, 0);
    assert.equal(
      runstate(repo, ['set-e2e', 'epic-x'],
        JSON.stringify({ commands: ['jest', 'pw'], outcome: 'green', sha: shaA })).status,
      0,
    );

    // (a) recorded at SHA-A, HEAD === SHA-A → FRESH (exit 0): safe to ship
    assert.equal(runstate(repo, ['e2e-fresh', 'epic-x']).status, E2E_FRESH_EXIT.FRESH);

    // (b) move HEAD — simulate the E7.1 audit promoting + reworking a captured member
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'm1 (member reworked)']);

    // (c) recorded green is now stale → STALE (exit 1): the chained second gate must re-run E6
    const stale = runstate(repo, ['e2e-fresh', 'epic-x']);
    assert.equal(stale.status, E2E_FRESH_EXIT.STALE);
    assert.match(stale.stderr, /e2e STALE/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI e2e-fresh: absent run-state exits 3 (never a false-fresh on a missing gate)', () => {
  const repo = freshRepo();
  try {
    // no run-state written → loadOrExit must report absent (exit 3), NOT a freshness verdict
    assert.equal(runstate(repo, ['e2e-fresh', 'never-inited']).status, 3);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
