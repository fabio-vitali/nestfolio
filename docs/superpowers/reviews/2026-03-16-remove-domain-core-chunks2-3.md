# Review: remove-domain-core plan (Chunks 2-3, Tasks 4-18)

**Reviewer:** Claude Opus 4.6
**Date:** 2026-03-16
**Status:** Approved with required fixes

---

## What was done well

- Publisher-owns-events principle is correctly applied throughout.
- Event type distribution in Chunk 2 (Tasks 4-12) correctly splits the monolithic `AdvisoryEventTypes` / `InvestorEventTypes` / `ExecutionEventTypes` objects by publishing service.
- Cross-service type handling for `ProposedTrade` and `MandateLevel` is well thought out: inline in consumers rather than creating cross-domain imports.
- `EntityNotFoundError` correctly moves to event-processor (shared infrastructure).

---

## Critical (must fix)

### C1: 13 test files with `jest.mock('@nestfolio/domain-core')` are NOT listed in Chunk 3

The plan lists 9 source-code import sites but completely ignores **13 test files** that mock `@nestfolio/domain-core`. After domain-core is deleted (Task 18), these tests will fail at module resolution time.

Affected test files:
- `services/investor/investor-bff/test/repositories/investor-profile.repository.test.ts` (mocks EntityNotFoundError)
- `services/investor/investor-bff/test/handlers/event-listener.test.ts`
- `services/investor/investor-ctrl/test/event-listener.test.ts`
- `services/investor/investor-ctrl/test/notification-lifecycle.service.test.ts`
- `services/advisory/advisory-ctrl/test/event-listener.test.ts`
- `services/advisory/advisory-ctrl/test/decision-lifecycle.service.test.ts`
- `services/advisory/advisory-bff/test/decision-packet-created.pipe.test.ts`
- `services/advisory/advisory-bff/test/advisory.repository.test.ts`
- `services/advisory/advisory-bff/test/decision-status-changed.pipe.test.ts`
- `services/advisory/advisory-bff/test/event-listener.test.ts`
- `services/advisory/compliance-ctrl/test/compliance.repository.test.ts` (mocks EntityNotFoundError)
- `services/advisory/compliance-ctrl/test/event-listener.test.ts`
- `services/execution/execution-ctrl/test/event-listener.test.ts`
- `services/execution/execution-ctrl/test/order.repository.test.ts`
- `services/execution/execution-ctrl/test/safety-checks.service.test.ts`
- `services/execution/execution-ctrl/test/order-lifecycle.service.test.ts`
- `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`
- `services/ledger/reconciliation-ctrl/test/reconciliation.service.test.ts`

**Fix:** Add a task (or expand Tasks 13-17) to update each `jest.mock('@nestfolio/domain-core', ...)` call:
- Tests that mock `EntityNotFoundError` must change to `jest.mock('@nestfolio/event-processor', ...)` (or remove the mock if `EntityNotFoundError` is now a real import).
- Tests that mock with empty `() => ({})` should simply **delete the mock line** since the source files no longer import from domain-core.

### C2: `InvestorEventTypes` in the plan includes events from investor-web

Task 4 assigns `USER_REGISTERED`, `USER_AUTHENTICATED`, `USER_SESSION_EXPIRED` to investor-bff. The original domain-core file tags these as "investor-web (Cognito triggers)". If investor-web is a separate service (Cognito trigger Lambda), these events belong to investor-web, not investor-bff. Verify the publisher. If investor-web does not have its own `src/domain/`, either create one or accept investor-bff as the "investor domain" owner of all investor-published events.

---

## Important (should fix)

### I1: advisory-ctrl Task 6 mixes events from 3 different publishers

The `AdvisoryCtrlEventTypes` object in Task 6 includes:
- advisory-ctrl events (correct)
- operations-ctrl events (INCIDENT_*, CIRCUIT_BREAKER_*, MODEL_*, etc.)
- No advisory-bff USER_CONFIRMED/USER_REJECTED (correctly split in Task 7)

However, the original source shows `USER_CONFIRMED` and `USER_REJECTED` were in `AdvisoryEventTypes` under the advisory-ctrl section, while `USER_VIEWED_EXPLANATION` was listed under advisory-bff. The plan moves USER_CONFIRMED/USER_REJECTED to advisory-bff (Task 7), which is a better fit but deviates from the original grouping. This is a **justified improvement** -- just be aware of it.

The operations-ctrl events should ideally get their own file if/when operations-ctrl becomes a service. For now, keeping them in advisory-ctrl is acceptable since they share the advisory EventBridge bus.

### I2: `InvestorProfile` type not listed in onboarding.service.ts import replacement

Task 17 replaces `Goal, Mandate, RiskProfile` for investor-mfe but the domain-core index also exports `InvestorProfile`. Verify no other frontend files import it. The current onboarding.service.ts only imports the three types shown, so the plan is correct for this file. But a broader check of `apps/` would be prudent in Task 18 Step 2.

### I3: Execution events split is inconsistent

Task 9 (execution-ctrl) defines `ExecutionCtrlEventTypes` with only 4 events: `ORDER_SUBMITTED`, `ORDER_STAGED`, `EXECUTION_PAUSED`, `EXECUTION_RESUMED`. But the original `ExecutionEventTypes` in domain-core also includes `ORDER_ACCEPTED`, `ORDER_FILLED`, `ORDER_REJECTED`, etc. which are assigned to execution-adpt in Task 10. The schemas in Task 9 include `OrderFilledSchema` and `DepositDetectedSchema`, which describe events published by execution-adpt, not execution-ctrl. These schemas should be in Task 10 (execution-adpt) or removed from Task 9 if execution-adpt does not need them.

---

## Suggestions (nice to have)

### S1: Consider a shared `investor-domain-types` barrel for MFE consumers

Task 17 creates `apps/investor-mfe/src/app/types/investor.types.ts` with duplicated interfaces. If more MFEs or BFFs need these types, a shared types file in investor-bff's `src/domain/models.ts` (already created in Task 4) could be imported via a tsconfig path alias. Since this is a POC, the inline approach is fine for now.

### S2: Task 18 Step 5 uses `git add -A`

This is safe since domain-core deletion and the `rm -rf` are the only pending changes at that point, but it could accidentally stage unrelated work. Consider being explicit: `git add tsconfig.base.json && git rm -r libs/domain-core`.

---

## Checklist summary

| # | Check | Result |
|---|-------|--------|
| 1 | All 9 source import sites covered in Chunk 3? | YES -- Tasks 13-17 cover all 9 |
| 2 | Event distribution correct (publisher owns events)? | MOSTLY -- see I1 (operations-ctrl mixed in) and I3 (schemas misplaced) |
| 3 | Cross-service types handled? | YES -- ProposedTrade inlined in execution-ctrl, MandateLevel inlined in compliance-ctrl |
| 4 | tsconfig.base.json cleanup? | YES -- Task 18 Step 1 |
| 5 | Circular dependency risks? | NONE -- all dependencies flow one-way to event-processor |
| 6 | Test file mocks updated? | NO -- 13+ test files with jest.mock('@nestfolio/domain-core') are missing from the plan (C1) |
