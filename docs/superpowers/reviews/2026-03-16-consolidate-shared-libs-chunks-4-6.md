# Plan Review: Consolidate Shared Libraries -- Chunks 4-6 (Tasks 17-35)

**Reviewed by:** Code Review Agent
**Date:** 2026-03-16
**Plan:** `/Users/fabiovitali/WebstormProjects/nestfolio/docs/superpowers/plans/2026-03-16-consolidate-shared-libs.md`

---

## Chunk 4: Distribute events to publishing services (Tasks 17-25)

### 1. Domain Event Distribution Completeness

**Investor domain (Tasks 17-18):**

- The plan assigns `USER_CONFIRMED` and `USER_REJECTED` to advisory-bff (Task 20) but in domain-core these live under `AdvisoryEventTypes` in `advisory/events.ts`. However, in the plan's Publisher Map at line 93, they are correctly attributed to advisory-bff. This is consistent with publisher-owns-events.
- The plan's `InvestorBffEventTypes` (Task 17) has 23 events. Cross-referencing with `InvestorEventTypes` in domain-core: 23 investor-web + investor-bff events match exactly (the plan correctly excludes the 4 investor-ctrl events: NOTIFICATION_CREATED, NOTIFICATION_SENT, NOTIFICATION_DELIVERED, MONTHLY_REPORT_GENERATED, which go to Task 18).

VERDICT: **PASS**

**Advisory domain (Tasks 19-21):**

- `AdvisoryCtrlEventTypes` in Task 19 claims 33 events. Counting from the domain-core `AdvisoryEventTypes`: advisory-ctrl owns 15 events (AGENT_INVOCATION_STARTED through USER_REJECTED), but the plan says `USER_CONFIRMED` and `USER_REJECTED` go to advisory-bff (Task 20). That leaves 13 for advisory-ctrl from the top section. The plan also assigns all 20 "operations-ctrl" events (INCIDENT_DETECTED through EVENT_REPLAYED) to advisory-ctrl. 13 + 20 = 33. Correct.
- `AdvisoryBffEventTypes` (Task 20): USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION = 3 events. Correct.
- `ComplianceEventTypes` (Task 21): 8 events. Matches domain-core exactly.

VERDICT: **PASS**

**Execution domain (Tasks 22-23):**

- `ExecutionCtrlEventTypes` (Task 22): 4 events (ORDER_SUBMITTED, ORDER_STAGED, EXECUTION_PAUSED, EXECUTION_RESUMED). Matches domain-core `ExecutionEventTypes` exactly.
- `ExecutionAdptEventTypes` (Task 23): 15 events. Matches domain-core exactly.

VERDICT: **PASS**

**Ledger domain (Tasks 24-25):**

- `LedgerCtrlEventTypes` (Task 24): 5 events. Matches domain-core `LedgerEventTypes` (ledger-ctrl section).
- `ReconciliationEventTypes` (Task 25): 9 events. Matches domain-core `LedgerEventTypes` (reconciliation-ctrl section).

VERDICT: **PASS**

### 2. Schema Ownership

Cross-referencing with `domain-core/src/advisory/schemas.ts` exports:
- `DecisionApprovedSchema` and `DecisionBlockedSchema` are in advisory schemas but the plan correctly assigns them to compliance-ctrl (Task 21), since compliance-ctrl is the publisher of DECISION_APPROVED/DECISION_BLOCKED.

VERDICT: **PASS**

### 3. Missing Service: dashboard-bff has no domain folder

The plan has no Task creating `dashboard-bff/src/domain/`. Dashboard-bff is only a consumer, not a publisher, so it does not need a `domain/events.ts`. This is correct per publisher-owns-events.

VERDICT: **PASS** (no issue)

---

## Chunk 5: tsconfig aliases + rewire imports (Tasks 27-32)

### 4. Import Rewiring Accuracy -- platform-core (~60 files)

Verified actual platform-core imports in service source files. The plan's rule is correct: all `@nestfolio/platform-core` imports become `@nestfolio/event-processor`. Spot-checked:
- `ledger-ctrl/handlers/event-listener.ts`: imports `getTime, logger` -- both will be in event-processor barrel. OK.
- `ledger-ctrl/services/shadow-fill.service.ts`: imports `StaticMarketDataProvider, CachedMarketDataProvider` -- these are in the plan's market-data module (Task 8). OK.
- `ledger-bff/pipes/*.ts`: imports `Pipe, UnitOfWork, BusEvent, logger` -- all in platform barrel (Task 9). OK.
- `investor-bff/repositories/investor-profile.repository.ts`: imports `TableRepository, getUUID, getTime, NotRetryableError, TableEntry` -- all in event-processor barrel. OK.

