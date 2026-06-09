---
id: funded-fixture-balance-updated-missing-snapshot
status: shipped
type: bug
notes: "E2E-SUITE BLOCKER surfaced 2026-06-09 by the typed-subject-contracts-ledger validation gate. apps/e2e-feature-tests funded() (src/helpers/fixtures.ts) emits a SYNTHETIC BALANCE_UPDATED with only {tenantId, userId, cashBalanceCents} — missing the contract-required `snapshot` field. The DEPLOYED investor-bff parses BALANCE_UPDATED against a schema requiring `snapshot` (the real ledger-ctrl producer always emits it via snapshot-to-events.ts), so the CashBalance projection throws ZodError (path:[snapshot], received undefined) → CashBalance never materializes → funded() times out after 60s. Pre-existing: investor-bff was NOT changed by the ledger slice; the mismatch dates to the ~2026-06-08 consumer-contract work (event-subject-payload-build-tripwire / event-subject-contracts) that made investor-bff strict-parse BALANCE_UPDATED, without updating funded(). Blocks EVERY e2e scenario that uses funded() (e.g. the withdrawal flows that depend on the investor-bff CashBalance row). The textbook [[event-subject-contracts]] anti-pattern: a fixture emits a shape the real producer never emits. Fix: make funded() emit a contract-valid BALANCE_UPDATED — add snapshot:{positions:{}, cashBalanceCents, lastEventSequence} (matching ledger-ctrl/contracts BalanceUpdatedSchema), value-consistent with cashBalanceCents. Consider asserting the fixture's emitted detail against the producer contract so co-wrong fixtures fail loudly. Ranked 2 (top of QUEUED, promoted 2026-06-09): a small Simple-lane fix that unblocks the WHOLE e2e suite (the validation mechanism every remaining typed-subject slice depends on) — do BEFORE slice 2 (typed-subject-contracts-investor)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: |
  Fix (Simple lane, main): apps/e2e-feature-tests/src/helpers/fixtures.ts funded() now
  emits a contract-valid BALANCE_UPDATED carrying snapshot:{positions:{}, cashBalanceCents,
  lastEventSequence:0} (matching ledger-ctrl BalanceUpdatedSchema / LedgerSnapshotSchema),
  and validates the emitted detail against BalanceUpdatedSchema at emit time so a future
  co-wrong fixture fails loudly (the event-subject-contracts guard).
  Verified: `pnpm nx affected -t test,lint --base=origin/main` green (3 projects); scoped
  e2e `JEST_PATH=funding/withdraw-cash NESTFOLIO_INTEG_PREFIX=dev pnpm nx run
  e2e-feature-tests:test-e2e-features` PASS 1/1 in 43s against deployed dev — the funded()
  beforeEach no longer times out (CashBalance materializes) and requestWithdrawal succeeds.
  No service deploy (test-fixture only; investor-bff/ledger-ctrl unchanged).
---

# funded() fixture emits BALANCE_UPDATED missing the contract-required `snapshot`

## Symptom

`apps/e2e-feature-tests` `funded()` (`src/helpers/fixtures.ts`) times out: `funded(): CashBalance
not materialized within 60s`. Surfaced 2026-06-09 running the
`typed-subject-contracts-ledger` validation gate against deployed dev.

## Root cause (evidence)

`funded()` publishes a **synthetic** `BALANCE_UPDATED` to investor-bff with detail
`{tenantId, userId, cashBalanceCents}` — **no `snapshot`**. The deployed investor-bff
IngressHandler rejects it:

```
eventType: BALANCE_UPDATED  errorName: ZodError
[{ "code":"invalid_type", "expected":"object", "received":"undefined",
   "path":["snapshot"], "message":"Required" }]   retryable: true
```

So the `CashBalance` projection (`pk=InvestorProfile#{tenantId}#{userId}`, sk=`CashBalance`)
never materializes and the 60s poll fails. The **real** ledger-ctrl producer always emits
`snapshot` (`snapshot-to-events.ts` wraps it on every event; `BalanceUpdatedSchema` requires
it), so investor-bff's strict parse is correct — the **fixture** is the co-wrong shape.

## Why pre-existing (not the ledger slice's doing)

investor-bff was not changed or redeployed by `typed-subject-contracts-ledger`. The strict
`snapshot` requirement on the BALANCE_UPDATED consumer dates to the ~2026-06-08 consumer-contract
work; `funded()` was never updated to match. The ledger slice's gate is simply the first thing to
run the e2e against the current investor-bff and hit it (the ledger gate itself now sidesteps
`funded()` — it reads ledger-ctrl/reconciliation-ctrl rows produced by `withHoldings()`, not the
investor-bff CashBalance).

## Blast radius

Any e2e scenario whose `applyFixtures` includes `funded()` — notably the withdrawal flows that
read the investor-bff `CashBalance` row via `requestWithdrawal`'s ConditionExpression.

## Fix

Make `funded()` emit a contract-valid `BALANCE_UPDATED`:

```ts
detail: {
  tenantId, userId,
  cashBalanceCents: opts.cashBalanceCents,
  snapshot: { positions: {}, cashBalanceCents: opts.cashBalanceCents, lastEventSequence: 0 },
}
```

Then re-run an affected scenario against deployed dev to confirm the `CashBalance` row
materializes. Strongly consider validating the fixture's emitted `detail` against the producer's
`BalanceUpdatedSchema` so a future co-wrong fixture fails loudly at emit time (the
[[event-subject-contracts]] lesson).

## Ranking

Promoted to rank 2 (top of QUEUED) 2026-06-09. It gates the whole e2e suite — the validation
mechanism every remaining typed-subject slice depends on — and the fix is a small Simple-lane
test-fixture change (no service deploy), so it leads the queue, ahead of slice 2
(typed-subject-contracts-investor).
