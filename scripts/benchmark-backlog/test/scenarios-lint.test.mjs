import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { lintScenario } from '../structural-lint.mjs';

const dir = new URL('../scenarios/', import.meta.url);
test('every scenario passes the structural lint', async () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.scenario.mjs'))) {
    const s = (await import(new URL(f, dir))).default;
    assert.deepEqual(lintScenario(s), [], `${f}: ${lintScenario(s).join('; ')}`);
  }
});
