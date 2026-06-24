import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildSandbox } from '../sandbox.mjs';

test('buildSandbox produces an isolated resumable repo with skills + stubs', async () => {
  const scenario = { id: 's', skill: 'backlog-add', fixture: 'clean', prompt: 'p', terminal: 'completed' };
  const { dir, cleanup } = await buildSandbox(scenario, 'HEAD');
  try {
    assert.ok(existsSync(join(dir, '.claude/skills/backlog-add/SKILL.md')), 'real skill copied');
    assert.ok(existsSync(join(dir, '.claude/skills/backlog-next/SKILL.md')), 'stub worker skill installed');
    assert.ok(existsSync(join(dir, 'infrastructure/scripts/deploy.sh')), 'in-repo deploy stub');
    assert.ok(existsSync(join(dir, 'node_modules/.bin/nx')), 'nx stub');
    assert.ok(existsSync(join(dir, 'docs/backlog')), 'fixture backlog');
    // resumable: a local origin exists
    const remotes = execFileSync('git', ['remote'], { cwd: dir }).toString();
    assert.match(remotes, /origin/);
  } finally { cleanup(); }
});

test('buildSandbox seeds run-state via the real helper when requested', async () => {
  const scenario = { id: 's2', skill: 'backlog-next-epic', fixture: 'epic-pr-open', prompt: 'p', terminal: 'completed', runstate: { phase: 'pr-open', pr: 7 } };
  const { dir, cleanup } = await buildSandbox(scenario, 'HEAD');
  try {
    const out = execFileSync('node', ['.claude/skills/backlog-next-epic/runstate.mjs', 'get', 'epic-pr-open'], { cwd: dir }).toString();
    assert.match(out, /PR_OPEN_AWAITING_MERGE/);
  } finally { cleanup(); }
});
