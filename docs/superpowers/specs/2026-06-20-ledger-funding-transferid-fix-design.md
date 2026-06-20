# ledger-ctrl funding reducer: read `transferId`, typed via the producer contract

Date: 2026-06-20
Backlog: `ledger-ctrl-funding-reducer-depositid-vs-transferid` (epic `typed-subject-consumer-contract-gaps`, core)
Status: design approved

## Problem

`services/ledger/ledger-ctrl/src/domain/account.reducer.ts` maps `DEPOSIT_SETTLED` /
`WITHDRAWAL_SETTLED` events to the `RecordDeposit` / `RecordWithdrawal` domain commands by reading
`p['depositId']` / `p['withdrawalId']`. The real producer (broker-ctrl funding carrier) emits
`FundingSnapshotSchema` (`@nestfolio/execution-adpt/domain`), whose identity field is **`transferId`**
(which IS the nestfolio depositId/withdrawalId, threaded end-to-end) — there is no `depositId` /
`withdrawalId` on the wire.

The ledger handler (`handlers/event-listener.ts:89`) correctly `parseSubject(payload,
FundingSnapshotSchema)` and persists `{...subject}`, so the stored `LedgerEntry` payload carries
`transferId`. The reducer then reads `p['depositId']` → `undefined`; `RecordDepositSchema` requires
`depositId: z.string().min(1)`, so `applyCommand` returns `{ ok: false }` and the reducer returns
`state` unchanged → **no balance change, no `BALANCE_UPDATED` emitted**.

**Effect (production, money-affecting):** deposits and withdrawals never update the ledger-authoritative
cash balance. Lifecycle rows still surface (investor-bff projects them), but the dashboard cash balance
(versioned on `BALANCE_UPDATED`) does not move.

**Why it was masked:** pre-migration integration fixtures emitted the co-wrong `{ depositId, … }`, which
matched the reducer's wrong read. The honest `FundingSnapshot` fixtures (typed-test-fixtures migration)
make the path real and expose the bug. The matching unit fixtures (`account.reducer.test.ts`) are still
co-wrong and currently pass for the wrong reason.

## Decision

Fix it **in the reducer**, **typed via the producer contract** (Approach A — chosen over translating at
the event-listener boundary, and over a minimal `as string` cast).

Rationale:
- The reducer is already the single, uniform seam that maps persisted-subject fields → domain commands
  (same as the `ORDER_FILLED` / `CORPORATE_ACTION_APPLIED` branches). The bug is a mapping bug; the fix
  belongs there. Translating at the listener would split the mapping seam and change the persisted audit
  row away from the uniform `{...subject}`.
- The epic `typed-subject-consumer-contract-gaps` has done_when "fields the consumer reads codified
  typed, no casts". Parsing with `FundingSnapshotSchema` removes the `as string` casts and meets that bar;
  a minimal cast fix would not.
- The command schemas stay in the ledger's own ubiquitous language (`depositId` / `depositedAt`) — the
  reducer is the typed anti-corruption seam. Reusable lesson: consumer reducers should validate the
  producer contract and translate into domain-vocabulary commands, not leak wire field names.
- The cross-service import is precedented (`broker-ctrl/src/domain/funding.ts` + `…/contracts.ts` import
  the same schema; the ledger handler already imports it).

## Change

`services/ledger/ledger-ctrl/src/domain/account.reducer.ts`:

```ts
import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';
// …
case 'DEPOSIT_SETTLED': {
  const funding = FundingSnapshotSchema.parse(p);
  const result = applyCommand(RecordDeposit, {
    depositId:   funding.transferId,
    amountCents: funding.amountCents,
    depositedAt: funding.settledAt ?? funding.timestamp,
  }, state);
  return result.ok ? result.value.nextState : state;
}
case 'WITHDRAWAL_SETTLED': {
  const funding = FundingSnapshotSchema.parse(p);
  const result = applyCommand(RecordWithdrawal, {
    withdrawalId: funding.transferId,
    amountCents:  funding.amountCents,
    withdrawnAt:  funding.settledAt ?? funding.timestamp,
  }, state);
  return result.ok ? result.value.nextState : state;
}
```

Details:
- `settledAt ?? timestamp`: `FundingSnapshotSchema.settledAt` is `optional()`; the old
  `p['settledAt'] as string` cast would silently be `undefined` when absent → command failure. `timestamp`
  is required, so the fallback is always a valid `depositedAt`/`withdrawnAt`. Closes a latent edge.
- `.parse` (not `.safeParse`): the event-listener already validated the subject before persisting, so a
  parse failure in the reducer is a true invariant violation — surface it loudly rather than silently
  skip (no-silent-fallback). `amountCents` int/positive is still enforced by `RecordDepositSchema`.
- No producer change, no contract change, no CDK/infra change.

## Tests (TDD — red first)

- **Correct** the co-wrong unit fixtures in `test/unit/domain/account.reducer.test.ts` (`DEPOSIT_SETTLED`
  / `WITHDRAWAL_SETTLED` payloads) from `{ depositId | withdrawalId, amountCents, settledAt }` to the
  honest `FundingSnapshot` shape (`{ sk, direction, status, transferId, amountCents, currency,
  executionMode, initiatedAt, settledAt, timestamp }`). These fail against the new reducer until the
  fixtures are corrected (red), proving the path is now real.
- **Add** regression assertions:
  - honest `DEPOSIT_SETTLED` credits `cashBalanceCents` by `amountCents`;
  - honest `WITHDRAWAL_SETTLED` debits it;
  - `settledAt` absent → `depositedAt` falls back to `timestamp` (command still succeeds, balance moves).
- `test/unit/domain/record-deposit.test.ts` / `record-withdrawal.test.ts` — **unchanged** (command
  contract intact).
- Integration `DEPOSIT_SETTLED → BALANCE_UPDATED` / `WITHDRAWAL_SETTLED → BALANCE_UPDATED`
  (`test/integration/ledger-ctrl.integration.test.ts`, already honest, currently RED by design) turn
  green after deploy — the authoritative gate.

## Validation gate

1. nx `test,lint` on affected projects green.
2. Deploy ledger-ctrl to dev sandbox.
3. ledger-ctrl integration green, including the two funding → `BALANCE_UPDATED` CDC chains.
4. Involved e2e scenario if one covers funding settlement → balance (confirm during closing; the
   integration CDC chain is the direct authoritative assertion of the fixed path).

## Out of scope

- Producer side — `FundingSnapshotSchema` and the broker-ctrl funding carrier are correct; no change.
- The sibling `ORDER_FILLED` tax-lot field-drop bug (`ledger-ctrl-live-tax-lot-missing-order-fields`,
  re-homed to the `order-execution-money-path` epic, WS-4).
- Other reducer cases (`CORPORATE_ACTION_APPLIED`, `DECISION_PACKET_CREATED` shadow-fill).
- investor-bff Deposit/WithdrawalRequest lifecycle projection (already correct).
