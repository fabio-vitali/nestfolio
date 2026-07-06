import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeArgs } from '../runner.mjs';

const opts = { model: 'claude-opus-4-8', pauseConvention: 'PC' };

test('buildClaudeArgs: no denySubskills → no --disallowedTools, but --allowedTools present', () => {
  const args = buildClaudeArgs({ prompt: '/backlog-next x' }, opts);
  assert.ok(args.includes('--allowedTools'), 'allowedTools always set');
  assert.ok(!args.includes('--disallowedTools'), 'no deny flag when field absent');
});

test('buildClaudeArgs: denySubskills → --disallowedTools with the space-joined Skill() patterns', () => {
  const deny = ['Skill(superpowers:finishing-a-development-branch)', 'Skill(backlog-next)'];
  const args = buildClaudeArgs({ prompt: '/backlog-next-epic e', denySubskills: deny }, opts);
  const i = args.indexOf('--disallowedTools');
  assert.ok(i >= 0, 'deny flag present');
  assert.equal(args[i + 1], deny.join(' '), 'entries passed verbatim as one space-joined arg');
});

test('buildClaudeArgs: empty denySubskills array → no flag (no vacuous --disallowedTools)', () => {
  const args = buildClaudeArgs({ prompt: 'p', denySubskills: [] }, opts);
  assert.ok(!args.includes('--disallowedTools'));
});

test('buildClaudeArgs honors a custom read-only allowedTools list', () => {
  const args = buildClaudeArgs(
    { prompt: 'p' },
    { model: 'claude-opus-4-8', pauseConvention: 'n/a', allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'Skill'] },
  );
  const i = args.indexOf('--allowedTools');
  assert.ok(i >= 0, '--allowedTools present');
  assert.equal(args[i + 1], 'Bash Read Glob Grep Skill');
  assert.ok(!args[i + 1].includes('Write'), 'Write denied');
  assert.ok(!args[i + 1].includes('Edit'), 'Edit denied');
});

test('buildClaudeArgs default allowedTools is unchanged (back-compat)', () => {
  const args = buildClaudeArgs({ prompt: 'p' }, { model: 'm', pauseConvention: 'n/a' });
  const i = args.indexOf('--allowedTools');
  assert.equal(args[i + 1], 'Bash Read Write Edit Glob Grep Skill');
});
