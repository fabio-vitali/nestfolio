import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMemberOutput } from '../member-summary.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FK = 'a'.repeat(64);
const fence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';
const SUMMARY = { kind: 'member-summary', member: 'm1', lane: 'simple', status: 'shipped', validation_gate: 'integ ok', commits: ['abc f'], decisions: [] };
const NEEDS = { kind: 'needs-decision', member: 'm1', reason: 'floor:scope', question: 'q?', options: [{ label: 'A', description: 'a', recommended: true }], fork_key: FK };

test('extracts the LAST kind-bearing fenced block; earlier example fences are narrative', () => {
  const text = `Here is an example I considered:\n${fence({ kind: 'member-summary', note: 'EXAMPLE' })}\nFinal:\n${fence(SUMMARY)}`;
  const r = parseMemberOutput(text);
  assert.equal(r.kind, 'member-summary');
  assert.equal(r.status, 'shipped');
});

test('needs-decision validates and requires fork_key', () => {
  assert.equal(parseMemberOutput(fence(NEEDS)).kind, 'needs-decision');
  const { fork_key, ...noKey } = NEEDS;
  assert.throws(() => parseMemberOutput(fence(noKey)), /fork_key/);
});

test('blocked WITHOUT blocked_reason is still valid (defaulted), not a parse failure', () => {
  const blocked = { kind: 'member-summary', member: 'm1', lane: 'simple', status: 'blocked', validation_gate: 'n/a', commits: [], decisions: [] };
  const r = parseMemberOutput(fence(blocked));
  assert.equal(r.status, 'blocked');
  assert.equal(r.blocked_reason, 'unspecified');
});

test('decision entries require fork_key', () => {
  const bad = { ...SUMMARY, decisions: [{ decision: 'd', options: ['x'], chosen: 'x', rationale: 'r', rejected: 'y' }] };
  assert.throws(() => parseMemberOutput(fence(bad)), /fork_key/);
});

test('no kind-bearing block, malformed JSON, and two different operative kinds all throw with a code', () => {
  assert.equal(catchCode(() => parseMemberOutput('no payload here')), 'none');
  assert.equal(catchCode(() => parseMemberOutput('```json\n{ not valid\n```')), 'malformed');
  const ambiguous = `${fence(SUMMARY)}\n${fence(NEEDS)}`; // two DIFFERENT kinds, both operative-looking
  assert.equal(catchCode(() => parseMemberOutput(ambiguous)), 'ambiguous');
});

test('unknown keys are rejected (closed schema)', () => {
  assert.throws(() => parseMemberOutput(fence({ ...SUMMARY, surprise: 1 })), /unknown/);
});

function catchCode(fn) { try { fn(); return null; } catch (e) { return e.code; } }

test('CLI exit codes 0/1/2/3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-'));
  // execFileSync throws on a non-zero exit; capture e.status. stdio ignored to keep test output clean.
  const statusOf = (text) => {
    const f = join(dir, 'p.txt');
    writeFileSync(f, text);
    try {
      execFileSync('node', ['.claude/skills/backlog-next-epic/member-summary.mjs', 'parse', f], { stdio: 'ignore' });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(statusOf(`${fence(SUMMARY)}`), 1); // shipped => exit 1
  assert.equal(statusOf(fence({ ...SUMMARY, status: 'blocked' })), 2); // blocked => exit 2
  assert.equal(statusOf(fence(NEEDS)), 0); // needs-decision => exit 0
  assert.equal(statusOf('garbage'), 3); // parse-failure => exit 3
});
