// node:test sibling for build-prod-manifest.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'tools/scripts/build-prod-manifest.mjs');

function run(out) {
  return spawnSync('node', [SCRIPT, '--out', out], { encoding: 'utf8' });
}

test('emits a manifest with /mfe/<key>/remoteEntry.json for every catalog entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-prod-manifest-'));
  const out = join(dir, 'federation.manifest.json');
  try {
    const r = run(out);
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
    const manifest = JSON.parse(readFileSync(out, 'utf8'));

    // The 5 expected entries (matching MFE_CATALOG keys + the -mfe suffix)
    const expected = {
      'investor-mfe':   '/mfe/investor/remoteEntry.json',
      'advisory-mfe':   '/mfe/advisory/remoteEntry.json',
      'ledger-mfe':     '/mfe/ledger/remoteEntry.json',
      'dashboard-mfe':  '/mfe/dashboard/remoteEntry.json',
      'onboarding-mfe': '/mfe/onboarding/remoteEntry.json',
    };
    assert.deepEqual(manifest, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exit 2 when --out is missing', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out/);
});

test('output is stable JSON (deterministic key order, single trailing newline)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nf-prod-manifest-'));
  const a = join(dir, 'a.json');
  const b = join(dir, 'b.json');
  try {
    run(a);
    run(b);
    assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
    const text = readFileSync(a, 'utf8');
    assert.ok(text.endsWith('\n'), 'manifest should end with a single newline');
    // Two-space indent (matches the dev manifest committed to the repo)
    assert.match(text, /^\{\n {2}"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
