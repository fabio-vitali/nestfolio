// .claude/skills/backlog-next/backlog-gate.mjs — the backlog validation gate command. preflight +
// postflight import this so the gate command lives in ONE place. The runtime watch gate scoped to
// the backlog store: `run-watch --on=commit --changed=docs/backlog/*.md` runs the migrated backlog
// checks (invariants → always ride) plus the repo's true invariants. The `commit` trigger excludes
// the `audit` context (no skill: judge checks fire), and the backlog `--changed` scope excludes
// gate-only non-backlog checks (e.g. typed-subjects, contexts:[gate]). The single-quotes around the
// glob stop the shell from expanding it before run-watch's own glob-overlap match runs.
// (The legacy `backlog-lint` validation arm + the RUNTIME_ENGINE strangler flag were removed with the
// legacy work-driver — runtime-legacy-retirement, 2026-07-09. `lint.mjs --fix` remains the index/dossier
// regen side-car; only the standalone lint VALIDATION invocation was retired.)

export function backlogGate() {
  return {
    cmd: "node runtime/engine/lib/run-watch.mjs --on=commit --changed='docs/backlog/*.md'",
    rule: 'backlog-gate',
    label: 'runtime backlog gate (run-watch --on=commit, backlog-scoped)',
  };
}
