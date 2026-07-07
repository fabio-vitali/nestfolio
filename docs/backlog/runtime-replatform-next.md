---
id: runtime-replatform-next
status: active
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "P5 WS-3 (spec §8, the big build): re-platform backlog-next onto runWorker. The deploy-gate evaluator modeled as a sha-conditional expensive runWatch at the ship boundary (reusing the orchestrator's epic-pre-done e2e-batch pattern: cost_ceiling:'expensive', e2eIsFresh sha-pinning, journal.record evidence); host runs deploy.sh/nx/e2e behind the execute/procedure seam. Plus lane→contexts/cost_ceiling mapping, preflight/postflight/detect-* as gate/audit checks, decision-log append = --auto journaled floor. Promoted 2026-07-07: blocker runtime-replatform-prereqs shipped 2026-07-06, satisfying the promotion trigger; ranked after the rank-1..3 e2e blockers."
references:
  - docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
  - docs/superpowers/specs/2026-07-07-runtime-replatform-next-design.md
out_of_scope:
  - "The flag/observer/parity-hole mechanism — that is runtime-replatform-prereqs."
  - "The epic orchestrator (run-epic.mjs) — that is runtime-replatform-next-epic."
  - "Deleting the legacy backlog-next skill body (P6, user-triggered)."
spec: docs/superpowers/specs/2026-07-07-runtime-replatform-next-design.md
plan: docs/superpowers/plans/2026-07-07-runtime-replatform-next.md
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# WS-3 — re-platform `backlog-next` onto `runWorker`

Per [the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §8 (WS-3).
The highest-effort slice: the deploy + integration + involved-e2e validation gate becomes a runtime-owned
sha-conditional expensive `runWatch`, with the host adapter supplying the `deploy.sh`/nx/e2e runner behind
the seam. Lanes map to check contexts; preflight/postflight/detect-* become gate/audit checks.

**Unblocked:** `runtime-replatform-prereqs` shipped 2026-07-06, so this was promoted to `queued` on 2026-07-07.
This member is the primary risk carrier (spec §14) — a real evaluator over a real AWS deploy.

## Decision log

- **2026-07-07 — worker↔lane edge: inject `preShipTrigger` (not import `classifyLane` into ring-1).**
  Plan Task 4 Step 3 had the engine `worker.mjs` import `classifyLane`/`laneToTrigger` from the content
  ring. That inverts the established content→engine dependency and violates SPEC-1's frozen hard constraint
  ("ring-1 stays project-agnostic; every Nestfolio-specific artifact lives only in the content ring behind
  the project seam"; `classifyLane`'s regexes name `services/`, `libs/event-types`, `.flow.yaml` — irreducibly
  Nestfolio). The import-boundary test wouldn't have caught it (it bans adapters/skills/claude-shell only).
  **Resolved (user):** the worker takes an injected `preShipTrigger` (`{contexts,cost_ceiling,on}`|null) +
  optional `changedScope`; the **adapter** (`run-next.mjs`) computes `classifyLane`→`laneToTrigger`. Ring-1
  stays generic and liftable (the primary reuse objective). Re-froze into SPEC-1's re-freeze log.
