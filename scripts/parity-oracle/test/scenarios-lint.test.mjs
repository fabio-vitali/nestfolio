// scripts/parity-oracle/test/scenarios-lint.test.mjs — every rt scenario passes the extended
// structural lint, and the scenario dir matches the mapping exactly (both directions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { lintRtScenario } from '../structural-lint.mjs';
import { MAPPING, mappedIds } from '../mapping.mjs';

const scenDir = new URL('../scenarios/', import.meta.url);

test('every mapped entry has its rt scenario file, and vice versa', () => {
  const files = readdirSync(scenDir).filter((f) => f.endsWith('.scenario.mjs')).sort();
  const expected = mappedIds().map((id) => MAPPING[id].runtime.scenario).sort();
  assert.deepEqual(files, expected);
});

test('every rt scenario passes structural lint + references a real fixture', async () => {
  const rtFixturesDir = fileURLToPath(new URL('../fixtures/rt/', import.meta.url));
  const befFixturesDir = fileURLToPath(new URL('../../benchmark-backlog/fixtures/', import.meta.url));
  for (const f of readdirSync(scenDir).filter((x) => x.endsWith('.scenario.mjs'))) {
    const s = (await import(new URL(f, scenDir))).default;
    assert.deepEqual(lintRtScenario(s), [], f);
    assert.ok(s.id.startsWith('rt-'), `${f}: id must be rt-*`);
    assert.ok(s.prompt.includes('node runtime/adapters/claude-code/'), `${f}: prompt must drive a runtime driver`);
    const fixtureDir = s.rtFixture ? join(rtFixturesDir, s.rtFixture) : join(befFixturesDir, s.fixture);
    assert.ok(existsSync(fixtureDir), `${f}: fixture dir missing: ${fixtureDir}`);
  }
});

test('hollow-green guard: every rt scenario asserts the runtime path drove it', async () => {
  for (const f of readdirSync(scenDir).filter((x) => x.endsWith('.scenario.mjs'))) {
    const s = (await import(new URL(f, scenDir))).default;
    assert.ok((s.journal ?? []).some((j) => j.path === 'runtime'),
      `${f}: must declare a { path: 'runtime' } journal spec — else a mapped scenario could pass without the runtime path driving it`);
  }
});

test('rt fixtures pass ItemSchema (readItems fail-closed would otherwise crash the driver)', async () => {
  const { readItems } = await import('../../../runtime/engine/lib/scope-gate.mjs');
  const rtFixturesDir = fileURLToPath(new URL('../fixtures/rt/', import.meta.url));
  for (const fx of readdirSync(rtFixturesDir)) {
    assert.ok(readItems(join(rtFixturesDir, fx, 'backlog')).length >= 1, fx);
  }
});
