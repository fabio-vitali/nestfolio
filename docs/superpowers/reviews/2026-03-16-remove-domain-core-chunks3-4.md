# Review: remove-domain-core Plan — Chunks 3-4 (Tasks 13-17)

**Reviewer:** Code Review Agent
**Date:** 2026-03-16
**Plan:** `docs/superpowers/plans/2026-03-16-remove-domain-core.md`

---

## Task 13: tsconfig aliases — PASS

All 9 publisher services covered. Paths verified against actual directory structure:

| Alias | Actual Path | Exists |
|---|---|---|
| `@nestfolio/investor-bff/domain` | `services/investor/investor-bff/src/domain/index.ts` | Will be created in Task 4 |
| `@nestfolio/investor-ctrl/domain` | `services/investor/investor-ctrl/src/domain/index.ts` | Will be created in Task 5 |
| `@nestfolio/advisory-ctrl/domain` | `services/advisory/advisory-ctrl/src/domain/index.ts` | Will be created in Task 6 |
| `@nestfolio/advisory-bff/domain` | `services/advisory/advisory-bff/src/domain/index.ts` | Will be created in Task 7 |
| `@nestfolio/compliance-ctrl/domain` | `services/advisory/compliance-ctrl/src/domain/index.ts` | Will be created in Task 8 |
| `@nestfolio/execution-ctrl/domain` | `services/execution/execution-ctrl/src/domain/index.ts` | Will be created in Task 9 |
| `@nestfolio/execution-adpt/domain` | `services/execution/execution-adpt/src/domain/index.ts` | Will be created in Task 10 |
| `@nestfolio/ledger-ctrl/domain` | `services/ledger/ledger-ctrl/src/domain/index.ts` | Will be created in Task 11 |
| `@nestfolio/reconciliation-ctrl/domain` | `services/ledger/reconciliation-ctrl/src/domain/index.ts` | Will be created in Task 12 |

**Verdict:** Correct. All 9 aliases match the service directory layout.

---

## Task 14: Source imports — PASS (with 1 important finding)

Cross-referenced the plan against actual `grep -rn '@nestfolio/domain-core'` results:

| File | Plan says | Actual import | Correct? |
|---|---|---|---|
| `investor-bff/.../investor-profile.repository.ts` | EntityNotFoundError + model types | Lines 9+18: `EntityNotFoundError` + `Goal, RiskProfile, Mandate, OperatingMode, MandateLevel, RebalanceCadence, Notification` | YES |
| `advisory-ctrl/.../decision-lifecycle.service.ts` | ProposedTrade | Line 3: `ProposedTrade` | YES |
| `compliance-ctrl/.../compliance.repository.ts` | EntityNotFoundError | Line 5: `EntityNotFoundError` | YES |
| `compliance-ctrl/.../rule-engine.ts` | MandateLevel | Line 1: `MandateLevel` | YES |
| `execution-ctrl/.../order.repository.ts` | ProposedTrade | Line 5: `ProposedTrade` | YES |
| `execution-ctrl/.../order-lifecycle.service.ts` | ProposedTrade | Line 3: `ProposedTrade` | YES |
| `execution-ctrl/.../safety-checks.service.ts` | ProposedTrade | Line 3: `ProposedTrade` | YES |
| `apps/investor-mfe/.../onboarding.service.ts` | Goal, Mandate, RiskProfile | Line 10: `Goal, Mandate, RiskProfile` | YES |

**Verdict:** All 9 import sites (8 files, investor-bff has 2 import lines) are correctly identified. The replacement targets are appropriate.

**Note:** The plan header lists only 8 files but the count of "9 files" in the task title is because it counts "investor-bff repository" as having 2 import rewiring operations, which is fair since the EntityNotFoundError goes to event-processor while models go to local `../domain/models`.

---

## Task 15: Event-listener rewiring — IMPORTANT ISSUES FOUND

### Verified event types per consumer:

**Step 1 — investor-bff:** Handles `USER_REGISTERED`, `NOTIFICATION_CREATED`, `BALANCE_UPDATED`.
- Plan maps: own events + investor-ctrl + ledger-ctrl. **CORRECT.**

