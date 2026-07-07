---
id: runtime-replatform-next-epic
status: shipped
closed: 2026-07-07
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
validation_gate: >
  Shipped on feat/runtime-replatform-next-epic (6 tasks). run-epic.mjs (driveEpic + main) wraps the live
  runOrchestrator spine with content-ring member-selection (selectEpicMembers) + rule-11 guard (activeEpics)
  + headSha e2e-freshness; gh-PR-probe + worktree-ops deferred (spec §8/§10). Unit: epic-members 3/3,
  run-epic 4/4, epic-driver 2/2; full runtime target 388/388 + greenfield e2e 1/1; parity-oracle
  deterministic 33/33 (mapping 17/17 — 2 rt-bne-* epic twins mapped, residual bne-* P5 in two honest
  buckets; scenarios-lint; suites). nx run-many test (runtime,tools) RC 0; runtime:typecheck RC 0.
  ship-recheck clean (ship:runtime-replatform-next-epic:gate-clean). RUNTIME_ENGINE routes
  backlog-next-epic E4/E6/merge to run-epic.mjs via epic-driver.mjs; legacy SKILL body byte-for-byte
  (pure-insertion diff, 19+/0-). Live LLM parity dominance for the 2 epic twins DEFERRED to
  runtime-replatform-soak-gate (cost-gated cumulative sweep; WS-3 TIER0 precedent). mint consideration: none.
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
