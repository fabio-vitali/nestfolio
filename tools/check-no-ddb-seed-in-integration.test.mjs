import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-ddb-seed-in-integration.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-ddb-seed-in-integration';
const SCRIPT = join(process.cwd(), 'tools/check-no-ddb-seed-in-integration.mjs');
const rel = (f) => `services/x/x-ctrl/test/integration/${f}`;

test('NDS-SEED1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), rel(f)).length, 0, f); });
test('NDS-SEED2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), rel(f)).length >= 1, f); });
test('NDS-SEED3 files outside test/integration are ignored', () => { assert.equal(findViolations('new DdbSeedFixture()', 'services/x/x-ctrl/src/a.ts').length, 0); });
test('NDS-SEED4 CLI exits 1 on a seeded integration tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-seed-'));
  try { mkdirSync(join(root, 'services/x/x-ctrl/test/integration'), { recursive: true }); writeFileSync(join(root, 'services/x/x-ctrl/test/integration/a.ts'), 'new DdbSeedFixture("t")', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
