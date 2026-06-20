---
id: ledger-ctrl-funding-reducer-depositid-vs-transferid
status: active
type: bug
notes: "SIGNIFICANT (money): ledger account.reducer reads p['depositId']/p['withdrawalId'] but the real FundingSnapshot producer emits transferId → RecordDeposit/RecordWithdrawal schema validation fails → cash balance NEVER credited on DEPOSIT_SETTLED/WITHDRAWAL_SETTLED in production. Co-wrong fixture masked it. PROMOTED to QUEUED 2026-06-19 (rank 2): handed off from the re-scoped consolidated verify ([[typed-test-fixtures-consolidated-integration-e2e-verify]] closed on the fixtures-criterion) as a real money bug the honest FundingSnapshot fixture exposes — the DEPOSIT_SETTLED/WITHDRAWAL_SETTLED → BALANCE_UPDATED integration assertions are RED by design until this is fixed (consumer production change + deploy + e2e). Trigger 'before the rank-5 consolidated verify' has fired (that verify shipped 2026-06-19)."
references: []
out_of_scope:
  - "Producer side untouched — FundingSnapshotSchema (execution-adpt/domain) and the broker-ctrl funding carrier are correct; transferId IS the nestfolio depositId/withdrawalId, threaded end-to-end. No producer change."
  - "The sibling ORDER_FILLED tax-lot field-drop bug (ledger-ctrl-live-tax-lot-missing-order-fields) is re-homed to the order-execution-money-path epic (WS-4); not fixed here."
  - "Other reducer cases (CORPORATE_ACTION_APPLIED audit store, DECISION_PACKET_CREATED shadow-fill) — unrelated, untouched."
  - "investor-bff Deposit/WithdrawalRequest lifecycle projection (already surfaces correctly) — out of scope; this fixes only the ledger-authoritative CashBalance path."
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: typed-subject-consumer-contract-gaps
epic_role: core
---

# ledger-ctrl funding reducer reads `depositId`/`withdrawalId`, producer emits `transferId`

Surfaced 2026-06-19 by [[typed-test-fixtures-cross-domain-consumer-migration]] while migrating the
ledger-ctrl DEPOSIT_SETTLED/WITHDRAWAL_SETTLED consumer fixtures to the real `FundingSnapshotSchema`.

## The bug (production, money-affecting)

`services/ledger/ledger-ctrl/src/domain/account.reducer.ts`:
```ts
case 'DEPOSIT_SETTLED': {
  const result = applyCommand(RecordDeposit, {
    depositId:   p['depositId'] as string,   // ← FundingSnapshot has NO depositId
    amountCents: p['amountCents'] as number,
    depositedAt: p['settledAt'] as string,
  }, state);
  return result.ok ? result.value.nextState : state;  // ← ok=false → balance UNCHANGED
}
// WITHDRAWAL_SETTLED: identical, reads p['withdrawalId']
```

- The real producer (broker-ctrl funding carrier) emits `FundingSnapshotSchema`
  (`execution-adpt/src/domain/contracts.ts:17`): `{ sk, direction, status, transferId, amountCents,
  currency, executionMode, initiatedAt, settledAt?, timestamp }` — the identity is **`transferId`**
  (which IS the nestfolio depositId/withdrawalId, threaded end-to-end), NOT `depositId`/`withdrawalId`.
- `ledger-ctrl/src/handlers/event-listener.ts:89` correctly `parseSubject(payload, FundingSnapshotSchema)`
  and stores `{...subject}` — so the stored LedgerEntry payload has `transferId`, no `depositId`.
- The reducer then reads `p['depositId']` → `undefined`. `RecordDepositSchema` requires
  `depositId: z.string().min(1)` (`record-deposit.ts`), so `applyCommand` returns `{ ok: false }`
  → the reducer returns `state` unchanged → **no balance change → no BALANCE_UPDATED emitted**.

**Effect:** deposits and withdrawals never update the ledger-authoritative cash balance in production.
The Deposit/WithdrawalRequest lifecycle rows still surface (investor-bff projects them), but the
dashboard cash balance (ledger-authoritative `CashBalance`, versioned on BALANCE_UPDATED) does not move.

## Why it was masked

The pre-migration integration fixtures emitted the co-wrong `{ depositId, amountCents, settledAt }`,
which (a) matched the reducer's wrong `p['depositId']` read and (b) only "passed" against
stale/un-validated dev infra. The honest `FundingSnapshot` fixture (this workstream) makes
`DEPOSIT_SETTLED → BALANCE_UPDATED` exercise the real path → exposes the bug.

## Fix (own workstream — consumer production change + deploy + e2e)

Read `p['transferId']` as the deposit/withdrawal id in `account.reducer.ts` (and/or rename the
`RecordDeposit`/`RecordWithdrawal` schema field to `transferId`). Add a regression test asserting a
real `FundingSnapshot` DEPOSIT_SETTLED credits the balance + emits BALANCE_UPDATED. Same class as
[[ledger-ctrl-live-tax-lot-missing-order-fields]] (consumer reads a field the producer doesn't emit).

## ⚠ Why this is QUEUED (handed off from the consolidated verify)

ledger-ctrl integration incl. `DEPOSIT_SETTLED → BALANCE_UPDATED` runs against the now-honest
`FundingSnapshot` fixtures — that assertion is RED until this is fixed. It is a **genuine consumer bug
the honest fixture reveals**, not an env flake. [[typed-test-fixtures-consolidated-integration-e2e-verify]]
closed on the fixtures-criterion (2026-06-19) and explicitly handed its ledger balance-value residual
here, so this is now a first-class QUEUED workstream (rank 2). The fix is a consumer production change
(read `p['transferId']`, or rename the `RecordDeposit`/`RecordWithdrawal` schema field) + deploy + a
regression test asserting a real `FundingSnapshot` DEPOSIT_SETTLED credits the balance and emits
BALANCE_UPDATED — i.e. a Complex-lane workstream.
