#!/usr/bin/env node
// check-pipe-mask.mjs — deterministic evaluator for no-pipe-exit-masking (minted from
// feedback_pipe_masks_exit_code): a shell script that pipes into tee/tail without pipefail/PIPESTATUS
// reports the LAST stage's exit code, masking the real command's failure. Honors RUNTIME_STAGED_PATHS
// (diff-scoped gate); falls back to the git-tracked script roots. Exit 0 clean / 1 findings.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const staged = process.env.RUNTIME_STAGED_PATHS?.split('\n').filter(Boolean);
const files = (staged ?? execSync("git ls-files 'scripts/*.sh' 'scripts/**/*.sh' 'infrastructure/scripts/*.sh' 'infrastructure/scripts/**/*.sh'", { encoding: 'utf8' }).split('\n').filter(Boolean))
  .filter((f) => f.endsWith('.sh'));

const violations = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const pipesToMasker = /\|\s*(tee|tail)\b/.test(text);
  const guarded = /pipefail|PIPESTATUS/.test(text);
  if (pipesToMasker && !guarded) violations.push(f);
}
if (violations.length) {
  for (const f of violations) console.error(`pipe-exit-masking: ${f} pipes into tee/tail without pipefail/PIPESTATUS`);
  process.exit(1);
}
process.exit(0);
