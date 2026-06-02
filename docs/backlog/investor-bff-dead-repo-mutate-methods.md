---
id: investor-bff-dead-repo-mutate-methods
status: queued
rank: 10
type: refactor
notes: "5 InvestorProfileRepository mutate-methods have no live callers; one (upsertReadOnlyBalance) would violate CashBalance P1 ownership if revived."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# investor-bff dead repository mutate-methods

Surfaced during w4 ([[bff-readmodel-w4-investor-bff]]) code review. In
`services/investor/investor-bff/src/repositories/investor-profile.repository.ts`
these mutate-methods have **zero live callers** (only unit-test references):

- `setGoal` (L59), `updateGoal` (L89), `grantMandate` (L134),
  `setOperatingMode` (L182) — superseded by the AppSync JS resolvers
  `update-goal.fn.js` / `update-operating-mode.fn.js`, which are the live
  GraphQL mutation path.
- `upsertReadOnlyBalance` (L258) — the live CashBalance write is the
  `balance-updated.ts` `projectVersioned` projection.

The only live repo writer of the composite row is `setExecutionMode`
(GO_LIVE_CONFIRMED handler).

Two hazards if any is revived without care:
1. **`upsertReadOnlyBalance` writes `CashBalance`**, which w4 made a ledger-owned
   **P1 projection** — a local write to it violates single-writer ownership.
2. **`setGoal`/`updateGoal`/`setOperatingMode`/`grantMandate` write the
   `InvestorProfile` row but do NOT bump `__version`** — a silent non-monotonic
   modify that dashboard-bff's InvestorSnapshot P1 version-guard would drop,
   going stale. Any revival MUST add `SET #v = if_not_exists(#v,:zero)+:one`
   (the w4 convention) or the method must be deleted.

Cheapest next step: delete all five (they are dead), or — if any is intended for
future wiring — add the version bump and an ownership-respecting path.

Promoted to QUEUED 2026-06-01 (w6 governance freeze): the dead
`upsertReadOnlyBalance` is a latent CashBalance-P1 single-writer-ownership
violation if revived, and the other four write `InvestorProfile` without the
`__version` bump — both are clean-up/consistency hazards that belong on the
explicit queue, not parking.
