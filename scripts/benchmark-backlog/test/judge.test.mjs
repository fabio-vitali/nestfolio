import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildJudgePrompt, outcomeDiff, parseJudgeResult } from '../judge.mjs';

// Minimal stand-in for a bef sandbox: root repo on main with a pristine origin/main ref.
function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'bef-judge-'));
  const g = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-b', 'main');
  g('config', 'user.email', 'bef@test'); g('config', 'user.name', 'bef');
  writeFileSync(join(root, 'a.txt'), 'base\n');
  g('add', '.'); g('commit', '-m', 'base');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, g };
}

test('buildJudgePrompt includes each rubric question', () => {
  const p = buildJudgePrompt({ rubric: ['Q1?', 'Q2?'] }, { result: 'r' }, 'diff');
  assert.match(p, /Q1\?/); assert.match(p, /Q2\?/);
});
test('parseJudgeResult extracts the JSON scores block', () => {
  const r = parseJudgeResult('blah\n```json\n{"scores":{"Q1?":4},"costUsd":0}\n```\n');
  assert.equal(r.scores['Q1?'], 4);
});
test('parseJudgeResult falls back to a bare {…} object when there is no fence', () => {
  const r = parseJudgeResult('Sure! {"scores":{"Q1?":5},"costUsd":0} hope that helps');
  assert.equal(r.scores['Q1?'], 5);
});
test('parseJudgeResult throws when there is no json at all (caller retries, never aborts)', () => {
  assert.throws(() => parseJudgeResult('I cannot grade this.'), /no json block/);
});
test('outcomeDiff sees a ship committed on a worker-created sub-worktree branch (root HEAD stays on main)', () => {
  const { root, g } = makeSandbox();
  const wt = join(root, '.claude', 'worktrees', 'epic-x');
  g('worktree', 'add', '-b', 'feat/epic-x', wt);
  writeFileSync(join(wt, 'shipped.txt'), 'the outcome\n');
  execFileSync('git', ['-C', wt, 'add', '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['-C', wt, 'commit', '-m', 'ship'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const diff = outcomeDiff(root);
  assert.match(diff, /shipped\.txt/);
  assert.match(diff, /the outcome/);
});
test('outcomeDiff still prefers the root branch delta when the branch is checked out at the root', () => {
  const { root, g } = makeSandbox();
  g('checkout', '-b', 'feat/epic-root');
  writeFileSync(join(root, 'root-ship.txt'), 'root outcome\n');
  g('add', '.'); g('commit', '-m', 'root ship');
  assert.match(outcomeDiff(root), /root-ship\.txt/);
});
test('outcomeDiff returns empty for a pristine sandbox without leaking a HEAD~1 fatal to stderr', () => {
  const { root } = makeSandbox();
  assert.equal(outcomeDiff(root).trim(), '');
});
