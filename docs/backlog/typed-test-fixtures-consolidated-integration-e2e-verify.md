---
id: typed-test-fixtures-consolidated-integration-e2e-verify
status: queued
rank: 5
type: bug
epic: typed-test-fixtures
epic_role: core
notes: "The DECOUPLED runtime verification for the whole typed-test-fixtures program (2026-06-17 user direction). The per-phase fixture migrations (Phase 1 Investor shipped; Phases 2-4 Advisory/Execution/Ledger to follow) are validated at ship time by static gates (tsc + the registry-driven check-typed-fixtures gate + lint + unit) + per-task reviews + whatever integration suites ran green in healthy dev-env windows — but the FULL integration + e2e green-against-deployed-dev run is consolidated here rather than gated per-phase, because (a) the migrations are test-layer-only with strong static guarantees, and (b) the dev-env CDC/EB propagation was degraded at Phase 1 ship time (widespread EventBusTrap timeout-empty-buffer flakes hitting migrated AND unmigrated events identically; 1939s suite runtimes). This item runs the full involved integration suites + the involved e2e scenarios for ALL migrated domains together, once Phases 1-4 have landed AND the dev-env propagation is healthy, to prove the typed fixtures drive the real deployed handlers end-to-end. EXIT CRITERIA: the involved investor/advisory/execution/ledger integration suites + e2e scenarios pass (separating any residual failures into the pre-filed env-flake umbrellas — integration-deep-coldstart-flakes-post-trap-hardening, ip-ctrl-integration-snapshot-userid-mismatch, investor-bff-updateoperatingmode-integration-seed-flake — vs genuine fixture regressions). The epic is NOT drainable until this is green. Promote after Phase 4 ships (or sooner if the dev env recovers and a consolidated run is worthwhile)."
done_when: "The full involved integration suites + e2e scenarios for every migrated typed-test-fixtures domain pass against deployed dev in a healthy-env window; any residual failures are attributed to a pre-filed env-flake item (not a fixture regression); zero ZodError/parse failures from any migrated subject."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - tools/check-typed-fixtures.mjs
out_of_scope:
  - "Fixing the pre-existing dev-env CDC/EB propagation flakes themselves (those are their own filed items)"
  - "New fixture migration (this is verification-only)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Consolidated integration + e2e verification of the typed-test-fixtures program

The runtime proof for the whole program, decoupled from per-phase shipping (2026-06-17 user
direction). Each phase ships on static gates + reviews + healthy-window integration evidence;
this item runs the full integration + e2e verification for all migrated domains TOGETHER once
the phases have landed and the dev environment's CDC/EB propagation is healthy.

It exists because the dev env was degraded at Phase 1 ship time — see the Phase 1 validation_gate
([[typed-test-fixtures-phase1-investor]]) for the evidence that the migration is sound
(dashboard-bff 21/21 + broker-ctrl 11/11 with migrated fixtures, zero parse errors) while the
broader integration suite timed out on an environmental flake. Gates the epic's drainability.
