import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-states-runtime-catch.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-states-runtime-catch';
const SCRIPT = join(process.cwd(), 'tools/check-no-states-runtime-catch.mjs');

test('NSRC1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `services/x/src/${f}`).length, 0, f); });
test('NSRC2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `services/x/src/${f}`).length >= 1, f); });
test('NSRC3 CLI exits 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nsrc-'));
  try { mkdirSync(join(root, 'services/x/src'), { recursive: true }); writeFileSync(join(root, 'services/x/src/a.ts'), "errors: ['States.Runtime']", 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