VERDICT: **PASS**

### 5. Import Rewiring Accuracy -- lambda-utils (~36 files)

Verified actual lambda-utils imports. The plan's rule is correct.

CRITICAL ISSUE: **`guardedWrite` is missing from the plan's lambda barrel (Task 13) and event-processor module list.**

- `lambda-utils/src/index.ts` exports `guardedWrite` from `./guarded-write`.
- `execution-adpt/src/repositories/virtual-ledger.repository.ts` imports `{ withMethodLogging, guardedWrite }` from `@nestfolio/lambda-utils`.
- `dashboard-bff/src/repositories/dashboard.repository.ts` imports `{ withMethodLogging, guardedWrite }` from `@nestfolio/lambda-utils`.
- Task 10-13 never creates `guarded-write.ts` in event-processor, nor exports `guardedWrite`.

Similarly, **`extractTenantId`** is exported by lambda-utils and imported by event-processor internally (in `create-event-handler` pipeline). It needs to be available in the lambda barrel too.

And **`traceEvent`** is exported by lambda-utils (`export { traceEvent } from './trace-event'`). While no service source files currently import it directly (the event-processor pipeline uses it internally), it should still be migrated for completeness.

And **`parseRecord`** is exported by lambda-utils. No direct service imports found (event-processor has its own), so this is low priority.

VERDICT: **FAIL -- guardedWrite missing is a build-breaker for execution-adpt and dashboard-bff**

### 6. Import Rewiring Accuracy -- domain-core (~7 source files + 1 MFE)

Verified actual domain-core imports:
- `investor-bff/repositories/investor-profile.repository.ts`: imports `EntityNotFoundError` + 7 model types (Goal, RiskProfile, Mandate, OperatingMode, MandateLevel, RebalanceCadence, Notification). Plan Task 28 correctly says EntityNotFoundError -> event-processor, model types -> `../domain/models`. **BUT** the plan's investor-bff models.ts (Task 17 Step 3) needs to export `InvestorProfile` too. Checking: the plan barrel (Task 17 Step 4) exports `InvestorProfile, Goal, RiskProfile, Mandate, OperatingMode, MandateLevel, RebalanceCadence, Notification, NotificationChannel, NotificationStatus`. The repository imports `Goal, RiskProfile, Mandate, OperatingMode, MandateLevel, RebalanceCadence, Notification` -- all present. OK.
- `compliance-ctrl/rules/rule-engine.ts`: imports `MandateLevel`. Plan says -> `@nestfolio/investor-bff/domain`. Correct (MandateLevel is an investor model type).
- `execution-ctrl` (3 files): imports `ProposedTrade`. Plan says -> `@nestfolio/advisory-ctrl/domain`. Correct (ProposedTrade is in advisory models).
- `advisory-ctrl/services/decision-lifecycle.service.ts`: imports `ProposedTrade`. This should stay as `../domain/models` since advisory-ctrl owns it. Plan Task 28 says exactly this. OK.

CRITICAL ISSUE: **investor-mfe/src/app/services/onboarding.service.ts imports `Goal, Mandate, RiskProfile` from `@nestfolio/domain-core`.**

The plan's Task 30 mentions "investor-mfe onboarding service" but the Consumer -> Producer Import Map at line 100-114 does NOT list investor-mfe. Task 30 Step 1 says "Apply rewiring per the domain-core plan's Task 14 rules" but there is no Task 14 in this plan (Task 14 is "Create domain errors in event-processor"). This is a dangling reference. The actual rule should be: investor-mfe imports `Goal, Mandate, RiskProfile` from `@nestfolio/investor-bff/domain`.

Also, the 4 MFE jest.config.ts files (investor-mfe, dashboard-mfe, advisory-mfe, ledger-mfe) all have `@nestfolio/domain-core` moduleNameMapper entries that need removal (Task 34). The plan mentions services but not apps.

VERDICT: **FAIL -- investor-mfe rewiring rule unclear, Task 30 has dangling cross-reference**

### 7. Event-listener String Literal Replacements (Task 32)

**dashboard-bff (Step 3):** Plan says "leave INVESTOR_SNAPSHOT_UPDATED as string literal." However, `grep` found ZERO occurrences of `INVESTOR_SNAPSHOT_UPDATED` in the entire codebase. The dashboard-bff event-listener uses: BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED.

The plan's Consumer Import Map says dashboard-bff imports from `@nestfolio/ledger-ctrl/domain` + `@nestfolio/reconciliation-ctrl/domain` + `@nestfolio/advisory-ctrl/domain` + `@nestfolio/compliance-ctrl/domain`. But dashboard-bff also consumes investor-bff events (ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED). This is MISSING from the Consumer -> Producer Import Map.

