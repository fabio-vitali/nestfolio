#!/usr/bin/env node
// Robust Playwright launcher for nx:run-commands targets.
//
// Same rationale as tools/run-jest.mjs: nx:run-commands runs its command as a
// STRING through `/bin/sh -c`, so a forwarded `--grep` whose pattern contains
// shell metacharacters (spaces, parens, pipes) loses its quoting and the inner
// shell mis-parses it — often silently. This launcher takes the config as a
// plain argv element and reads the grep pattern from an environment variable
// (an opaque process-env string that no shell re-tokenises), then spawns
// Playwright with shell:false so the pattern arrives as a single argv element.
//
// USAGE (in project.json)
//   "node tools/run-playwright.mjs <path/to/playwright.config.ts> [extra args...]"
//
// SCOPE A RUN (safe with any regex / spaces / parens)
//   PLAYWRIGHT_GREP='Decision (accept|reject)' pnpm nx run nestfolio-e2e:e2e
//   PLAYWRIGHT_GREP_INVERT='@slow'             pnpm nx run nestfolio-e2e:e2e
//
// Both env vars are optional; absent → the full Playwright suite runs.

import { spawnSync } from 'node:child_process';

const [configPath, ...passthrough] = process.argv.slice(2);
if (!configPath) {
  console.error('run-playwright: missing playwright config path (expected as the first argument)');
  process.exit(2);
}

const args = ['exec', 'playwright', 'test', '--config', configPath, ...passthrough];
if (process.env.PLAYWRIGHT_GREP) args.push('--grep', process.env.PLAYWRIGHT_GREP);
if (process.env.PLAYWRIGHT_GREP_INVERT) args.push('--grep-invert', process.env.PLAYWRIGHT_GREP_INVERT);

const result = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env });

if (result.error) {
  console.error('run-playwright: failed to launch playwright:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
