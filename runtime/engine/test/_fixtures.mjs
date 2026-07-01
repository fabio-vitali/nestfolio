// Shared test helpers: a canonical valid CheckEntry + tmpdir plumbing. Not ring-1 surface.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';

/** A minimal VALID deterministic active check; override any field. */
export function validCheck(overrides = {}) {
  return {
    id: 'sample-check',
    property: 'a single consistency property holds',
    kind: 'inconsistency',
    evaluator: { type: 'deterministic', run: 'cmd:node tools/check-sample.mjs' },
    cost_tier: 'cheap',
    contexts: ['gate'],
    scope: { paths: ['services/**/*.ts'] },
    status: 'active',
    provenance: { minted_by: 'sample-item', ratified: '2026-07-01' },
    ...overrides,
  };
}

/** Run `fn(rootDir)` inside a fresh tmpdir, always cleaned up. */
export function withTmpDir(fn) {
  const root = mkdtempSync(join(tmpdir(), 'nf-runtime-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Write a check object as `<id>.yaml` under `dir` (creating dir). */
export function writeYaml(dir, id, obj) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.yaml`), stringify(obj), 'utf8');
}
