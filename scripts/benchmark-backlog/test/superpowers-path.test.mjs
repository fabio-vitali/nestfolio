import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolveSuperpowersSkills } from '../superpowers-path.mjs';

test('env override wins over disk discovery', () => {
  assert.equal(
    resolveSuperpowersSkills({ env: { BEF_SUPERPOWERS_SKILLS: '/custom/skills' } }),
    '/custom/skills',
  );
});

test('discovers the highest installed version under ~/.claude (numeric semver sort)', () => {
  const home = '/home/u';
  const base = join(home, '.claude/plugins/cache/claude-plugins-official/superpowers');
  const got = resolveSuperpowersSkills({
    env: {},
    home,
    exists: (p) => p === base,
    readdir: (p) => (p === base ? ['6.0.3', '6.0.10', '5.9.0', 'not-a-version'] : []),
  });
  assert.equal(got, join(base, '6.0.10', 'skills')); // 6.0.10 > 6.0.3 numerically, not lexically
});

test('returns null when the plugin cache base is absent', () => {
  assert.equal(resolveSuperpowersSkills({ env: {}, home: '/h', exists: () => false }), null);
});

test('returns null when no semver-named version dirs are present', () => {
  const home = '/h';
  const base = join(home, '.claude/plugins/cache/claude-plugins-official/superpowers');
  assert.equal(
    resolveSuperpowersSkills({ env: {}, home, exists: () => true, readdir: () => ['latest', 'tmp'] }),
    null,
  );
});
