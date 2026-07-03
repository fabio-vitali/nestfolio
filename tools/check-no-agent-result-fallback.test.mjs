import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-agent-result-fallback.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-agent-result-fallback';
const SCRIPT = join(process.cwd(), 'tools/check-no-agent-result-fallback.mjs');

test('NARF1 GOOD → 0', () => { for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `services/advisory/x/src/${f}`).length, 0, f); });
test('NARF2 BAD → ≥1', () => { for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `services/advisory/x/src/${f}`).length >= 1, f); });
test('NARF3 an excluded path is skipped', () => { assert.equal(findViolations('x ?? {}', 'services/advisory/x/src/ok.ts', new Set(['services/advisory/x/src/ok.ts'])).length, 0); });
test('NARF4 CLI exits 1 on a bad advisory tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-narf-'));
  try { mkdirSync(join(root, 'services/advisory/x/src'), { recursive: true }); writeFileSync(join(root, 'services/advisory/x/src/a.ts'), 'const y = agentResult.userGoals ?? {};', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
