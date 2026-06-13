---
id: broker-funding-completed-normalization-drift
status: shipped
type: bug
notes: "LIVE-MONEY-PATH BUG surfaced 2026-06-08 by event-subject-payload-build-tripwire Task 5b. broker-ctrl deposit-withdrawal-normalizer reads `s.transferId`/`s.amountCents`/`s.currency`/`s.userId` off the inbound funding-completed subjects, but the producers emit DIFFERENT field names: broker-alpaca-adpt `AlpacaTransferResultSchema` emits `nestfolioTransferId` (not transferId), `amount` (not amountCents), NO `currency`, NO `userId`; broker-sim-adpt `WithdrawalCompleted` emits `amount` (not amountCents) + no `currency`. So on the LIVE alpaca settle/fail path: amountCents=undefined, currency silently defaults to 'USD', and transferId falls back to ctx.eventId → the carryForward lookup keys on the WRONG id, misses the requested carrier, and the settle/fail row uses subject fallbacks instead of the stored request values. Structural issue too: normalizer depositCompletion/withdrawalCompletion are SHARED by both the sim and alpaca code paths, so they can't be typed against a single subject schema. Fix needs a design: define a canonical funding-completed event shape (transferId, amountCents, currency, userId, direction, status) emitted consistently by BOTH broker-sim-adpt and broker-alpaca-adpt, then restructure the normalizer's 4 handlers to parse per-event via parseSubject. This unblocks removing the LAST 4 `as Record<string,unknown>` casts in the repo (deposit-withdrawal-normalizer.ts lines 26/58/88/96), which event-subject-payload-build-tripwire left as a documented exception. Re-ranked LAST (rank 6, 2026-06-08 user direction): do this AFTER the typings refactoring (residual-casts cleanup + skills/docs enforcement) and the nx-affected resolver."
references: []
out_of_scope:
  - "relationshipId / real ACH bank-linking — stays '' ; a live ACH transfer still cannot succeed without it. This workstream makes the contract/id chain correct-by-construction, not the bank link (funding-onboarding feature, separate)."
  - "Rewriting the funded() / withdraw-cash synthetic-event e2e fixtures (funded-fixture-balance-updated-missing-snapshot territory)."
  - "broker-ctrl-order-sf-input-contract-gap, ledger-ctrl-live-tax-lot-missing-order-fields, broker-ctrl-alpaca-funding-carrier-pk-divergence — separate parked items (order path / carrier-PK)."
  - "Normalizing the sim deposit/withdrawal completion amount-unit asymmetry at the producer (sim withdrawal emits dollars, deposit cents) — absorbed by carryForward here."
  - "A real LIVE alpaca funding e2e — impossible in dev (paper API + missing relationshipId); live path covered by mocked-Alpaca integration tests."
spec: docs/superpowers/specs/2026-06-13-broker-funding-completed-normalization-design.md
plan: docs/superpowers/plans/2026-06-13-broker-funding-completed-normalization.md
topic_memory: []
validation_gate: |
  Shipped 2026-06-14 on branch worktree-broker-funding-completed-normalization-drift (commits 5341d5a7..ad5db744; approach B / consumer-normalizes, design 2026-06-13-broker-funding-completed-normalization-design.md, plan 2026-06-13-broker-funding-completed-normalization.md).
  CODE: coherent funding id+amount chain — router emits typed AlpacaTransferRequest threading transferId=depositId/withdrawalId; broker-alpaca parseSubjects it + threads nestfolioTransferId + sends amountCents/100 to Alpaca; normalizer parseSubjects per producer (SimDepositCompleted/SimWithdrawalCompleted from broker-sim-adpt/contracts, AlpacaTransferResult from execution-adpt/domain), keys carryForward on the threaded id; sim withdrawal parses WithdrawalInitiated+amountCents. ALL 4 `as Record<string,unknown>` casts removed (last in the repo — closes the event-subject-payload-build-tripwire exception). Boundary contracts AlpacaTransferRequest+AlpacaTransferResult hosted in execution-adpt/domain (home-rule extension for intra-domain mutual boundaries; documented in SYSTEM-ARCHITECTURE.md + create-event/feature/service skills). nx graph: no new cycle.
  UNIT: broker-ctrl/broker-alpaca-adpt/broker-sim-adpt/execution-adpt `nx run-many -t test,lint` all green (101 broker-alpaca + others).
  DEPLOY: execution-adpt,broker-ctrl,broker-alpaca-adpt,broker-sim-adpt → dev sandbox (UPDATE_COMPLETE, deploy log /tmp/deploy-funding.log).
  INTEGRATION (deployed dev, mocked Alpaca): broker-ctrl 11/11 + broker-alpaca-adpt 10/10 PASS. CORE REGRESSION PROVEN: the live-path carryForward HIT — settled carrier amountCents=7000 (fallback would be 6900) AND initiatedAt=seeded 2020-01-01 (fallback would be ctx.timestamp) — i.e. the completion re-finds the requested carrier on the alpaca path (the original live-money bug). CloudWatch confirmed the deployed normalizer emits DEPOSIT_DETECTED+SETTLED for valid completions.
  E2E (deployed dev): apps/e2e-feature-tests deposit-cash.e2e.test.ts 1/1 PASS — the FIRST true end-to-end coverage of the broker-ctrl sim funding pipeline (initiateDeposit → broker-ctrl router → broker-sim → normalizer → DEPOSIT_DETECTED → investor-adpt → dashboard activity), NO synthetic event injection.
  NOTE: the deploy-gate run surfaced + fixed several PRE-EXISTING stale integration fixtures (broker-ctrl + broker-alpaca integration/resilience injected pre-retype event shapes; the EXECUTION_MODE_CHANGED fixture had been broken vs ExecutionModeChangedSchema since ~mid-May, masked by absent CI) — all swept to real producer shapes + safeParse-verified. Pre-existing advisory jest-mapper failures filed as advisory-services-jest-mapper-investor-adpt-domain (diff-proven unrelated). Live ALPACA ACH (relationshipId/bank-link) out of scope.
