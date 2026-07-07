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
plan: docs/superpowers/plans/2026-07-07-runtime-replatform-next-epic.md
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# WS-4 — re-platform `backlog-next-epic` onto `runOrchestrator` (thin)

Per [the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §8 (WS-4).
Thin and last: a `run-epic.mjs` CLI driver over the already-live orchestrator spine, deferring the
gh-PR-probe and worktree-ops niceties since epics are now drained as standalone member PRs (epic D1).

**Promoted 2026-07-07** — trigger fired: `runtime-replatform-prereqs` shipped 2026-07-06, and the
higher-value skills add/lint/next all shipped 2026-07-07. Queued at rank 4 (below the open e2e/CB bugs).

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-07
- **Decision:** Start workstream: parked item runtime-replatform-next-epic whose promotion trigger had fired
- **Options:** Promote to queued (rank 4) and work now | Promote only, defer work | Leave parked
- **Chosen:** Promote to queued (rank 4) and work now
- **Rationale:** All prereqs shipped (prereqs 2026-07-06; add/lint/next 2026-07-07) so the promote-once-prereqs+add/lint/next trigger fired; user confirmed via AskUserQuestion. Epic runtime-operationalization is parking, so this is worked STANDALONE (Complex lane), not epic-member mode.
- **Rejected:** Leave parked (trigger already satisfied) / promote-only (user wants it worked now)

### D2 — 2026-07-07
- **Decision:** Plan execution approach (writing-plans handoff)
- **Options:** Inline execution (executing-plans) | Subagent-driven-development
- **Chosen:** Inline execution (executing-plans)
- **Rationale:** In --auto the hard floor MUST surface AskUserQuestion widgets; per feedback No worker-isolating subagents, isolated task subagents cannot surface floor decisions. Inline keeps floors visible in this session. The 6-task TDD sequence has no cross-task parallelism benefit.
- **Rejected:** Subagent-driven: fresh-subagent-per-task loses direct floor-widget visibility under --auto
