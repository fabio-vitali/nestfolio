---
id: typed-test-fixtures-consolidated-integration-e2e-verify
status: queued
rank: 5
type: bug
epic: typed-test-fixtures
epic_role: core
notes: "The DECOUPLED runtime verification for the whole typed-test-fixtures program (2026-06-17 user direction). The per-phase fixture migrations (Phase 1 Investor shipped; Phases 2-4 Advisory/Execution/Ledger shipped) are validated at ship time by static gates (tsc + the registry-driven check-typed-fixtures gate + lint + unit) + per-task reviews + whatever integration suites ran green in healthy dev-env windows — but the FULL integration + e2e green-against-deployed-dev run is consolidated here rather than gated per-phase, because (a) the migrations are test-layer-only with strong static guarantees, and (b) the dev-env CDC/EB propagation was degraded at Phase 1 ship time (widespread EventBusTrap timeout-empty-buffer flakes hitting migrated AND unmigrated events identically; 1939s suite runtimes). This item runs the full involved integration suites + the involved e2e scenarios for ALL migrated domains together, once Phases 1-4 have landed AND the dev-env propagation is healthy, to prove the typed fixtures drive the real deployed handlers end-to-end. EXIT CRITERIA: the involved investor/advisory/execution/ledger integration suites + e2e scenarios pass (separating any residual failures into the pre-filed env-flake umbrellas — integration-deep-coldstart-flakes-post-trap-hardening, ip-ctrl-integration-snapshot-userid-mismatch, investor-bff-updateoperatingmode-integration-seed-flake — vs genuine fixture regressions). The epic is NOT drainable until this is green. Now QUEUED (2026-06-18): Phase 4 shipped and all phases landed, so the promotion trigger fired; the consolidated run executes when the dev-env CDC/EB propagation is healthy."
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

## 2026-06-19 partial run (integration; e2e deferred)

Ran the full integration sweep across all 4 migrated domains against deployed dev (~40 suites).

**Core criterion MET: zero ZodError/parse failures from any migrated subject** — the typed fixtures
(all phases) drive the real handlers correctly.

**Surfaced + fixed a real gap:** the cross-domain ORDER_* lifecycle events were never registered/
migrated (co-wrong untyped fixtures: executionMode 'paper' + missing timestamp → real handlers
ZodError'd, 17/22 of the initial failures). Closed by [[typed-test-fixtures-cross-domain-order-events]]
(register ORDER_* + type all ORDER_* fixtures; gate 88 events; DWC 20/20, investor-ctrl 19/19,
ledger-ctrl existence/dedup green). Also fixed the pre-existing circuit-breaker DRY-subject assertion
(investor-ctrl → 19/19).

**Residual failures — all attributed, none are fixture regressions; "all green" NOT yet achieved:**
- ledger DEPOSIT/WITHDRAWAL → BALANCE_UPDATED: [[ledger-ctrl-funding-reducer-depositid-vs-transferid]] (money bug).
- ledger ORDER_PARTIALLY_FILLED → BALANCE_UPDATED + full-shuffle: [[ledger-ctrl-live-tax-lot-missing-order-fields]] (class-b reducer money bug, extended 2026-06-19).
- advisory market-data adapter FETCH→*_UPDATED + agent CDC: [[advisory-market-data-adapters-fetch-cdc-empty-buffer]] (env-window / FETCH-routing; reproduces serially).
- investor-profile-ctrl snapshot: [[ip-ctrl-integration-snapshot-userid-mismatch]] (pre-filed).

**Stays QUEUED.** Full green needs (a) a genuinely healthy dev-env window for the market-data FETCH
chains, and (b) the two filed ledger money bugs fixed (they break the balance-value tests by design).
The e2e run is deferred (2026-06-19 user direction) — degraded market-data CDC + real-LLM cost make
it low-value until the env is healthy and the money bugs are addressed.
