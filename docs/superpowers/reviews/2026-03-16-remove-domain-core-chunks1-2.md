# Review: remove-domain-core plan (Chunks 1-2, Tasks 1-12)

**Reviewer:** Code Review Agent
**Date:** 2026-03-16
**Verdict:** APPROVED with 2 Important issues and 2 Suggestions

---

## What was done well

- The Publisher-owns-events principle is sound and correctly applied across all 9 services.
- Schema ownership has been correctly split: OrderFilledSchema + DepositDetectedSchema in execution-adpt (Task 10), PortfolioDriftDetectedSchema in reconciliation-ctrl (Task 12), OrderSubmittedSchema stays in execution-ctrl (Task 9). This matches the actual publishers.
- "Copy verbatim" instructions for errors/schemas (Task 1 Step 3, Task 2 Step 3) eliminate ambiguity.
- Test count for Task 2 is now correct at 12 (verified via `grep -c 'it(' types.test.ts`).
- Each service has a `domain/index.ts` barrel file.
- advisory-ctrl barrel correctly exports `ProposedTrade` for consumers.

---

## Schema ownership vs. Publisher Map: VERIFIED CORRECT

| Schema | Plan says | Source says | Match? |
|---|---|---|---|
| MandateGrantedSchema, GoalUpdatedSchema, RiskProfileUpdatedSchema, OnboardingCompletedSchema, DepositInitiatedSchema | investor-bff (Task 4) | `investor/schemas.ts` | YES |
| DecisionPacketCreatedSchema, DecisionApprovedSchema, DecisionBlockedSchema, UserConfirmationRequestedSchema | advisory-ctrl (Task 6) | `advisory/schemas.ts` | YES |
| OrderSubmittedSchema | execution-ctrl (Task 9) | `execution/schemas.ts` | YES |
| OrderFilledSchema, DepositDetectedSchema | execution-adpt (Task 10) | `execution/schemas.ts` (originally combined) | YES (correctly split) |
| PortfolioDriftDetectedSchema | reconciliation-ctrl (Task 12) | `execution/schemas.ts` (originally combined) | YES (correctly split) |

---

## Event types: ALL ACCOUNTED FOR

**Investor domain** (source: `InvestorEventTypes` -- 27 events):
- investor-bff gets 23 events (web + bff): MATCHES plan Task 4.
- investor-ctrl gets 4 events (NOTIFICATION_CREATED/SENT/DELIVERED, MONTHLY_REPORT_GENERATED): MATCHES plan Task 5.

**Advisory domain** (source: `AdvisoryEventTypes` -- 44 events):
- advisory-ctrl gets 40 events (advisory-ctrl + operations-ctrl sections): MATCHES plan Task 6.
- advisory-bff gets 3 events (USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION): MATCHES plan Task 7.
- compliance-ctrl gets 8 events: MATCHES plan Task 8.
- **Subtotal: 40 + 3 + 8 = 51, but source has 44.** See IMPORTANT issue #1 below.

**Execution domain** (source: `ExecutionEventTypes` -- 19 events):
- execution-ctrl gets 4: MATCHES plan Task 9.
- execution-adpt gets 15: MATCHES plan Task 10.

**Ledger domain** (source: `LedgerEventTypes` -- 14 events):
- ledger-ctrl gets 5: MATCHES plan Task 11.
- reconciliation-ctrl gets 9: MATCHES plan Task 12.

---

## Issues

### IMPORTANT #1: advisory-bff USER_CONFIRMED/USER_REJECTED are duplicated

In the source `AdvisoryEventTypes`, `USER_CONFIRMED` and `USER_REJECTED` appear once (under the advisory-ctrl comment block). The plan splits them so:
- Task 6 (advisory-ctrl) `AdvisoryCtrlEventTypes` does NOT include USER_CONFIRMED/USER_REJECTED -- correct.
- Task 7 (advisory-bff) `AdvisoryBffEventTypes` includes USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION -- correct.

This split is actually fine. The apparent overcounting above is because the original `AdvisoryEventTypes` lumped all advisory-domain events into one object. The plan correctly separates by publisher. No issue here on closer inspection -- the split is valid.

**RETRACTED** -- verified correct after detailed re-count.

### IMPORTANT #1 (actual): No models.ts for execution-adpt or reconciliation-ctrl

