---
id: typed-test-fixtures-consolidated-integration-e2e-verify
status: shipped
rank: null
type: bug
epic: typed-test-fixtures
epic_role: core
notes: "The DECOUPLED runtime verification for the whole typed-test-fixtures program (2026-06-17 user direction). The per-phase fixture migrations (Phase 1 Investor shipped; Phases 2-4 Advisory/Execution/Ledger shipped) are validated at ship time by static gates (tsc + the registry-driven check-typed-fixtures gate + lint + unit) + per-task reviews + whatever integration suites ran green in healthy dev-env windows — but the FULL integration + e2e green-against-deployed-dev run is consolidated here rather than gated per-phase, because (a) the migrations are test-layer-only with strong static guarantees, and (b) the dev-env CDC/EB propagation was degraded at Phase 1 ship time (widespread EventBusTrap timeout-empty-buffer flakes hitting migrated AND unmigrated events identically; 1939s suite runtimes). This item runs the full involved integration suites + the involved e2e scenarios for ALL migrated domains together, once Phases 1-4 have landed AND the dev-env propagation is healthy, to prove the typed fixtures drive the real deployed handlers end-to-end. EXIT CRITERIA: the involved investor/advisory/execution/ledger integration suites + e2e scenarios pass (separating any residual failures into the pre-filed env-flake umbrellas — integration-deep-coldstart-flakes-post-trap-hardening, ip-ctrl-integration-snapshot-userid-mismatch, investor-bff-updateoperatingmode-integration-seed-flake — vs genuine fixture regressions). The epic is NOT drainable until this is green. Now QUEUED (2026-06-18): Phase 4 shipped and all phases landed, so the promotion trigger fired; the consolidated run executes when the dev-env CDC/EB propagation is healthy."
done_when: "RE-SCOPED 2026-06-19 (user decision: close on the fixtures-criterion). The typed-test-fixtures program's runtime criterion is met — the consolidated integration sweep across all 4 migrated domains drives the typed fixtures against the real deployed handlers with ZERO ZodError/parse failures (proven twice: 2026-06-19 full sweep + 2026-06-19 market-data re-probe). Full-green (the market-data CDC chains + the 2 ledger balance-value tests + the e2e scenarios) is explicitly handed off to the now-QUEUED filed items below, and is NOT a precondition of this verification."
references:
  - docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
  - tools/check-typed-fixtures.mjs
out_of_scope:
  - "Fixing the pre-existing dev-env CDC/EB propagation flakes themselves (those are their own filed items)"
  - "New fixture migration (this is verification-only)"
spec: docs/superpowers/specs/2026-06-16-typed-test-fixtures-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: "Re-scoped close (user-approved 2026-06-19). Evidence: (1) 2026-06-19 full integration sweep across all 4 migrated domains — ZERO ZodError from any migrated subject; surfaced+fixed the ORDER_* cross-domain gap ([[typed-test-fixtures-cross-domain-order-events]]). (2) 2026-06-19 market-data env-health re-probe — `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration -p alpha-vantage-adpt,fred-adpt,sec-edgar-adpt,yahoo-finance-adpt,marketwatch-adpt --skip-nx-cache` vs deployed dev: all 5 `*_UPDATED` CDC tests timed out empty-buffer, the DDB-write tests PASSED, ZERO ZodError — env still degraded / likely real wiring gap, NOT a fixture regression. Residuals handed to QUEUED items: [[advisory-market-data-adapters-fetch-cdc-empty-buffer]], [[ledger-ctrl-live-tax-lot-missing-order-fields]], [[ledger-ctrl-funding-reducer-depositid-vs-transferid]]. NOTE: epic typed-test-fixtures still has 1 open core member ([[typed-fixtures-funding-lifecycle-detected-failed]]) → NOT yet drainable."
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

## 2026-06-19 market-data env re-probe + re-scoped close (SHIPPED)

Re-ran the market-data env-health probe to settle whether the dev env had recovered:
`NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration -p
alpha-vantage-adpt,fred-adpt,sec-edgar-adpt,yahoo-finance-adpt,marketwatch-adpt --skip-nx-cache`.

**Result — still degraded, consistent failure (NOT a flake):**
- All 5 adapters' `*_UPDATED`/CDC-emission tests timed out with an **empty** `EventBusTrap` buffer
  (`Captured-but-unmatched buffer: []`). 100% of the CDC-waiting tests failed across 5 services.
- Every test that only asserts a **DDB write** PASSED (marketwatch 2/2, yahoo 2/2, fred 1 of its
  pair) — so writes work; the `*_UPDATED` CDC emission/delivery is what fails.
- **ZERO ZodError / parse failures** anywhere → the typed fixtures are clean (fixtures-criterion MET
  for the **second** time today).

Combined with this morning's CloudWatch (fred FetchTrigger 0 invocations in-window), the consistent
100%-across-5-services-over-2-runs signature reads as a **real CDC/FETCH wiring gap**, not a transient
env window that self-heals (per [[feedback-flake-means-broken]] consistent failure ≠ flake). Tracked by
[[advisory-market-data-adapters-fetch-cdc-empty-buffer]].

**Re-scoped close (user decision 2026-06-19).** The typed-test-fixtures program's runtime goal — the
typed fixtures provably drive the real deployed handlers, zero ZodError — is proven. The remaining
full-green blockers are all **non-fixture bugs owned by other items**, now promoted from parking to
QUEUED so they are not lost:
- [[advisory-market-data-adapters-fetch-cdc-empty-buffer]] — market-data FETCH→`*_UPDATED` CDC wiring.
- [[ledger-ctrl-live-tax-lot-missing-order-fields]] — `RecordFill` reads order fields `ORDER_FILLED`
  doesn't carry → core balance/position money math + the `accept-decision` e2e (getPortfolio-reflects-fill).
- [[ledger-ctrl-funding-reducer-depositid-vs-transferid]] — funding reducer reads `depositId` vs the
  producer's `transferId` → deposits/withdrawals never credit the cash balance.

The e2e proof is **deferred to those items** (the advisory/ledger e2e scenarios fail on the SAME
wiring/money bugs, so re-running e2e now would re-hit them at real-LLM cost with ~zero marginal
fixture signal).

⚠ **Epic not yet drainable.** Closing this item does NOT make `typed-test-fixtures` drainable —
[[typed-fixtures-funding-lifecycle-detected-failed]] remains an open **core** member (rule 9).