**ledger-ctrl (Step 9):** Plan says "leave CORPORATE_ACTION_PROCESSED as string literal." Verified: `CORPORATE_ACTION_PROCESSED` appears in ledger-ctrl source (event-listener.ts:98, service.stack.ts:26, reducers/account.reducer.ts:43). No publisher owns this event -- correct to keep as string literal.

**reconciliation-ctrl (Step 11):** Plan says "leave CORPORATE_ACTION_APPLIED as string literal." But CORPORATE_ACTION_APPLIED IS in `ReconciliationEventTypes` in the plan's own Task 25. So it should NOT be a string literal -- it should use `ReconciliationEventTypes.CORPORATE_ACTION_APPLIED`. Wait -- reconciliation-ctrl IS the publisher of CORPORATE_ACTION_APPLIED, so it can use its OWN domain constant. The plan should say "use own ReconciliationEventTypes.CORPORATE_ACTION_APPLIED."

VERDICT: **FAIL -- dashboard-bff missing `@nestfolio/investor-bff/domain` from Consumer Import Map; CORPORATE_ACTION_APPLIED should not stay as string literal in reconciliation-ctrl**

### 8. jest.config.js moduleNameMapper Paths (Task 34)

The plan says for service domain aliases:
```
'^@nestfolio/<producer>/domain$': '<rootDir>/../../../services/<domain>/<producer>/src/domain/index.ts'
```

Services are at depth 3 from project root: `services/<domain>/<service>/`. The `<rootDir>` in a service jest.config is `services/<domain>/<service>/`. So `<rootDir>/../../../` resolves to the project root. Then `services/<domain>/<producer>/src/domain/index.ts` is correct.

Verified with investor-bff jest.config.js: `<rootDir>` = `services/investor/investor-bff/`, `<rootDir>/../../../` = project root. Path `services/investor/investor-ctrl/src/domain/index.ts` from root is valid.

HOWEVER: The plan does not mention updating the 4 MFE apps' jest.config.ts files (apps/investor-mfe, apps/dashboard-mfe, apps/advisory-mfe, apps/ledger-mfe). These are at depth 1 (`apps/<mfe>/`), so they use `<rootDir>/../../` to reach root. They all currently have `@nestfolio/domain-core` mappings that must be removed and replaced with the new service domain mappings.

VERDICT: **FAIL -- MFE app jest.config.ts files not covered by Task 34**

---

## Chunk 6: Fix test mocks + delete libraries (Tasks 33-35)

### 9. Test Mock Removal (Task 33)

The plan says the pattern is `jest.mock('@nestfolio/platform-core', () => ({}))`. But the actual mocks are NOT empty objects -- they are complex factory functions returning mock implementations:
```typescript
jest.mock('@nestfolio/platform-core', () => ({
  TableRepository: class { ... },
  getUUID: jest.fn(() => 'mock-uuid'),
  ...
}));
```

The plan says "delete lines matching" -- but these are multi-line mock blocks, not single lines. The implementer needs to delete the entire `jest.mock(...)` call, which can span 30+ lines. The plan should clarify this is a multi-line block removal, not a single-line deletion.

Also, the counts are off:
- Plan says: 47 platform-core, 47 lambda-utils, 24 domain-core
- Actual: 53 platform-core, 47 lambda-utils, 18 domain-core

The platform-core count (53 vs 47) and domain-core count (18 vs 24) are inaccurate.

HOWEVER: after removing the mocks, tests will likely break because:
- Tests that use `jest.mock('@nestfolio/platform-core', ...)` with factory functions are providing mock implementations of `TableRepository`, `getUUID`, `getTime`, `logger`, etc.
- Once imports switch to `@nestfolio/event-processor`, these mocks need to become `jest.mock('@nestfolio/event-processor', ...)` instead, NOT be deleted.
- The `createHandler(deps)` pattern may already inject dependencies for some services, but the mocks for `getUUID`, `getTime`, `logger` in many test files are module-level mocks that cannot simply be removed.

This is the plan's most significant gap. Removing mocks without replacing them will cause test failures.

VERDICT: **FAIL -- mocks are multi-line blocks with factory functions, not empty stubs; removing them without replacement will break tests; counts are inaccurate**

### 10. jest.config.js Updates (Task 34)

Covered above in item 8. The relative paths for services are correct (`<rootDir>/../../../`). The MFE apps gap remains.

VERDICT: **PASS for services, FAIL for apps**

### 11. Library Deletion (Task 35)

The plan correctly removes tsconfig path aliases and deletes directories. No issues found here.

VERDICT: **PASS**

