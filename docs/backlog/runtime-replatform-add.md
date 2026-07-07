---
id: runtime-replatform-add
status: shipped
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "P5 WS-1 (spec §8): re-platform backlog-add onto intake.mjs (nearest parity — the router is already ported). Port the procedural context-loading the raw judge prompt skips (grep the active epic, read done_when:/scope:, run the closure-predicate test) into selectRoute; wire the lint --fix index-regen side-car after writeItemFile. Maps the 7 rt-add-* + atomicity/discard oracle scenarios. Promoted 2026-07-07 (standalone member per epic D1): the block trigger fired — runtime-replatform-prereqs shipped 2026-07-06 with parity-hole #1 (Finding.check optional + AGENT_OBSERVED sentinel), verified at finding.schema.ts:18/14."
references:
  - docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
  - docs/superpowers/specs/2026-07-07-runtime-replatform-add-design.md
out_of_scope:
  - "The flag/observer/parity-hole mechanism — that is runtime-replatform-prereqs."
  - "Deleting the legacy backlog-add body (P6, user-triggered)."
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: docs/superpowers/plans/2026-07-07-runtime-replatform-add.md
topic_memory: [project_runtime_realization.md]
validation_gate: "WS-1 re-platform of backlog-add onto intake.mjs — 5 feature commits (87c5f934 intake-context loader+renderer; 2bb000c7 selectRoute deterministic-context injection; 579da074 run-intake lint --fix index-regen side-car; c57ed9a9 RUNTIME_ENGINE SKILL.md toggle branch). Unit (node --test, all green): intake-context 5, intake D1-D7 (7), run-intake 7 (side-car runs-once / discard-skips / failure-exit1 + existing hermetic), backlog-add flag-branch 2. True-affected verify (runtime,tools) 354 tests green; runtime typecheck green (no lint target). Live parity oracle sweep (7 add-* pairs, each path:runtime hollow-green-gated): ALL 7 dominant, legacy=runtime=1.0 gatePassRate, parity.green=true (report benchmarks/parity-oracle/parity-2026-07-07T08-00-56-380Z.md, gitignored). ship-recheck clean (journaled ship:runtime-replatform-add:gate-clean); mint considered=none. Tier 0 (no deploy). The 2 write-layer P5 scenarios (add-id-collision-suffix, add-notes-scalar) stay deferred per the spec mapping."
closed: 2026-07-07
---

# WS-1 — re-platform `backlog-add` onto `intake.mjs`

Per [the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §8 (WS-1).
Closest-parity-first: the epic-aware router is already ported to `runtime/engine/lib/intake.mjs`; this
member closes the remaining gaps and flips `RUNTIME_ENGINE` for the intake path.

**Unblocked 2026-07-07:** `runtime-replatform-prereqs` shipped 2026-07-06 — parity-hole #1 made
`Finding.check` optional (`runtime/engine/schema/finding.schema.ts:18`, with the `AGENT_OBSERVED`
sentinel at `:14`), and the `RUNTIME_ENGINE` flag + parity-oracle mapping mechanism landed there.
Promoted to the active workstream as a standalone member PR (epic decision D1).
