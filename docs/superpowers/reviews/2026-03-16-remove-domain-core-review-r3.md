# Review Round 3: remove-domain-core Plan

**Plan:** `docs/superpowers/plans/2026-03-16-remove-domain-core.md`
**Reviewer:** Code Review Agent
**Date:** 2026-03-16
**Status:** 1 CRITICAL issue found

---

## Verification Summary

### 1. Consumer -> Producer Import Map vs Task 15 -- PASS

All 11 rows in the Consumer -> Producer Import Map header table match the corresponding Task 15 steps exactly:

| Consumer | Header "Imports From" | Task 15 Step | Match? |
|---|---|---|---|
| investor-bff | own + investor-ctrl + ledger-ctrl | Step 1 | YES |
| investor-ctrl | investor-bff + compliance-ctrl + execution-adpt + ledger-ctrl | Step 2 | YES |
| dashboard-bff | ledger-ctrl + reconciliation-ctrl + advisory-ctrl + compliance-ctrl | Step 3 | YES |
| advisory-ctrl | investor-bff + advisory-bff + compliance-ctrl + execution-adpt + reconciliation-ctrl | Step 4 | YES |
| advisory-bff | advisory-ctrl + compliance-ctrl | Step 5 | YES |
| compliance-ctrl | advisory-ctrl + investor-bff | Step 6 | YES |
| execution-ctrl | compliance-ctrl + advisory-bff + advisory-ctrl + investor-bff | Step 7 | YES |
| execution-adpt | execution-ctrl + investor-bff | Step 8 | YES |
| ledger-ctrl | execution-adpt + advisory-ctrl | Step 9 | YES |
| ledger-bff | ledger-ctrl | Step 10 | YES |
| reconciliation-ctrl | ledger-ctrl + execution-adpt | Step 11 | YES |

### 2. Schema Ownership Table vs Tasks 6, 8, 9, 10, 12 -- PASS

| Schema | Header Owner | Task Details | Match? |
|---|---|---|---|
| MandateGrantedSchema, GoalUpdatedSchema, etc. | investor-bff | Task 4 barrel | YES |
| DecisionPacketCreatedSchema, UserConfirmationRequestedSchema | advisory-ctrl | Task 6 barrel | YES |
| DecisionApprovedSchema, DecisionBlockedSchema | compliance-ctrl | Task 8 barrel | YES |
| OrderSubmittedSchema | execution-ctrl | Task 9 barrel | YES |
| OrderFilledSchema, DepositDetectedSchema | execution-adpt | Task 10 barrel | YES |
| PortfolioDriftDetectedSchema | reconciliation-ctrl | Task 12 barrel | YES |

### 3. Event-Listener Events vs Task 15 -- PASS

Verified advisory-ctrl and compliance-ctrl event-listener source files against plan. All event type strings in the actual code match the replacements listed in Task 15.

### 4. Test File Paths in Task 16 -- CRITICAL MISMATCH

**10 of 18 test file paths are WRONG.** The plan uses nested subdirectories (`handlers/`, `services/`, `repositories/`) but the actual files are flat in `test/`.

Only `investor-bff` has nested test dirs (`test/handlers/`, `test/repositories/`). All other services use flat `test/` structure.

**Wrong paths in the plan (left) vs actual paths (right):**

| # | Plan Path | Actual Path |
|---|---|---|
| 5 | `advisory-ctrl/test/handlers/event-listener.test.ts` | `advisory-ctrl/test/event-listener.test.ts` |
| 6 | `advisory-ctrl/test/services/decision-lifecycle.service.test.ts` | `advisory-ctrl/test/decision-lifecycle.service.test.ts` |
| 7 | `compliance-ctrl/test/repositories/compliance.repository.test.ts` | `compliance-ctrl/test/compliance.repository.test.ts` |
| 8 | `compliance-ctrl/test/handlers/event-listener.test.ts` | `compliance-ctrl/test/event-listener.test.ts` |
| 9 | `execution-ctrl/test/handlers/event-listener.test.ts` | `execution-ctrl/test/event-listener.test.ts` |
| 10 | `execution-ctrl/test/repositories/order.repository.test.ts` | `execution-ctrl/test/order.repository.test.ts` |
| 11 | `execution-ctrl/test/services/safety-checks.service.test.ts` | `execution-ctrl/test/safety-checks.service.test.ts` |
| 12 | `execution-ctrl/test/services/order-lifecycle.service.test.ts` | `execution-ctrl/test/order-lifecycle.service.test.ts` |
| 15 | `investor-ctrl/test/handlers/event-listener.test.ts` | `investor-ctrl/test/event-listener.test.ts` |
| 16 | `investor-ctrl/test/services/notification-lifecycle.service.test.ts` | `investor-ctrl/test/notification-lifecycle.service.test.ts` |
| 17 | `reconciliation-ctrl/test/handlers/event-listener.test.ts` | `reconciliation-ctrl/test/event-listener.test.ts` |
| 18 | `reconciliation-ctrl/test/services/reconciliation.service.test.ts` | `reconciliation-ctrl/test/reconciliation.service.test.ts` |

**Correct paths (8 already correct):**
- `advisory-bff/test/decision-packet-created.pipe.test.ts`
- `advisory-bff/test/advisory.repository.test.ts`
- `advisory-bff/test/decision-status-changed.pipe.test.ts`
- `advisory-bff/test/event-listener.test.ts`
- `investor-bff/test/handlers/event-listener.test.ts`
- `investor-bff/test/repositories/investor-profile.repository.test.ts`

---

## Verdict

The header tables (Consumer -> Producer Import Map, Schema Ownership) are fully consistent with the task details. The only remaining issue is **Task 16 test file paths** -- 10 paths have spurious subdirectories that do not exist on disk. An agentic worker following these paths literally will fail to find the files.
