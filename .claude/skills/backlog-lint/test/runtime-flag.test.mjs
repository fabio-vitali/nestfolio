import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md'), 'utf8');

test('SKILL.md documents the RUNTIME_ENGINE runtime-gate validation path', () => {
  assert.match(skillMd, /RUNTIME_ENGINE/);
  // match the distinctive scope+trigger; avoid the run-watch vs run-watch.mjs prefix ambiguity
  assert.match(skillMd, /--on=commit --changed='docs\/backlog\/\*\.md'/);
});

test('SKILL.md still documents the legacy 11-rule lint (retained until P6)', () => {
  assert.match(skillMd, /11 rules/);
});
