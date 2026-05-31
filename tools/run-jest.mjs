#!/usr/bin/env node
// Robust jest launcher for nx:run-commands targets.
//
// WHY THIS EXISTS
// ---------------
// `nx:run-commands` builds a shell command STRING and runs it via `/bin/sh -c`.
// Any forwarded arg that contains shell metacharacters loses its quoting on the
// way through. The classic case is scoping a run:
//
//     pnpm nx run e2e-feature-tests:test-e2e-features -- \
//       --testPathPatterns 'advisory/(accept-decision|reject-decision)'
//
// nx re-joins the args without quotes, the inner `/bin/sh` then parses `(a|b)`
// as a SUBSHELL, fails with `syntax error`, and jest never runs — yet nx still
// reports exit 0. A false green: a "PASS" with zero tests actually executed.
//
// THE FIX
// -------
// This launcher takes the jest config as a plain argv element (no special
// chars) and reads the SCOPING pattern from environment variables. Env values
// travel as opaque process-env strings and are never re-tokenised by a shell,
// so any regex — parens, pipes, spaces — is safe. We then spawn jest with
// `shell: false`, passing the pattern as a single argv element.
//
// USAGE (in project.json)
// -----------------------
//   "command": "node tools/run-jest.mjs <path/to/jest.config.js> [extra jest args...]"
//
// SCOPE A RUN (safe with any regex / spaces / parens)
// ---------------------------------------------------
//   JEST_PATH='advisory/(accept-decision|reject-decision)' \
//     pnpm nx run e2e-feature-tests:test-e2e-features
//   JEST_NAME='rejects the decision' \
//     pnpm nx run advisory-bff:test-integration
//
// Both env vars are optional and compose; absent → the full suite runs.

import { spawnSync } from 'node:child_process';

const [configPath, ...passthrough] = process.argv.slice(2);
if (!configPath) {
  console.error('run-jest: missing jest config path (expected as the first argument)');
  process.exit(2);
}

const args = ['exec', 'jest', '--config', configPath, ...passthrough];
// jest 30+: the path filter is `--testPathPatterns` (plural); name filter is `--testNamePattern`.
if (process.env.JEST_PATH) args.push('--testPathPatterns', process.env.JEST_PATH);
if (process.env.JEST_NAME) args.push('--testNamePattern', process.env.JEST_NAME);

// Jest's ESM transform needs node's VM-modules flag at process launch; ensure it
// is present for the child without duplicating it if the caller already set it.
const existing = process.env.NODE_OPTIONS ?? '';
const NODE_OPTIONS = existing.includes('--experimental-vm-modules')
  ? existing
  : `${existing} --experimental-vm-modules`.trim();

const result = spawnSync('pnpm', args, {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS },
});

if (result.error) {
  console.error('run-jest: failed to launch jest:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
