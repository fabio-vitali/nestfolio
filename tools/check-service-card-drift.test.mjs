// node:test sibling for check-service-card-drift.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseExclusions, isExcluded, SECTION_IDS,
} from './check-service-card-drift.mjs';

const SCRIPT = join(process.cwd(), 'tools/check-service-card-drift.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-carddrift-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}
function withTree(files, fn) {
  const root = makeTree(files);
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('parseExclusions: whole-service and per-section', () => {
  withTree({
    'tools/service-card-exclusions.json': JSON.stringify({ exclusions: [
      { service: 'investor-web', reason: 'frontend stack — no event constructs' },
      { service: 'foo-ctrl', section: 'ddb-entities', reason: 'internal-only rows' },
    ]}),
  }, (root) => {
    const { exclusions } = parseExclusions(root);
    assert.ok(isExcluded(exclusions, 'investor-web', 'ingress'));
    assert.ok(isExcluded(exclusions, 'foo-ctrl', 'ddb-entities'));
    assert.ok(!isExcluded(exclusions, 'foo-ctrl', 'ingress'));
  });
});

test('parseExclusions: absent file → empty', () => {
  withTree({}, (root) => {
    const { exclusions, entries } = parseExclusions(root);
    assert.equal(exclusions.size, 0);
    assert.deepEqual(entries, []);
  });
});

test('parseExclusions: bad section rejected', () => {
  withTree({
    'tools/service-card-exclusions.json': JSON.stringify({ exclusions: [
      { service: 'x', section: 'not-a-section', reason: 'y' },
    ]}),
  }, (root) => {
    assert.throws(() => parseExclusions(root), /bad entry/);
  });
});
