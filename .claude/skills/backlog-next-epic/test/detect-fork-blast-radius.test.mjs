import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSurfaceFile,
  scanSurfaces,
  BLAST_EXIT,
  blastExitCode,
} from '../detect-fork-blast-radius.mjs';

test('isSurfaceFile matches the curated shared/exported surfaces only', () => {
  assert.equal(isSurfaceFile('libs/event-types/src/names.ts'), true);
  assert.equal(isSurfaceFile('libs/ui/src/index.ts'), true);          // shared-lib export
  assert.equal(isSurfaceFile('flows/advisory-cycle.flow.yaml'), true);
  assert.equal(isSurfaceFile('libs/cdk-constructs/src/core/egress.ts'), true);
  // NON-surfaces:
  assert.equal(isSurfaceFile('libs/ui/src/lib/button.ts'), false);    // not the index barrel
  assert.equal(isSurfaceFile('services/investor-ctrl/src/handler.ts'), false);
  assert.equal(isSurfaceFile('apps/investor-web/src/main.ts'), false);
});

test('scanSurfaces finds a literal symbol across given entries, with location', () => {
  const entries = [
    { path: 'libs/event-types/src/names.ts', content: 'export const MANDATE_ISSUED = "MandateIssued";\nother' },
    { path: 'services/x/src/h.ts', content: 'no match here' },
  ];
  const hits = scanSurfaces(['MANDATE_ISSUED'], entries);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'libs/event-types/src/names.ts');
  assert.equal(hits[0].line, 1);
  assert.equal(hits[0].pattern, 'MANDATE_ISSUED');
});

test('scanSurfaces returns [] when no pattern matches or patterns are empty', () => {
  const entries = [{ path: 'libs/event-types/src/names.ts', content: 'nothing relevant' }];
  assert.deepEqual(scanSurfaces(['ZZZ_NOPE'], entries), []);
  assert.deepEqual(scanSurfaces([], entries), []);
});

// ---------------------------------------------------------------------------
// CLI exit-code contract for the blast-radius gate.
//
// The pure helpers (isSurfaceFile / scanSurfaces) are unit-tested above. What they
// do NOT assert — and what the orchestrator's F-21 / E5 case-3 routing actually keys
// off — is the hit-count → EXIT-CODE mapping: detect-fork-blast-radius exits 0 (no
// shared hit → safe to auto-resolve), 1 (shared hit → escalate to the AskUserQuestion
// floor), or 2 (usage error). That polarity — and the specific value 1, which E5
// case-3 reads literally as "exit 1 = a shared-surface hit" — is the deterministic
// SEAM the routing reads.
//
// bef-f21-shared-typecheck-live-coverage-gap: the orchestrator's reliable EXECUTION of
// the cumulative typecheck on a shared hit is model behavior under headless `claude -p`
// with no deterministic live corpus scenario (the dropped positive twin
// bne-member-f21-shared-typecheck — the eval stub worker ships only frontmatter, so it
// never touches the seeded shared file). This suite gates the deterministic exit-code
// seam beneath that behavior — the epic's sanctioned "unit test of the orchestrator
// predicate the live corpus cannot gate". Mirrors backlog-next/detect-cli-exit-contract.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const DETECT_BLAST = resolve(HERE, '..', 'detect-fork-blast-radius.mjs');

// --- the documented codes themselves (pin the values, not just the polarity) ---

test('exit codes are the documented 0 (safe) / 1 (escalate) / 2 (usage)', () => {
  assert.equal(BLAST_EXIT.SAFE, 0);
  assert.equal(BLAST_EXIT.ESCALATE, 1);
  assert.equal(BLAST_EXIT.USAGE, 2);
});

// --- the seam: real scanSurfaces hit-count → real exit-code mapping ---

test('blast contract: no shared-surface hit maps to exit 0 (safe to auto-resolve)', () => {
  const entries = [{ path: 'libs/event-types/src/names.ts', content: 'nothing relevant' }];
  assert.equal(blastExitCode(scanSurfaces(['ZZZ_NOPE'], entries).length), BLAST_EXIT.SAFE);
});

test('blast contract: a shared-surface hit maps to exit 1 (escalate to the floor)', () => {
  const entries = [
    { path: 'libs/event-types/src/names.ts', content: 'export const MANDATE_ISSUED = "MandateIssued";' },
  ];
  assert.equal(blastExitCode(scanSurfaces(['MANDATE_ISSUED'], entries).length), BLAST_EXIT.ESCALATE);
});

test('blast contract: blastExitCode is binary 0/1 on a hit count — never the usage code 2', () => {
  assert.equal(blastExitCode(0), 0);
  assert.equal(blastExitCode(5), 1);
});

// --- CLI wiring smoke: the real script honors the contract end-to-end ---
// Proves main() routes its exits through blastExitCode + the usage guard (catches a
// regression where main() hardcodes a different code). The hit arms read the worktree
// via `git ls-files`, so the test runs in-repo; the usage arm is fully hermetic.

function exitOf(args) {
  const r = spawnSync('node', [DETECT_BLAST, ...args], { cwd: HERE, encoding: 'utf8' });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return r.status;
}

test('CLI wiring: no patterns exits 2 (usage) — hermetic, before any git call', () => {
  assert.equal(exitOf([]), BLAST_EXIT.USAGE);
});

test('CLI wiring: a guaranteed-no-match symbol exits 0 (no shared hit → safe)', () => {
  assert.equal(exitOf(['ZZ_NO_SUCH_SYMBOL_QWERTY_42']), BLAST_EXIT.SAFE);
});

test('CLI wiring: a symbol present in shared surfaces exits 1 (shared hit → escalate)', () => {
  // "export" is present in every curated TS shared surface (event-types, lib barrels,
  // cdk-constructs), so the real scan over the worktree must find ≥1 hit.
  assert.equal(exitOf(['export']), BLAST_EXIT.ESCALATE);
});
