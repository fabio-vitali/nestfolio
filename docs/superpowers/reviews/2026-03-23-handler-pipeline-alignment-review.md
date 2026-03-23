# Review: Handler-Pipeline Alignment Design Spec (R1) + Implementation Plan (R2)

**Spec**: `docs/superpowers/specs/2026-03-23-handler-pipeline-alignment-design.md`
**Plan**: `docs/superpowers/plans/2026-03-23-handler-pipeline-alignment.md`
**Reviewer**: Code Review Agent
**Date**: 2026-03-23

---

# R2: Implementation Plan Review

## Verdict: APPROVED with 2 Important and 3 Suggestion-level issues

### 1. Spec Coverage -- PASS

Every spec change has a corresponding plan task. 19 tasks across 3 waves, with verification gates at Tasks 7, 13, and 19.

### 2. Task Ordering -- PASS

No task depends on a later task. Wave 1 (mechanical) before Wave 2 (logic) before Wave 3 (infrastructure) is correct risk ordering.

### 3. Code Accuracy Issues

**IMPORTANT: Wrong event type constants in Task 8 (execution-ctrl)**
Plan references `ExecutionCtrlEventTypes.DECISION_APPROVED`. Actual source uses `AdvisoryCrossDomainEventTypes.DECISION_APPROVED` (from `@nestfolio/advisory-adpt/domain`) and `InvestorCrossDomainEventTypes.ACCOUNT_CLOSURE_REQUESTED` (from `@nestfolio/investor-adpt/domain`). The plan's fictional import would fail at compile time. Same applies to CIRCUIT_BREAKER_* and USER_CONFIRMED constants.

**IMPORTANT: Wrong event type source in Task 10 (advisory-ctrl USER handlers)**
Plan references `UserEventTypes.USER_CONFIRMED`. Actual source uses `AdvisoryBffEventTypes.USER_CONFIRMED` and `AdvisoryBffEventTypes.USER_REJECTED` (from `@nestfolio/advisory-bff/events`).

**SUGGESTION: Inconsistent `record()` override syntax within plan**
Task 8 passes `{ pk, sk }` directly as third arg to `record()`. Task 10 passes `{ overrides: { pk, sk } }` to `update()`. Looking at `intents.ts`, the `RecordIntent` type has `overrides?: KeyOverrides` at the same level as `UpdateIntent`. This means the plan is internally inconsistent -- one of the two calling conventions is wrong. The intent *types* suggest `{ overrides: { pk, sk } }` is correct for both.

**SUGGESTION: advisory-bff Task 3 snippet omits ComplianceEventTypes import**
The `createHandlers()` example only shows `AdvisoryCtrlEventTypes` usage but the actual handler also uses `ComplianceEventTypes.DECISION_APPROVED` and `ComplianceEventTypes.DECISION_BLOCKED`. Since this is wrapping existing code, not writing new, the agent will see the real imports, so low risk.

### 4. Test Coverage -- PASS

All handler changes have corresponding test updates. Existing `createTestHarness` + `fakeSqsRecord` patterns match the infrastructure confirmed in broker-adpt and execution-ctrl test files.

### 5. Missing Tasks

**SUGGESTION: No intent factory function verification step**
Wave 2 assumes `record()`, `update()`, `project()` factory functions exist with specific signatures. The `intents.ts` file defines only *types*, not constructor functions. The plan should include a step to verify these factories exist and document their signatures before Wave 2 begins.

### 6. Risk

**MEDIUM: Wave 2 pk/sk pattern correctness**
The plan correctly includes "Important: read actual pk/sk layout" notes, but they are advisory. If the executing agent treats them as optional, WriteIntents will write items with wrong keys, breaking CDC silently. Consider making the repository-reading steps blocking prerequisites.

**LOW: `createIngestionHandler` table fallback (Tasks 1-2)**
`createIngestionHandler` defaults to `process.env['TABLE_NAME']` and always creates a DynamoDBDocumentClient. Since broker-adpt and ledger-ctrl already set `TABLE_NAME`, this is fine. No real risk.

### 7. Summary Table

| Category | Count | Details |
|----------|-------|---------|
| Critical | 0 | |
| Important | 2 | Wrong event type constants (Tasks 8, 10) |
| Suggestions | 3 | record() syntax inconsistency, missing import in snippet, no intent factory verification |

---
---

# R1: Design Spec Review (original, retained below)

## Overall Assessment

The spec is well-structured, technically accurate on the core claims, and actionable enough to write an implementation plan from. The three-role classification (BFF/Controller/Adapter) is sound and applied consistently. Below are the specific findings.

---

