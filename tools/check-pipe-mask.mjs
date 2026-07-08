#!/usr/bin/env node
// check-pipe-mask.mjs — deterministic evaluator for no-pipe-exit-masking (minted from
// feedback_pipe_masks_exit_code): a shell script that pipes into tee/tail without pipefail/PIPESTATUS
// reports the LAST stage's exit code, masking the real command's failure. Honors RUNTIME_STAGED_PATHS
// (diff-scoped gate); falls back to the git-tracked script roots. Exit 0 clean / 1 findings.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Staged input is filtered to the check's declared scope — cmd evaluators receive the WHOLE staged
// set (attribution drift, redteam-hardening #8), so the tool must self-scope like the other minted
// evaluators, or its own eval fixtures would flag at the gate.
const inScopeSh = (f) => f.endsWith('.sh') && /^(scripts|infrastructure\/scripts)\//.test(f);
// JS gate/tooling sources that COMPOSE shell commands (execSync/spawnSync/sh seams): a pipeline inside
// the command string runs under /bin/sh with no pipefail, so the last stage masks upstream crashes —
// the deploy-gate-runner false-green class (2026-07-08). Any pipeline counts, not just tee/tail: in a
// gate command every stage's exit matters. Tests + eval fixtures are excluded (bad examples live there).
const inScopeJs = (f) => /\.m?js$/.test(f) && /^(runtime|tools|scripts|\.claude\/skills)\//.test(f)
  && !/(^|\/)(test|tests|fixtures)\/|\.test\.m?js$/.test(f);
const JS_SH_STRING_PIPELINE = /(execSync|spawnSync|\bsh|\bshOut)\s*\(\s*[`'"][^`'"]*\s\|\s/;

/** Pure predicate (golden-gate seam, mirrors the sibling text-scan checks): a script that pipes into
 *  tee/tail without pipefail/PIPESTATUS masks the real command's exit code; a JS-composed shell command
 *  string with an unguarded pipeline does the same. Out-of-scope paths → []. */
export function findViolations(text, relPath) {
  const guarded = /pipefail|PIPESTATUS/.test(text);
  if (inScopeSh(relPath)) {
    const pipesToMasker = /\|\s*(tee|tail)\b/.test(text);
    return pipesToMasker && !guarded ? [{ rule: 'pipe-exit-masking', relPath }] : [];
  }
  if (inScopeJs(relPath)) {
    return JS_SH_STRING_PIPELINE.test(text) && !guarded ? [{ rule: 'pipe-exit-masking', relPath }] : [];
  }
  return [];
}

function main() {
  const staged = process.env.RUNTIME_STAGED_PATHS?.split('\n').filter(Boolean);
  const inScope = (f) => inScopeSh(f) || inScopeJs(f);
  const files = staged
    ? staged.filter(inScope)
    : execSync("git ls-files 'scripts/*.sh' 'scripts/**/*.sh' 'infrastructure/scripts/*.sh' 'infrastructure/scripts/**/*.sh' 'runtime/*.mjs' 'runtime/**/*.mjs' 'tools/*.mjs' 'tools/**/*.mjs' 'scripts/*.mjs' 'scripts/**/*.mjs' '.claude/skills/*.mjs' '.claude/skills/**/*.mjs'", { encoding: 'utf8' }).split('\n').filter(Boolean).filter(inScope);

  const violations = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    violations.push(...findViolations(text, f));
  }
  if (violations.length) {
    for (const v of violations) console.error(`pipe-exit-masking: ${v.relPath} pipes into tee/tail without pipefail/PIPESTATUS`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