### 12. Edge Case: command-core imports Result (Task 31)

`command-core/src/command.ts` imports `{ type Result, ok, err }` from `@nestfolio/platform-core`. The plan switches this to `@nestfolio/event-processor`. The event-processor barrel (Task 9) exports `Result, ok, err` from `platform/fp/result.ts`. This is correct.

VERDICT: **PASS**

### 13. Edge Case: cdk-constructs EVENT_PUBLISHER_ENTRY (Task 29)

`cdk-constructs/src/egress.ts` imports `EVENT_PUBLISHER_ENTRY` from `@nestfolio/lambda-utils`. The plan switches to `@nestfolio/event-processor`. The lambda barrel (Task 13) exports `EVENT_PUBLISHER_ENTRY`. Correct.

BUT: `EVENT_PUBLISHER_ENTRY` uses `join(__dirname, 'event-publisher.ts')`. When this runs from `event-processor/src/lambda/index.ts`, `__dirname` will point to `event-processor/src/lambda/`. This means `event-publisher.ts` must be at that path -- Task 12 creates it at `event-processor/src/lambda/event-publisher.ts`. Correct.

VERDICT: **PASS**

---

## Summary

| # | Check | Verdict |
|---|-------|---------|
| 1 | Event distribution completeness | PASS |
| 2 | Schema ownership | PASS |
| 3 | dashboard-bff no domain folder needed | PASS |
| 4 | platform-core import rewiring | PASS |
| 5 | lambda-utils import rewiring | FAIL -- `guardedWrite` missing |
| 6 | domain-core import rewiring | FAIL -- investor-mfe rule unclear |
| 7 | Event-listener string literals | FAIL -- dashboard-bff Consumer Map incomplete; CORPORATE_ACTION_APPLIED wrong |
| 8 | jest.config.js paths | FAIL -- MFE apps not covered |
| 9 | Test mock removal | FAIL -- multi-line mocks, counts wrong, removal will break tests |
| 10 | jest.config.js updates | PASS for services, FAIL for apps |
| 11 | Library deletion | PASS |
| 12 | command-core Result | PASS |
| 13 | cdk-constructs EVENT_PUBLISHER_ENTRY | PASS |

## Critical Issues (must fix before execution)

1. **`guardedWrite` not migrated to event-processor** (Chunk 2 gap, breaks Chunk 5). Add `libs/event-processor/src/lambda/guarded-write.ts` (copy from lambda-utils), export from lambda barrel (Task 13), and export from event-processor barrel.

2. **Test mock removal strategy is wrong** (Task 33). The mocks are multi-line factory functions, not empty stubs. Simply deleting them will cause test failures. The plan should either:
   - (a) Change mocks to `jest.mock('@nestfolio/event-processor', ...)` with the same factories, OR
   - (b) Confirm that all tests use `createHandler(deps)` / `createResolver(deps)` DI pattern and genuinely do not need module-level mocks.
   Current evidence shows many test files still use complex `jest.mock` factories for platform-core, so option (a) is likely needed.

3. **Consumer Import Map incomplete for dashboard-bff**. Dashboard-bff also consumes 5 investor-bff events (ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED). Add `@nestfolio/investor-bff/domain` to dashboard-bff's consumer imports (Task 32 Step 3).

## Important Issues (should fix)

4. **MFE apps jest.config.ts not covered by Task 34**. Four apps (investor-mfe, dashboard-mfe, advisory-mfe, ledger-mfe) have `@nestfolio/domain-core` moduleNameMapper entries. Add them to Task 34 scope. Path pattern for apps: `<rootDir>/../../services/<domain>/<service>/src/domain/index.ts`.

5. **investor-mfe import rewiring** (Task 30). The "Task 14 rules" cross-reference is wrong (Task 14 in THIS plan is domain errors). Explicitly state: `onboarding.service.ts` should import `Goal, Mandate, RiskProfile` from `@nestfolio/investor-bff/domain`.

6. **CORPORATE_ACTION_APPLIED in reconciliation-ctrl** (Task 32 Step 11). This event IS owned by reconciliation-ctrl (Task 25). The event-listener should use its own typed constant, not a string literal.

7. **INVESTOR_SNAPSHOT_UPDATED phantom event** (Task 32 Step 3). This event does not exist in the codebase. Remove the "leave as string literal" instruction.

## Suggestions (nice to have)

8. **Test mock counts are inaccurate** (Task 33). Plan says 47/47/24; actual is 53/47/18. Update the counts to match reality.

9. **`extractTenantId` and `traceEvent`** from lambda-utils should also be migrated to event-processor for completeness, even if not directly imported by services (they may be used by event-processor internally or needed for future use).
