import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-unsafe-casts.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-unsafe-casts';
const SCRIPT = join(process.cwd(), 'tools/check-no-unsafe-casts.mjs');

test('NUC1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `libs/x/src/${f}`).length, 0, f); });
test('NUC2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `libs/x/src/${f}`).length >= 1, f); });
test('NUC3 test/ files are ignored (casts allowed in tests)', () => { assert.equal(findViolations('x as any', 'libs/x/test/a.ts').length, 0); });
test('NUC4 CLI exits 1 on a bad src tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nuc-'));
  try { mkdirSync(join(root, 'libs/x/src'), { recursive: true }); writeFileSync(join(root, 'libs/x/src/a.ts'), 'const z = a as any;', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
