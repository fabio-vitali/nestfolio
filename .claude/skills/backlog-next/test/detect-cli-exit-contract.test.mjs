import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyChanges,
  deployExitCode,
  DEPLOY_EXIT,
} from '../detect-deploy-needed.mjs';
import {
  classifyDerivation,
  derivationExitCode,
  DERIVATION_EXIT,
} from '../detect-doc-derivation.mjs';

// ---------------------------------------------------------------------------
// CLI exit-code contract for the closing-phase detectors.
//
// The pure classifiers (classifyChanges / classifyDerivation) and the deploy-target
// resolver are unit-tested in classify-changes / detect-deploy-resolve /
// classify-derivation. What THOSE do not assert — and what the orchestrator's
// /backlog-next closing phase actually keys off — is the boolean → EXIT-CODE
// mapping: detect-deploy-needed exits 0 (deploy needed → route to the deploy + e2e
// gate) vs 10 (skip → doc-derivation / ship close), and detect-doc-derivation exits
// 0 (regen derived docs) vs 10 (none). That polarity (and the specific value 10, not
// 1) is the deterministic SEAM the routing reads.
//
// bef-closing-detector-live-coverage-gap: the routing DECISION itself is model
// behavior under headless `claude -p` and was dropped from the live corpus as
// un-gateable; this suite gates the deterministic seam beneath it instead — the
// epic's sanctioned "unit test of the orchestrator predicate the live corpus cannot
// gate". The exit code never depends on the nx-graph resolver (its failure is caught
// and does not change the code), so the contract is gated here without git or nx.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const DETECT_DEPLOY = resolve(HERE, '..', 'detect-deploy-needed.mjs');
const DETECT_DERIVATION = resolve(HERE, '..', 'detect-doc-derivation.mjs');

const SERVICE_SRC = 'services/advisory/decision-workflow-ctrl/src/handlers/a.ts';
const DOCS_ONLY = 'docs/backlog/some-fix.md';
const allExist = () => true;

// --- the documented codes themselves (pin the values, not just the polarity) ---

test('exit codes are the documented 0 (act) / 10 (skip) — never 1, which the routing would misread', () => {
  assert.equal(DEPLOY_EXIT.NEEDED, 0);
  assert.equal(DEPLOY_EXIT.NONE, 10);
  assert.equal(DERIVATION_EXIT.NEEDED, 0);
  assert.equal(DERIVATION_EXIT.NONE, 10);
});

// --- deploy: end-to-end seam = real classifier → real exit-code mapping ---

test('deploy contract: a service src change maps to exit 0 (deploy needed → deploy + e2e gate)', () => {
  assert.equal(deployExitCode(classifyChanges([SERVICE_SRC]).deploy), 0);
});

test('deploy contract: a docs-only change maps to exit 10 (no deploy → doc-derivation / ship close)', () => {
  assert.equal(deployExitCode(classifyChanges([DOCS_ONLY]).deploy), 10);
});

test('deploy contract: an empty change set maps to exit 10 (no deploy)', () => {
  assert.equal(deployExitCode(classifyChanges([]).deploy), 10);
});

// --- derivation: end-to-end seam = real classifier → real exit-code mapping ---

test('derivation contract: a service src change maps to exit 0 (regen derived docs)', () => {
  assert.equal(
    derivationExitCode(classifyDerivation([SERVICE_SRC], { baseExists: allExist }).derivation),
    0,
  );
});

test('derivation contract: a docs-only change maps to exit 10 (no derivation)', () => {
  assert.equal(
    derivationExitCode(classifyDerivation([DOCS_ONLY], { baseExists: allExist }).derivation),
    10,
  );
});

test('derivation contract: an empty change set maps to exit 10 (no derivation)', () => {
  assert.equal(
    derivationExitCode(classifyDerivation([], { baseExists: allExist }).derivation),
    10,
  );
});

// --- CLI wiring smoke: the real scripts honor the contract end-to-end ---
// `--base=HEAD` gives an empty diff (HEAD...HEAD), which both detectors must report
// as the no-op arm → exit 10. This proves main() actually wires the boolean through
// the exit-code helper (catches a regression where main() hardcodes a different code)
// and reaches neither the nx-graph resolver nor any fixture — fully deterministic.

function exitOf(script) {
  const r = spawnSync('node', [script, '--base=HEAD'], { cwd: HERE, encoding: 'utf8' });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return r.status;
}

test('CLI wiring: detect-deploy-needed on an empty diff exits 10 (no-op → skip deploy)', () => {
  assert.equal(exitOf(DETECT_DEPLOY), 10);
});

test('CLI wiring: detect-doc-derivation on an empty diff exits 10 (no-op → no regen)', () => {
  assert.equal(exitOf(DETECT_DERIVATION), 10);
});