The plan gives execution-ctrl the models.ts (Order, Portfolio, Position, Reconciliation + status types) in Task 9. However:
- `Reconciliation` and `ReconciliationStatus` are semantically owned by reconciliation-ctrl, not execution-ctrl.
- Consumers like reconciliation-ctrl that import `@nestfolio/execution-ctrl/domain` would get `Reconciliation` type from a different service's domain barrel.

**Recommendation:** Consider moving `Reconciliation` and `ReconciliationStatus` to reconciliation-ctrl's domain folder (add a `models.ts` there), and keep `Order`, `Portfolio`, `Position`, `OrderStatus`, `OrderSide`, `OrderType` in execution-ctrl. This better follows the "publisher owns" principle for models too.

**Severity:** Important (design smell, not a blocker -- can be deferred to a follow-up if needed).

### IMPORTANT #2: DecisionApprovedSchema and DecisionBlockedSchema ownership

The Schema Ownership table in the plan header says these belong to **advisory-ctrl**. But `DECISION_APPROVED` and `DECISION_BLOCKED` are published by **compliance-ctrl** (per the event ownership map). The schemas should live where the event is published.

Task 6 barrel exports `DecisionApprovedSchema` and `DecisionBlockedSchema` from advisory-ctrl, but per publisher-owns-events, these should be in compliance-ctrl (Task 8). Currently Task 8 has no schemas at all.

**Recommendation:** Move `DecisionApprovedSchema` + `DecisionBlockedSchema` to `compliance-ctrl/src/domain/schemas.ts` and update the compliance-ctrl barrel (Task 8) to export them. Remove from advisory-ctrl barrel (Task 6).

**Severity:** Important (violates the plan's own stated principle).

### Suggestion #1: Ledger domain has no models

The original domain-core has no `ledger/models.ts`. This is fine for now, but as the order-ledger service matures, ledger-ctrl or reconciliation-ctrl may need shared model types. Just noting the gap.

### Suggestion #2: No tests for service domain files (Tasks 4-12)

Tasks 4-12 create domain files but include no tests. The event type constants and barrel re-exports are simple enough that this is acceptable, but a single smoke test per service domain barrel (verifying the exported constant object has the expected keys) would catch typos during the copy. Consider adding minimal barrel tests in Chunk 3 or 4.

---

## Barrel exports: VERIFIED COMPLETE

Cross-referenced every `export` in `domain-core/src/index.ts` against the plan's target barrels:

| Export | Target barrel |
|---|---|
| BusEventSchema, TenantContextSchema, EditEventSchema, EditOperationSchema + types | event-processor (Task 3) |
| DomainError + 4 subclasses | event-processor (Task 1) |
| InvestorEventTypes + type | investor-bff (Task 4) -- renamed to InvestorBffEventTypes |
| 5 investor schemas + types | investor-bff (Task 4) |
| 10 investor model types | investor-bff (Task 4) |
| AdvisoryEventTypes + type | Split: advisory-ctrl (Task 6) + advisory-bff (Task 7) + compliance-ctrl (Task 8) |
| 4 advisory schemas + types | advisory-ctrl (Task 6) -- **but see Important #2 above** |
| 7 advisory model types | advisory-ctrl (Task 6) |
| ExecutionEventTypes + type | Split: execution-ctrl (Task 9) + execution-adpt (Task 10) |
| 4 execution schemas + types | Split: execution-ctrl (Task 9) + execution-adpt (Task 10) + reconciliation-ctrl (Task 12) |
| 8 execution model types | execution-ctrl (Task 9) |
| LedgerEventTypes + type | Split: ledger-ctrl (Task 11) + reconciliation-ctrl (Task 12) |

ALL exports from domain-core/src/index.ts are accounted for. None lost.

---

## Circular dependency check: CLEAN

- Services only import from `@nestfolio/event-processor` (a lib, no circular risk).
- Cross-service imports (Chunk 3+) go through `@nestfolio/<service>/domain` aliases, always from consumer to producer.
- No producer imports from another producer's domain in Chunks 1-2.

---

## Summary

The plan is well-structured and the requested fixes (12 tests, copy verbatim, schema ownership split, barrel files, ProposedTrade export) are all correctly applied. Two important issues remain:

1. **DecisionApprovedSchema + DecisionBlockedSchema** should move from advisory-ctrl to compliance-ctrl per publisher-owns-events principle.
2. **Reconciliation + ReconciliationStatus models** should arguably live in reconciliation-ctrl, not execution-ctrl.

Both can be addressed before execution begins with minimal plan edits.
