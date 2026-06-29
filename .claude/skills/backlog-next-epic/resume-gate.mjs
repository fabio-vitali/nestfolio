#!/usr/bin/env node
/**
 * Resume-gate dispatch for /backlog-next-epic (top of Procedure).
 *
 * Decides how a `/backlog-next-epic <id>` invocation proceeds, from the durable
 * run-state and — ONLY when the e8 hand-off marker is set — the PR state. The
 * decision is PURE (decideResume); main() does the impure gather: it runs
 * `runstate.mjs get` and, only if e8 is set, `gh pr view <branch> --json state`
 * (shelled out so the benchmark gh PATH-shim stays observable; the result is
 * INJECTED into the pure core, never fetched inside it).
 *
 * Actions:
 *   FRESH           — no run-state → run E0→E1→E2→E3→E4 (promote + fresh worktree)
 *   RESUME          — run-state present, no e8 → re-enter worktree, jump to E4 loop
 *   POST_MERGE_TAIL — e8 set AND PR merged → run only the E8.4 tail
 *   PR_STILL_OPEN   — e8 set AND PR not confirmed-merged → re-print link, STOP
 *   ERROR           — malformed run-state → clean message (never a raw stack)
 *
 * Usage: node resume-gate.mjs <epic-id>
 * Exit codes: 0 ok (prints `action=<X>`) · 2 malformed/usage (ERROR action).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RESUME_ACTIONS = ['FRESH', 'RESUME', 'POST_MERGE_TAIL', 'PR_STILL_OPEN', 'ERROR'];
const E8_MARKER = 'PR_OPEN_AWAITING_MERGE';

/** Pure dispatch — see file header for the input/output contract. */
export function decideResume({ runState, prState } = {}) {
  if (!runState || runState.kind === 'absent') {
    return { action: 'FRESH', reason: 'no run-state — fresh epic run (E0→E4)' };
  }
  if (runState.kind === 'malformed') {
    return { action: 'ERROR', reason: `run-state unusable: ${runState.error}` };
  }
  const state = runState.state || {};
  if (state.e8 !== E8_MARKER) {
    return { action: 'RESUME', reason: 'run-state present, no e8 — re-enter member loop (E4)' };
  }
  if (prState === 'MERGED') {
    return { action: 'POST_MERGE_TAIL', reason: 'PR merged — run only the E8.4 post-merge tail' };
  }
  return { action: 'PR_STILL_OPEN', reason: `PR not confirmed merged (state=${prState ?? 'unknown'}) — re-print link and stop; the merge is the user's` };
}

function main() {
  const epicId = process.argv[2];
  if (!epicId) {
    console.error('Usage: resume-gate.mjs <epic-id>');
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const shSafe = (cmd) => {
    try { return { ok: true, out: execSync(cmd, { encoding: 'utf8' }).trim(), code: 0 }; }
    catch (err) { return { ok: false, out: (err.stdout || '').toString().trim(), err: (err.stderr || '').toString().trim(), code: err.status ?? 1 }; }
  };

  // Gather run-state via the canonical helper (exit 3 = absent/FRESH, 2 = malformed, 0 = ok JSON).
  const got = shSafe(`node "${join(here, 'runstate.mjs')}" get ${epicId}`);
  let runState;
  if (got.code === 3) runState = { kind: 'absent' };
  else if (got.code === 2) runState = { kind: 'malformed', error: got.err || got.out };
  else if (got.code === 0) {
    try { runState = { kind: 'present', state: JSON.parse(got.out) }; }
    catch (e) { runState = { kind: 'malformed', error: e.message }; }
  } else runState = { kind: 'malformed', error: got.err || `runstate get exited ${got.code}` };

  // Only consult PR state when the e8 hand-off marker is set. Use the BRANCH selector
  // (in run-state) so no PR number is needed on a cold resume; still matches the
  // `gh pr view ... --json state` stub → observable.
  let prState;
  if (runState.kind === 'present' && runState.state?.e8 === E8_MARKER && runState.state?.branch) {
    const pr = shSafe(`gh pr view ${runState.state.branch} --json state -q .state`);
    if (pr.ok) prState = pr.out;
  }

  const { action, reason } = decideResume({ runState, prState });
  console.log(`action=${action}`);
  console.log(reason);
  process.exit(action === 'ERROR' ? 2 : 0);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
