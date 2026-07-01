import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findViolations } from './check-no-ddb-scan.mjs';

const FX = 'runtime/eval/scenarios/fixtures/no-ddb-scan';
const SCRIPT = join(process.cwd(), 'tools/check-no-ddb-scan.mjs');

test('NDS1 golden gate: every GOOD fixture → 0 violations', () => {
  for (const f of readdirSync(`${FX}/good`)) assert.equal(findViolations(readFileSync(`${FX}/good/${f}`, 'utf8'), `services/x/src/${f}`).length, 0, f);
});
test('NDS2 golden gate: every BAD fixture → ≥1 violation', () => {
  for (const f of readdirSync(`${FX}/bad`)) assert.ok(findViolations(readFileSync(`${FX}/bad/${f}`, 'utf8'), `services/x/src/${f}`).length >= 1, f);
});
test('NDS3 files outside /src/ are ignored', () => {
  assert.equal(findViolations('new ScanCommand({})', 'services/x/test/a.ts').length, 0);
});
test('NDS4 CLI exits 1 and names the token on a bad tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nds-'));
  try {
    mkdirSync(join(root, 'services/x/src'), { recursive: true });
    writeFileSync(join(root, 'services/x/src/a.ts'), 'new ScanCommand({})', 'utf8');
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /ScanCommand/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('NDS5 CLI exits 0 on a clean tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-nds-'));
  try {
    mkdirSync(join(root, 'services/x/src'), { recursive: true });
    writeFileSync(join(root, 'services/x/src/a.ts'), 'new QueryCommand({ KeyConditionExpression: "x" })', 'utf8');
    assert.equal(spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' }).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
