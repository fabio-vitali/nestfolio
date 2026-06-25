import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lintScenarioFs } from '../structural-lint.mjs';

// Deferred-live-run safety net: the pure structural lint + the unit suite never touch the filesystem,
// so a scenario referencing a missing/typo'd fixture passes them and only fails at the (expensive,
// deferred) live run with an opaque cpSync ENOENT. This suite closes that gap deterministically.
const scenDir = new URL('../scenarios/', import.meta.url);
const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

test('every scenario references an existing fixture dir', async () => {
  const files = readdirSync(scenDir).filter((f) => f.endsWith('.scenario.mjs'));
  assert.ok(files.length > 0, 'expected at least one scenario file');
  for (const f of files) {
    const s = (await import(new URL(f, scenDir))).default;
    assert.deepEqual(lintScenarioFs(s, fixturesDir), [], `${f}: ${lintScenarioFs(s, fixturesDir).join('; ')}`);
  }
});
