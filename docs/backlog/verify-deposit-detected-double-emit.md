---
id: verify-deposit-detected-double-emit
status: dropped
rank: null
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "By-design — two distinct deposits, not a duplicate emit."
notes: "Dropped 2026-05-07 — verified the two DEPOSIT_DETECTED events come from two distinct deposit flows."
---

# Verify whether `DEPOSIT_DETECTED` is double-emitted upstream

Diagnostic 2026-05-03 (tenant `e2e-1777762060562`) showed 2 distinct `DEPOSIT_DETECTED` events in 15s with different `depositId`s (`0ee4082f…` EUR 500 and `76b39b5f…` USD 5000).

**Dropped 2026-05-07.** Verified the diagnostic represents two distinct deposit flows running in the Playwright `new-investor-happy-path` journey, not a fan-out bug:

1. **EUR deposit (onboarding capital)** — `services/investor/investor-bff/src/transforms/onboarding-completed.ts:108-131` creates a `Deposit` row with `currency: s.currency` (default `EUR`) when `capitalAmount > 0`. CDC emits `DEPOSIT_INITIATED` → broker-ctrl router → broker-sim-adpt → `SIM_DEPOSIT_COMPLETED` → broker-ctrl `deposit-withdrawal-normalizer.ts:7-22` → `DEPOSIT_DETECTED`.
2. **USD deposit (explicit mutation)** — `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:122-133` step calls `initiateDeposit` exactly once (`enterAmount(5000)` + `confirm()`), which goes through the same chain to a second `DEPOSIT_DETECTED`.

Different depositIds, currencies, and source code paths — confirmed by-design.
