---
id: broker-ctrl-sim-deposit-normalizer-missing-amount-field
status: queued
rank: 1
type: bug
notes: "Tests assert `amount` but normalizer correctly writes `amountCents` (ledger convention). Production-correct; tests are stale. Surfaced cross-domain field-name inconsistency."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `SIM_DEPOSIT_COMPLETED` normalizer test asserts wrong field name (`amount` vs `amountCents`)

**Failing tests:**
- Unit: `services/execution/broker-ctrl/test/unit/order-lifecycle.test.ts:730` — `Deposit/Withdrawal Normalizer Integration › should normalize SIM_DEPOSIT_COMPLETED to NormalizedEvent with sk=DEPOSIT_DETECTED`.
- Integration: `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts:88` — `deposit-withdrawal-normalizer › should normalize SIM_DEPOSIT_COMPLETED to NormalizedEvent and emit DEPOSIT_DETECTED via CDC`.

## Root cause

**Tests are wrong; production code is correct.** Verified via subagent investigation 2026-05-11:

- broker-sim-adpt **emits** `SIM_DEPOSIT_COMPLETED` with `subject.amountCents` (the virtual-ledger repository's DepositDetected handler).
- ledger-ctrl **consumes** `DEPOSIT_DETECTED` reading `subject.amountCents` (`account.reducer` does `cashBalanceCents += amountCents`).
- investor-bff **creates Deposit rows** with `amountCents: s.capitalAmount` (`onboarding-completed.ts:108-131`).
- The normalizer at `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts:15` therefore correctly preserves `amountCents` end-to-end.

The unit + integration assertions encode an older `amount` contract that was superseded when ledger-ctrl moved to a Cents-everywhere convention.

## Fix shape

1. `services/execution/broker-ctrl/test/unit/order-lifecycle.test.ts:733` — `amount: 10000` → `amountCents: 10000`.
2. `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts:88` — `expect(item['amount']).toBe(100000)` → `expect(item['amountCents']).toBe(100000)`.
3. No production code changes.

## Out-of-scope architectural concern surfaced

The other 3 sibling normalizer handlers (`SIM_WITHDRAWAL_COMPLETED`, `ALPACA_TRANSFER_COMPLETED`, `ALPACA_TRANSFER_FAILED`) write `amount: subject.amount` — i.e. **not** in cents. So the codebase has a **per-event money-unit divergence**: deposits → `amountCents`, withdrawals/transfers → `amount`. This is by-design only if the upstream producers genuinely emit different units, which deserves verification but is independent of this fix.

Surfaced 2026-05-11 during full-system test sweep.