## 1. Completeness

### Services Covered Correctly
All 16 services with event-listener.ts files are accounted for in the ingestion section. The 20 event-publisher files are covered under CDC. The 4 non-pipeline handlers are correctly listed.

### CRITICAL: Missing Services

**C1. `advisory-adpt`, `execution-adpt`, `investor-adpt`, `ledger-adpt` (cross-domain forwarding adapters)**
These 4 services exist as projects under `services/*/` but have no event-listener.ts -- they contain only `domain/`, `main.ts`, and `service.stack.ts`. The spec does not mention them at all. They should be explicitly listed in a "No handler -- CDK-only forwarding stacks" section for completeness. Currently they are invisible, which could cause confusion when someone tries to reconcile the spec against the project list.

**C2. `onboarding-agent-bff`**
This service (`services/investor/onboarding-agent-bff`) is a LangGraph.js conversational agent BFF with its own repository, agent graph, and tools. It has NO event-listener or event-publisher -- it's a synchronous HTTP/WebSocket service. The spec should mention it in the "Non-Pipeline Handlers" section or a separate "Excluded Services" section.

**C3. Hub stacks (`advisory-hub`, `execution-hub`, `investor-hub`, `ledger-hub`)**
These are CDK-only infrastructure stacks with no handlers. Not strictly necessary to list, but for a "full audit" doc as claimed in the header, a brief mention would help.

**C4. `dashboard-bff` and `ledger-bff` have NO event-publisher**
The spec says "All 14 services (plus 5 new ones for normalized adapters) use `changeDataCapture`" but dashboard-bff and ledger-bff have no event-publisher.ts at all. This means only 12 services currently have CDC publishers (20 publisher files minus 8 for the 5 scheduled adapters and advisory-ctrl/tools). The count of "14" is wrong.

### IMPORTANT: Scheduled Adapter Mischaracterization

**C5. Scheduled adapters are NOT "single-Lambda functions"**
The spec says: "5 services are currently single-Lambda functions triggered by EventBridge cron rules." However, `alpha-vantage-adpt` already has a separate `handlers/event-publisher.ts` file (confirmed for all 5). The handler file IS named `event-publisher.ts` but contains the fetch + publish logic. They already have the event-publisher Lambda as a distinct file. The spec's "normalize to 3-Lambda architecture" description should acknowledge this starting point more accurately -- what they lack is the SQS-based event-listener and DDB table, not the event-publisher.

---

## 2. Accuracy of WriteIntent Mappings

### advisory-ctrl -- ACCURATE with caveat
The spec correctly identifies three handler groups (trigger, compliance callback, user response) and proposes `record()` and `update()` intents. However:

**IMPORTANT: `handleTriggerEvent` delegates to `lifecycleService.executeDecisionLifecycle()`** which likely does more than just create a record -- it orchestrates the full lifecycle. The spec says "moves into the handler or a pure compute function" but this needs more investigation. If the lifecycle service publishes events or triggers Step Functions, those side-effects cannot be expressed as WriteIntents.

### execution-ctrl -- ACCURATE
The spec correctly notes DECISION_APPROVED/USER_CONFIRMED call `processApprovedDecision()` and CIRCUIT_BREAKER/ACCOUNT_CLOSURE are log-only. The proposed `record('Order', ...)` intent is sound.

### investor-ctrl -- ACCURATE
All 8 events delegate to `lifecycleService.executeNotificationLifecycle()`. The spec correctly proposes `record('Notification', ...)`. Same caveat as advisory-ctrl about what the lifecycle service does internally.

### compliance-ctrl -- ACCURATE, GOOD DETAIL
The spec correctly identifies the read-compute-write pattern with `getMandateSnapshot` reads and proposes keeping read deps. The multi-write pattern (createComplianceCheck + updateCheckResult + createAuditArtifact) maps to `[record('ComplianceCheck'), record('AuditArtifact')]`. However:

**IMPORTANT: compliance-ctrl has a TWO-PHASE write pattern.** It first creates a compliance check (idempotent PutItem), then updates the result after rule evaluation. This is `createComplianceCheck()` followed by `updateCheckResult()`, not a single write. The spec's proposed `record('ComplianceCheck', { ...result })` suggests a single write, but the current code intentionally creates the record first (to claim idempotency) and updates it after evaluation. Converting to a single `record()` changes the idempotency semantics -- if the rule engine throws, the current code has already claimed the event. This needs careful consideration.

### reconciliation-ctrl -- ACCURATE
Straightforward delegation pattern. The spec's proposal is clean.

