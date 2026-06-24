import { homedir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The superpowers plugin installs versioned skill dirs under the user's ~/.claude plugin cache.
const PLUGIN_REL = '.claude/plugins/cache/claude-plugins-official/superpowers';

/**
 * Resolve the superpowers `skills/` directory portably (no baked host path).
 *
 * Resolution order:
 *   1. `BEF_SUPERPOWERS_SKILLS` env override — for CI / non-default installs.
 *   2. Highest installed version under `~/.claude/<PLUGIN_REL>/<semver>/skills`.
 * Returns `null` when superpowers is not installed (callers `existsSync`-guard each skill copy,
 * so a null path simply means the e8 PR-route subskills aren't staged — the run still grades).
 *
 * Deps are injectable for unit testing (no real FS access required).
 */
export function resolveSuperpowersSkills(deps = {}) {
  const {
    env = process.env,
    home = homedir(),
    exists = existsSync,
    readdir = readdirSync,
  } = deps;

  if (env.BEF_SUPERPOWERS_SKILLS) return env.BEF_SUPERPOWERS_SKILLS;

  const base = join(home, PLUGIN_REL);
  if (!exists(base)) return null;
  const versions = readdir(base)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) return null;
  return join(base, versions[versions.length - 1], 'skills');
}
