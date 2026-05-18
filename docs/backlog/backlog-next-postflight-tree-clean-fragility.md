---
id: backlog-next-postflight-tree-clean-fragility
status: parking
type: bug
notes: "/backlog-next postflight tree-clean check fails in a loop when background nx/jest/pnpm processes are mutating the workspace; cleanup chases symptoms (rm -rf tmp-*; git restore pnpm-lock.yaml) and only passes by lucky timing. Needs delta-based check or orphan-process detection."
references:
  - .claude/skills/backlog-next/postflight.mjs
  - docs/backlog/jest-worker-scratch-leak-on-force-exit.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# /backlog-next postflight tree-clean check is fragile against background workspace mutators

Surfaced 2026-05-18 during the closing phase of `agent-pipeline-backlog-trap-impl`.

## Evidence

Postflight at `.claude/skills/backlog-next/postflight.mjs:54-62` enforces `git status --porcelain` is empty. During ship, the check failed 4 consecutive times. Diagnosis revealed:

1. A 40-day zombie `nx run-many -t test-integration` (PID 48621) was continuously spawning Jest workers.
2. Each worker left `tmp-<pid>-<rand>/` dirs in repo root.
3. pnpm (likely from the active nx daemon doing version discovery) was simultaneously re-injecting `tmp-*` entries into `pnpm-lock.yaml` as `importers:` (because pnpm scans cwd-root globs).
4. `rm -rf tmp-*` + `git restore pnpm-lock.yaml` would clean the tree, but the next `node postflight.mjs` invocation arrived after a new batch of scratch dirs had spawned.

Net: postflight passed only on the run where the timing happened to be right.

## Why this is a real /backlog-next bug, not just a workspace-state nuisance

- The skill's discipline rules (CLAUDE.md § "Backlog Discipline" + this skill's own postflight) demand a clean tree for a "shipped" declaration.
- A loop that "passes by accident" is worse than a loop that fails reliably: it gives false confidence that the workstream is fully closed.
- The cleanup logic in this turn was *me* improvising — the skill itself just says "Fix the surfaced state". For a recurrent leak the operator is left guessing whether the leak is workstream-caused or pre-existing.

## Cheapest next step (when promoted)

Replace the absolute `git status` check with a **delta** check:

- Capture `git status --porcelain` at adoption time (`preflight.mjs` output).
- On postflight, fail only if the delta vs adoption introduced NEW unstaged files. Files dirty BEFORE the workstream started are not the workstream's responsibility.

Bonus: postflight could detect orphan `nx`/`jest` processes older than the adoption timestamp and surface them as a "pre-existing noise" warning (not a fail). See [[jest-worker-scratch-leak-on-force-exit]] § "2026-05-18 follow-up".

## Why parking, not queued

- Doesn't block e2e or shipping (operator can manually `rm -rf` + restore and the gate passes).
- The underlying leak ([[jest-worker-scratch-leak-on-force-exit]]) is itself parking — promoting this is premature until the leak is addressed.
- The /backlog-next skill is internal tooling; flakiness is annoying but not user-facing.

## Related

- [[jest-worker-scratch-leak-on-force-exit]] — the upstream leak that triggers the false-positive.
- `.claude/skills/backlog-next/preflight.mjs` — sibling check, currently does NOT snapshot anything for postflight to diff against.
