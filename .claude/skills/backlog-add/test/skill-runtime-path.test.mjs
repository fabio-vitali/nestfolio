import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md'), 'utf8');

test('SKILL.md drives intake through the runtime intake driver', () => {
  assert.match(skillMd, /run-intake\.mjs --finding/);
});

test('SKILL.md keeps the routing reference (router + closure-predicate + templates)', () => {
  assert.match(skillMd, /The hot-path router/);
  assert.match(skillMd, /closure-predicate test/);
});

test('the retired RUNTIME_ENGINE strangler flag is gone from the SKILL', () => {
  assert.doesNotMatch(skillMd, /RUNTIME_ENGINE/);
  assert.doesNotMatch(skillMd, /path:legacy-fallback/);
  assert.doesNotMatch(skillMd, /until P6/);
});
