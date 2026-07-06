// exclusions-root.mjs — resolves the check-exclusion sidecar directory from
// runtime/runtime.config.json (`exclusionsRoot`), making that config pointer real.
//
// Checks build their sidecar path via `exclusionsFile(name)` instead of hardcoding
// a `tools/…` literal, so all check exclusions live in one config-owned location
// (the content ring). The base path is read from the runtime config once at module
// load, resolved relative to THIS file (not process.cwd()) so a check invoked from
// any directory — or with a `--root` tmpdir in tests — still finds the real config.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { exclusionsRoot } = JSON.parse(readFileSync(join(REPO_ROOT, 'runtime', 'runtime.config.json'), 'utf8'));

/** The configured exclusions base dir, repo-relative (e.g. "runtime/content/exclusions"). */
export const EXCLUSIONS_ROOT = exclusionsRoot;

/**
 * Repo-relative path to a named check's exclusion sidecar, e.g.
 * exclusionsFile('ddb-scan') → "runtime/content/exclusions/ddb-scan-exclusions.json".
 * Callers join this with the scanned root (`--root`, default cwd), exactly as before.
 */
export function exclusionsFile(name) {
  return `${exclusionsRoot}/${name}-exclusions.json`;
}
