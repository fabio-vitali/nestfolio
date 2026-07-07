import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const skillMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'SKILL.md'), 'utf8');

test('SKILL.md documents the RUNTIME_ENGINE runtime-engine intake branch', () => {
  assert.match(skillMd, /RUNTIME_ENGINE/);
  assert.match(skillMd, /run-intake\.mjs --finding/);
  assert.match(skillMd, /path:legacy-fallback/); // hard-cutover semantics documented
});

test('SKILL.md retains the legacy prose router (kept byte-for-byte until P6)', () => {
  assert.match(skillMd, /The hot-path router/);
  assert.match(skillMd, /closure-predicate test/);
});