### broker-adpt -- ACCURATE, EXCELLENT JUSTIFICATION
The spec correctly identifies TransactWrite + guardedWrite patterns that cannot be expressed as WriteIntents. The `createIngestionHandler` swap is the right call.

### ledger-ctrl -- ACCURATE, EXCELLENT JUSTIFICATION
The spec correctly identifies the `nextSequence()` + `putLedgerEntry()` atomic counter pattern. The `createIngestionHandler` swap is correct.

### decision-workflow-ctrl -- ACCURATE
Confirmed: already returns `record('WorkflowTrigger', ...)`. No change needed.

---

## 3. Consistency of Classification

The three-role classification is applied consistently. Verified:
- All 4 BFFs use `toUow()` transforms returning WriteIntents -- correctly classified as "NO CHANGE"
- All 5 controllers use `skip()` after imperative writes -- correctly classified as "REFACTOR"
- broker-adpt has complex transactional persistence -- correctly classified as engine-level
- ledger-ctrl has atomic counter + conditional writes -- correctly classified as engine-level
- All 4 agent services use `resumeStateMachine` -- correctly classified as "NO CHANGE"
- All 3 KB ingestors use `materializeToBucket` -- correctly classified as "NO CHANGE"

**No misclassifications found.**

---

## 4. Feasibility Concerns

### IMPORTANT: Controller lifecycle services need decomposition

The spec acknowledges this ("lifecycle service logic becomes a pure function") but underestimates the effort for advisory-ctrl and investor-ctrl. Both have lifecycle services that:
1. Read existing state
2. Compute new state
3. Write to DDB
4. Potentially trigger downstream side-effects

Converting step 3 to WriteIntents is straightforward. But if step 4 exists (e.g., lifecycle service calls EventBridge or SFN directly), that cannot be captured in WriteIntents. The spec should require an audit of each lifecycle service's internal side-effects before committing to the refactor.

### Scheduled adapter normalization is a CDK-heavy change

The spec correctly notes "each adapter needs a new DDB table and SQS queue" but does not mention:
- The `service.stack.ts` refactoring needed (currently uses schedule-triggered Lambda, needs Ingress+State+Egress constructs)
- The EventBridge Schedule rule change (from direct Lambda invoke to publishing a FETCH_REQUESTED command)
- The 5 adapters currently have NO event-listener.ts at all -- this is entirely new code, not a refactor

This is the largest piece of work in the spec and deserves its own section estimating scope.

---

## 5. Gaps

### SUGGESTION: Event count verification for BFFs

The spec says advisory-bff handles "5 events" and dashboard-bff handles "13 events". Verified:
- advisory-bff: 5 events -- CORRECT
- investor-bff: 3 events -- CORRECT
- dashboard-bff: 13 distinct handler keys (BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED) -- CORRECT
- ledger-bff: 3 events -- CORRECT

### SUGGESTION: advisory-narrative-ctrl classification

The spec lists advisory-narrative-ctrl under "Agent Pipelines -- resumeStateMachine" but does not mention that it also has a `feedback-correlator.ts` handler. This should be noted for completeness.

### SUGGESTION: portfolio-engine-ctrl KB routing

portfolio-engine-ctrl's event-listener handles BOTH SFN callback events AND KB ingestion events in the same handler file (routing KB events to a separate ingestion handler). The spec lists it only under Agent Pipelines, but the KB routing aspect should be noted.

---

## 6. Clarity

The spec is well-structured for implementation planning. The tables, code examples, and rationale sections make it actionable. Minor improvements:

- The "Full Handler Classification" section would benefit from a total count summary at the top (e.g., "16 event-listeners, 20 event-publishers, 4 non-pipeline handlers")
- The scheduled adapter section could include a rough LOC/effort estimate since it is new code rather than refactoring
- The DI standardization section correctly identifies the 4 BFFs missing `createHandlers()` wrappers

---

## Summary

| Category | Count |
|----------|-------|
| Critical issues | 0 |
| Important issues | 4 (C4 count error, C5 adapter mischaracterization, lifecycle decomposition risk, compliance two-phase write) |
| Suggestions | 5 (missing service mentions, narrative-ctrl feedback handler, portfolio-engine KB routing, count summary, effort estimate) |
| Completeness gaps | 3 (cross-domain adapters, onboarding-agent-bff, hub stacks not mentioned) |

**Verdict**: The spec is technically sound on its core proposals. The controller-to-WriteIntents refactoring and engine-level swaps are correct. The main risks are (1) lifecycle service decomposition may reveal hidden side-effects, and (2) the scheduled adapter normalization is more CDK-heavy than the spec implies. Recommend addressing the Important issues before writing the implementation plan.
