// .claude/skills/backlog-next/backlog-gate.mjs — the RUNTIME_ENGINE strangler branch for the backlog
// validation gate (WS-2, spec §8 / §4). preflight + postflight import this so the flag decision lives in
// ONE place. Flag off → legacy backlog-lint (backlog-only, all 11 rules), retained byte-for-byte until P6.
// Flag on → the runtime watch gate scoped to the backlog store: `run-watch --on=commit --changed=docs/backlog/*.md`
// runs the 13 migrated backlog checks (they are invariants → always ride) plus the repo's true invariants.
// The `commit` trigger excludes the `audit` context (so no skill: judge checks fire), and the backlog
// `--changed` scope excludes gate-only non-backlog checks (e.g. typed-subjects, contexts:[gate]). Verified
// clean against the real registry (decision D3). The single-quotes around the glob stop the shell from
// expanding it before run-watch's own glob-overlap match runs.
import { usesRuntimeEngine } from '../../../runtime/engine/lib/path-provenance.mjs';

export function backlogGate(env) {
  if (usesRuntimeEngine(env)) {
    return {
      cmd: "node runtime/engine/lib/run-watch.mjs --on=commit --changed='docs/backlog/*.md'",
      rule: 'backlog-gate',
      label: 'runtime backlog gate (run-watch --on=commit, backlog-scoped)',
    };
  }
  return {
    cmd: 'node .claude/skills/backlog-lint/lint.mjs',
    rule: 'backlog-lint',
    label: 'backlog-lint',
  };
}