**Step 2 — investor-ctrl:** Handles `ONBOARDING_COMPLETED, MANDATE_GRANTED, GOAL_UPDATED, DEPOSIT_INITIATED, OPERATING_MODE_CHANGED, DECISION_APPROVED, ORDER_FILLED, BALANCE_UPDATED` (Set-based routing).
- Plan maps: investor-bff + compliance-ctrl + execution-adpt + ledger-ctrl.
- **ISSUE (Important):** `DECISION_APPROVED` comes from compliance-ctrl (ComplianceEventTypes). Plan says `ComplianceEventTypes.DECISION_APPROVED`. **CORRECT.**
- `ORDER_FILLED` comes from execution-adpt. Plan says `ExecutionAdptEventTypes.ORDER_FILLED`. **CORRECT.**
- `BALANCE_UPDATED` comes from ledger-ctrl. **CORRECT.**
- The 5 investor-bff events: ONBOARDING_COMPLETED, MANDATE_GRANTED, GOAL_UPDATED, DEPOSIT_INITIATED, OPERATING_MODE_CHANGED. **CORRECT.**

**Step 3 — dashboard-bff:** Uses pipe-map pattern with keys `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `ADVISORY_STATUS_CHANGED`, `INVESTOR_SNAPSHOT_CHANGED`, `TIME_TRAVEL_AVAILABLE` (and others from positional/recentActivity/timeTravelAvailability pipes).
- Plan says: import only LedgerCtrlEventTypes for BALANCE_UPDATED and PORTFOLIO_UPDATED.
- **ISSUE (Important):** The dashboard-bff `EVENT_PIPE_MAP` keys are string literals in the object literal (not in switch/case). The plan needs to clarify that these keys in `EVENT_PIPE_MAP` should also be replaced: `BALANCE_UPDATED` -> `[LedgerCtrlEventTypes.BALANCE_UPDATED]` and `PORTFOLIO_UPDATED` -> `[LedgerCtrlEventTypes.PORTFOLIO_UPDATED]`. Using typed constants as computed property keys requires `[LedgerCtrlEventTypes.BALANCE_UPDATED]:` syntax. The plan does not show this computed-property-key syntax — the agent might miss this detail.

**Step 4 — advisory-ctrl:** Handles via Set + if/else: `MANDATE_GRANTED, GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED`.
- Plan says: investor-bff + advisory-bff + compliance-ctrl.
- **ISSUE (Critical):** The plan is MISSING several producer imports:
  - `PORTFOLIO_DRIFT_DETECTED` comes from reconciliation-ctrl, but the plan does not include `@nestfolio/reconciliation-ctrl/domain`.
  - `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED` come from execution-adpt, but the plan does not include `@nestfolio/execution-adpt/domain`.
  - `GOAL_UPDATED`, `OPERATING_MODE_CHANGED` come from investor-bff (already included).
  - The Consumer -> Producer Import Map in the plan header ALSO does not list execution-adpt or reconciliation-ctrl for advisory-ctrl.
  - Only the 6 events listed in the plan (MANDATE_GRANTED, RISK_PROFILE_UPDATED, USER_CONFIRMED, USER_REJECTED, DECISION_APPROVED, DECISION_BLOCKED) are covered — the other 7 event types handled by advisory-ctrl are not addressed.

**Step 5 — advisory-bff:** Handles `DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED`.
- Plan says: advisory-ctrl + compliance-ctrl.
- `DECISION_PACKET_CREATED`, `DECISION_PACKET_ENRICHED`, `USER_CONFIRMATION_REQUESTED` from advisory-ctrl. **CORRECT.**
- `DECISION_APPROVED`, `DECISION_BLOCKED` from compliance-ctrl. **CORRECT.**

**Step 6 — compliance-ctrl:** Handles via Set + switch: `DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED` and `MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_CHANGED`.
- Plan says: import only investor-bff.
- **ISSUE (Critical):** `DECISION_PACKET_CREATED` and `DECISION_PACKET_ENRICHED` come from advisory-ctrl, but the plan does not include `@nestfolio/advisory-ctrl/domain`. The compliance-ctrl handler explicitly registers handlers for these two advisory-ctrl event types. The Consumer -> Producer Import Map in the header also does not list advisory-ctrl for compliance-ctrl.
- The 4 mandate/mode events correctly come from investor-bff.

**Step 7 — execution-ctrl:** Handles `DECISION_APPROVED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, ACCOUNT_CLOSURE_REQUESTED`.
- Plan says: compliance-ctrl + advisory-bff + advisory-ctrl + investor-bff. **CORRECT.**
- `DECISION_APPROVED` from compliance-ctrl. **CORRECT.**
- `USER_CONFIRMED` from advisory-bff. **CORRECT.**
- `CIRCUIT_BREAKER_TRIGGERED/RESET` from advisory-ctrl. **CORRECT.**
- `ACCOUNT_CLOSURE_REQUESTED` from investor-bff. **CORRECT.**

**Step 8 — execution-adpt:** Handles `ORDER_SUBMITTED, WITHDRAWAL_REQUESTED, DEPOSIT_INITIATED`.
- Plan says: execution-ctrl + investor-bff.
- `ORDER_SUBMITTED` from execution-ctrl. **CORRECT.**
- `WITHDRAWAL_REQUESTED` from investor-bff. **CORRECT.**
- **ISSUE (Important):** `DEPOSIT_INITIATED` from investor-bff is handled but NOT listed in the plan's replacement list (Step 8 only lists ORDER_SUBMITTED and WITHDRAWAL_REQUESTED). The agent needs to also replace `'DEPOSIT_INITIATED'` with `InvestorBffEventTypes.DEPOSIT_INITIATED`.

**Step 9 — ledger-ctrl:** Handles `ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_PROCESSED, DECISION_PACKET_CREATED`.
- Plan says: execution-adpt + advisory-ctrl. Covers 7 of 8 event types.
- `CORPORATE_ACTION_PROCESSED` stays as string literal. **CORRECT.**
- **ISSUE (Important):** `WITHDRAWAL_COMPLETED` comes from execution-adpt (ExecutionAdptEventTypes.WITHDRAWAL_COMPLETED). The plan correctly lists it. **OK after re-reading.** Plan Step 9 lists it. **CORRECT.**

**Step 10 — ledger-bff:** Handles `BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED`.
- Plan says: import execution-adpt for ORDER_FILLED and ORDER_PARTIALLY_FILLED.
- **ISSUE (Critical):** The plan says ledger-bff consumes `ORDER_FILLED` and `ORDER_PARTIALLY_FILLED` from execution-adpt. But the ACTUAL ledger-bff event-listener handles `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, and `LEDGER_ENTRY_RECORDED` — these are ledger-ctrl events, NOT execution-adpt events. The Consumer -> Producer Import Map in the header says `@nestfolio/execution-adpt/domain` for ledger-bff, which is WRONG.
- The correct import should be: `@nestfolio/ledger-ctrl/domain` for `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `LEDGER_ENTRY_RECORDED`.

**Step 11 — reconciliation-ctrl:** Handles `PORTFOLIO_UPDATED, PORTFOLIO_SNAPSHOT_IMPORTED, CORPORATE_ACTION_APPLIED`.
- Plan says: ledger-ctrl + execution-adpt.
- `PORTFOLIO_UPDATED` from ledger-ctrl. **CORRECT.**
- `PORTFOLIO_SNAPSHOT_IMPORTED` from execution-adpt. **CORRECT.**
- `CORPORATE_ACTION_APPLIED` stays as string literal. Plan says so. **CORRECT.**

---

## Task 16: Test mocks — IMPORTANT ISSUE

Plan lists 18 test files. Actual grep finds exactly 18 matches. However:

**ISSUE (Important):** The plan lists test file paths using NESTED subdirectory structure for advisory-bff:
- `services/advisory/advisory-bff/test/pipes/decision-packet-created.pipe.test.ts`
- `services/advisory/advisory-bff/test/repositories/advisory.repository.test.ts`
- `services/advisory/advisory-bff/test/pipes/decision-status-changed.pipe.test.ts`
- `services/advisory/advisory-bff/test/handlers/event-listener.test.ts`

But the ACTUAL test files are in a FLAT structure (no subdirectories):
- `services/advisory/advisory-bff/test/decision-packet-created.pipe.test.ts`
- `services/advisory/advisory-bff/test/advisory.repository.test.ts`
- `services/advisory/advisory-bff/test/decision-status-changed.pipe.test.ts`
- `services/advisory/advisory-bff/test/event-listener.test.ts`

All 4 advisory-bff paths in the plan are WRONG. The agent will fail to find these files if following paths literally.

Similarly, check other services' test paths — some use nested structure (investor-bff uses `test/repositories/` and `test/handlers/`), others are flat. The plan must match actual paths exactly.

Services with FLAT test structure (no subdirs):
- advisory-bff: test/*.test.ts (PLAN IS WRONG for all 4 files)
- advisory-ctrl: test/*.test.ts (plan says `test/handlers/` and `test/services/` — verify)
- compliance-ctrl: test/*.test.ts (plan says flat — verify)
- execution-ctrl: test/*.test.ts (plan says `test/handlers/`, `test/repositories/`, `test/services/` — verify)

---

## Task 17: Delete domain-core — PASS

- Removes `@nestfolio/domain-core` and `@nestfolio/domain-core/*` from tsconfig.base.json paths. **CORRECT** (both entries exist).
- Deletes `libs/domain-core/` directory. **CORRECT.**
- No additional cleanup needed — all import rewiring done in Tasks 14-16.

---

## Cross-service type imports via aliases — PASS (no circular deps)

- `execution-ctrl` imports `ProposedTrade` from `@nestfolio/advisory-ctrl/domain`: This is a downstream consumer importing a type from an upstream producer. execution-ctrl depends on advisory-ctrl's decisions — no circularity.
- `compliance-ctrl` imports `MandateLevel` from `@nestfolio/investor-bff/domain`: compliance-ctrl consumes investor profile data to make compliance decisions. No circularity.
- These are type-only imports (`import type`), so they have zero runtime dependency — they only exist at compile time. Even if there were a circular runtime dependency, type-only imports would not cause it.

---

## Summary of Issues

### Critical (must fix before execution)

1. **Task 15, Step 4 (advisory-ctrl):** Missing imports from `@nestfolio/execution-adpt/domain` (ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED) and `@nestfolio/reconciliation-ctrl/domain` (PORTFOLIO_DRIFT_DETECTED). The Consumer -> Producer Import Map header table must also be updated.

2. **Task 15, Step 6 (compliance-ctrl):** Missing import from `@nestfolio/advisory-ctrl/domain` (DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED). The Consumer -> Producer Import Map header table must also be updated.

3. **Task 15, Step 10 (ledger-bff):** Plan says ledger-bff consumes ORDER_FILLED/ORDER_PARTIALLY_FILLED from execution-adpt, but actual code consumes BALANCE_UPDATED/PORTFOLIO_UPDATED/LEDGER_ENTRY_RECORDED from ledger-ctrl. The entire step is wrong. Consumer -> Producer Import Map header must be corrected to `@nestfolio/ledger-ctrl/domain`.

### Important (should fix)

4. **Task 15, Step 8 (execution-adpt):** Missing `DEPOSIT_INITIATED` in the replacement list — it should also be replaced with `InvestorBffEventTypes.DEPOSIT_INITIATED`.

5. **Task 15, Step 3 (dashboard-bff):** Plan should clarify computed-property-key syntax for `EVENT_PIPE_MAP` keys: `[LedgerCtrlEventTypes.BALANCE_UPDATED]:` instead of bare string keys.

6. **Task 16 (test file paths):** All 4 advisory-bff test file paths use wrong nested subdirectory format. Actual paths are flat: `test/decision-packet-created.pipe.test.ts`, etc. Verify and fix all other service test paths against actual directory layout.

### Suggestions (nice to have)

7. The advisory-ctrl consumer -> producer map should also account for `GOAL_UPDATED` and `OPERATING_MODE_CHANGED` (from investor-bff — already included) in the explicit replacement list, to make the plan exhaustive.
