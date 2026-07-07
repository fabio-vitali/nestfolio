---
id: runtime-replatform-next-epic
status: active
type: refactor
rank: 4
epic: runtime-operationalization
epic_role: core
notes: "P5 WS-4 (spec §8, thin & last): re-platform backlog-next-epic onto runOrchestrator. Build the run-epic.mjs CLI driver that does not exist today (the orchestrator spine has no adapter), wrapping the live spine + member-selection/rule-11/e2e-freshness. Deferred (epics are drained standalone per D1): the gh-PR-state probe and worktree-ops binding stay host-side. Promoted 2026-07-07: trigger fired — runtime-replatform-prereqs (2026-07-06) + add/lint/next (2026-07-07) all shipped."
references:
  - docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
out_of_scope:
  - "The flag/observer/parity-hole mechanism — that is runtime-replatform-prereqs."
  - "The gh-PR-state probe and worktree-ops binding — deferred (host git stays; epics drain standalone per D1)."
  - "Deleting the legacy backlog-next-epic skill body (P6, user-triggered)."
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# WS-4 — re-platform `backlog-next-epic` onto `runOrchestrator` (thin)

Per [the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §8 (WS-4).
Thin and last: a `run-epic.mjs` CLI driver over the already-live orchestrator spine, deferring the
gh-PR-probe and worktree-ops niceties since epics are now drained as standalone member PRs (epic D1).

**Promoted 2026-07-07** — trigger fired: `runtime-replatform-prereqs` shipped 2026-07-06, and the
higher-value skills add/lint/next all shipped 2026-07-07. Queued at rank 4 (below the open e2e/CB bugs).