---

# Broker funding-completed normalization drift (live-money-path bug)

## Summary

`broker-ctrl`'s `deposit-withdrawal-normalizer` normalizes heterogeneous inbound
funding-completed events (sim deposit/withdrawal, alpaca transfer completed/failed)
into a common funding carrier. It reads `transferId` / `amountCents` / `currency` /
`userId` off each subject — but the producers don't emit those field names.

## Confirmed mismatches (file:line)

- **broker-alpaca-adpt** `AlpacaTransferResultSchema`
  (`services/execution/broker-alpaca-adpt/src/domain/schemas.ts:64-76`) emits
  `nestfolioTransferId`, `alpacaTransferId`, `direction`, `amount`, `status`,
  `failureReason?`, `timestamp`, `tenantId` — **no `transferId`, no `amountCents`,
  no `currency`, no `userId`**.
- **broker-sim-adpt** `WithdrawalCompleted`
  (`services/execution/broker-sim-adpt/src/handlers/event-listener.ts:106-114`) emits
  `amount` (raw dollars) — **no `amountCents`, no `currency`**.
- **normalizer reads** (`services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts`):
  `transferFailed:98` `s.transferId`; alpaca/sim paths `s.amountCents`, `s.currency`,
  `s.userId`.

## Live-path impact

When `executionMode=live`: `amountCents=undefined` → carrier falls back to the
`requested` carrier; `currency` falls back to a hardcoded `'USD'`; `transferId`
falls back to `ctx.eventId` → the `carryForward` lookup keyed on `ctx.eventId`
**misses** the requested carrier, so the settle/fail row is built from subject
fallbacks (undefined amountCents) rather than the pre-stored request values. The
live alpaca deposit/withdrawal settlement is mis-normalized today. (Sim path is
mostly shielded because `getRequested` usually supplies the stored carrier, but
breaks when it returns nothing.)

## Structural issue

`normalizer.depositCompletion` / `withdrawalCompletion` are SHARED entrypoints —
`alpacaCompletion` delegates into them — so they receive heterogeneous subject
shapes and cannot be typed against a single producer schema.

## Proposed fix (needs design)

1. Define a **canonical funding-completed event contract** (transferId, amountCents,
   currency, userId, direction, status, timestamp) and make BOTH broker-sim-adpt
   and broker-alpaca-adpt emit it (alpaca: map `amount`→`amountCents`,
   `nestfolioTransferId`→`transferId`, add `currency`; sim: `amount`→`amountCents`,
   add `currency`).
2. Restructure the normalizer's 4 handlers so each parses its event's canonical
   subject via `parseSubject` — removing the shared-handler ambiguity.
3. Remove the last 4 `as Record<string,unknown>` casts in the repo.

## Relation

- Blocks the "zero casts" completion of `event-subject-payload-build-tripwire`
  (which left these 4 casts as a documented exception).
- Touches the real-money path — warrants a brainstorm before implementation.
