import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md'), 'utf8');

test('SKILL.md documents the runtime-gate validation path', () => {
  // the distinctive scope+trigger; avoid the run-watch vs run-watch.mjs prefix ambiguity
  assert.match(skillMd, /--on=commit --changed='docs\/backlog\/\*\.md'/);
});

test('SKILL.md keeps the 11-rule engine + --fix regen side-car', () => {
  assert.match(skillMd, /11 rules/);
  assert.match(skillMd, /lint\.mjs --fix/);
});

test('the retired RUNTIME_ENGINE strangler flag is gone from the SKILL', () => {
  assert.doesNotMatch(skillMd, /RUNTIME_ENGINE/);
  assert.doesNotMatch(skillMd, /until P6/);
});
