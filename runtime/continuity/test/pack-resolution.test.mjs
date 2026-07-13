import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePacks, verifyPackLock } from '../lib/pack-resolver.mjs';
import { createFixture } from './test-fixture.mjs';

test('Pack resolution locks reusable and Nestfolio-specific Claude Code assets', () => {
  const root = createFixture();
  const lock = resolvePacks(root, [
    'checkpoint',
    'fresh-session-resume',
    'nestfolio-backlog-read',
    'nestfolio-validation',
  ]);
  assert.equal(lock.packs.length, 2);
  assert.equal(lock.procedures.length, 2);
  assert.equal(lock.procedures.every((procedure) => procedure.executor === 'claude-code'), true);
  assert.equal(verifyPackLock(root, lock), true);
});

test('missing or mismatched Skill assets fail closed', () => {
  const root = createFixture();
  const lock = resolvePacks(root, ['checkpoint']);
  const asset = join(root, '.claude/skills/continuity-resumable-work/SKILL.md');
  appendFileSync(asset, '\nmutated\n');
  assert.throws(
    () => verifyPackLock(root, lock),
    (error) => error.code === 'SKILL_ASSET_MISMATCH',
  );

  const rootMissing = createFixture();
  const missingLock = resolvePacks(rootMissing, ['checkpoint']);
  rmSync(join(rootMissing, '.claude/skills/continuity-resumable-work/SKILL.md'));
  assert.throws(
    () => verifyPackLock(rootMissing, missingLock),
    (error) => error.code === 'MISSING_ASSET',
  );
});
