---
id: runtime-replatform-next
status: shipped
closed: 2026-07-07
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
validation_gate: >
  WS-3 shipped 2026-07-07 — re-platformed backlog-next's work-driver onto runWorker behind RUNTIME_ENGINE.
  (1) 10-task TDD build all green: engine 176/176 (incl. behavior-preserving orchestrator refactor +
  import-boundary), content 35/35, adapter 47/47, parity-structural 33/33, next-driver 2/2. (2) Parity
  oracle over the 5 WS-3 pairs — all `dominant`, parity.green=true, runtime gate 1.0: rt-next-lane-complex-ship
  fires the runtime-owned deploy-gate batch (journal has:'e2e'), while doc-layer/design-doc/auto-design-pause/
  auto-fork-resolve skip it (absent:'e2e'); report benchmarks/parity-oracle/parity-2026-07-07T15-09-35Z.md
  (runtime used ~4x fewer tokens than legacy). (3) Closing: detect-deploy exit 10 — every change is TIER0
  (runtime/,.claude/,scripts/,docs/), so NO real deploy fired; the deploy-gate's live proof is DEFERRED to the
  first service-touching workstream driven by run-next (dogfood). affected test,lint (runtime,tools) green +
  runtime typecheck 0. ship-recheck clean (ship:runtime-replatform-next:gate-clean journaled). Backward-edge:
  import-boundary guard extended to ban engine->content (mint consideration recorded; verified it fails on an
  injected violation). Decisions (see Decision log): worker takes an injected preShipTrigger (ring-1 stays
  project-agnostic per SPEC-1); next-lane-simple/complex kept P5 (diff-driven classifyLane needs a real code
  diff the services-free parity sandbox cannot produce; covered by complex-ship + classify-lane unit tests).
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
- **2026-07-07 — parity: next-lane-simple/complex kept P5 (not flipped).** classifyLane is diff-driven
  (D3); "simple"/"complex" need a real code diff, but the services-free parity sandbox seeds no services/
  tree and those routing items do docs-only lifecycle transitions → the in-sandbox delta reduces to
  Doc-layer. Their classification is exhaustively unit-tested (classify-lane.test.mjs, 9 cases) and the
  batch-firing path is proven by rt-next-lane-complex-ship (infra-retention-bump creates a real
  infrastructure/ file). Flipped the 4 cleanly-gradable twins (doc-layer, design-doc, auto-design-pause,
  auto-fork-resolve) + upgraded complex-ship; sharpened the two P5 reasons (no silent cap). A sandbox that
  seeds a services/ tree is the forward upgrade.
- **2026-07-07 — deploy-gate live proof DEFERRED (TIER0 dogfood).** Every WS-3 change is TIER0
  (runtime/,.claude/,scripts/,docs/) — detect-deploy-needed exits 10, so this workstream's own closing
  phase fires NO real `deploy.sh`. The deploy-gate is proven in-sandbox (stubbed deploy.sh, parity
  dominant) but its live AWS proof waits for the first **service-touching** workstream driven by
  `run-next` behind RUNTIME_ENGINE. Standing regression proof: the parity sandbox.
- **2026-07-07 — backward-edge mint: extended the import-boundary guard.** The ship exposed that
  import-boundary.test.mjs banned engine→adapter/skill/claude-shell but not engine→content — the exact gap
  that let the plan's first-cut Task 4 import classifyLane into ring-1 undetected. Extended the guard to
  ban engine→content (seam #2); verified it fails on an injected violation. Recorded as a `consider --none`
  (encoded as the node:test guard, not a duplicate registry cmd: check).

## Ship narrative

Ten-task TDD build (Tasks 1–8 deterministic, 9–10 empirical parity), then the closing gate. The engine
gained a shared ring-1 `preShipBatch` (extracted from runOrchestrator, now called by both the orchestrator's
epic-pre-done batch and the worker's new item-pre-ship step); the worker's step is **trigger-injected** so
ring-1 stays project-agnostic. The Nestfolio lane→trigger mapping (`classifyLane`/`laneToTrigger`) and the
`deploy-gate` check + sandbox-robust `deploy-gate-runner` live in the content/adapter rings; `run-next.mjs`
drives the worker behind `RUNTIME_ENGINE` (one flag site, mirroring backlog-gate.mjs). Parity: the runtime
worker reproduces backlog-next's lane behavior and, uniquely, owns the deploy-gate at pre-ship — proven by 5
`dominant` pairs with the runtime side spending ~4× fewer tokens. Legacy skill body stays byte-for-byte (P6).
