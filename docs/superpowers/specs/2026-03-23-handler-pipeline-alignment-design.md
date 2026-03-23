# Handler–Pipeline Alignment

> Audit every service event-listener and event-publisher, classify each handler's
> role in the event-driven architecture, and refactor to the correct
> `@nestfolio/event-processor` abstraction level.

## Context

The `@nestfolio/event-processor` library exposes two abstraction tiers:

| Tier | API | Purpose |
|------|-----|---------|
| **Pipeline** (high-level) | `materializeToTable`, `materializeToBucket`, `resumeStateMachine`, `changeDataCapture`, `replayAndReduce` | Opinionated factories for common event-driven patterns. Handlers return declarative `WriteIntent`s; the pipeline owns persistence. |
| **Engine** (low-level) | `createIngestionHandler`, `createEgestionHandler` | Generic SQS/Kinesis/DDB-Stream processing infrastructure. Handler owns all side-effects and persistence. |

### Problem

7 of 8 controller services use `materializeToTable` but return `skip()` and perform
their own imperative DDB writes via repository/service calls. They use the pipeline
purely for its SQS batch infrastructure (partial failures, poison pill, metrics) while
bypassing its write-intent system entirely. The pipeline name is semantically wrong
and the table config is wasted.

5 scheduled adapter services (market-data fetchers) each have a single Lambda
(`event-publisher.ts`) triggered by EventBridge cron that fetches external APIs and
publishes directly to EventBridge via `publishOrUpload`. They have no event-listener,
no DDB table, and no CDC pipeline — just a scheduled fetch-and-publish Lambda with
hand-wired error handling.

## Architecture: Three Service Roles

Every service in the system maps to one of three roles:

| Role | Responsibility | Pipeline | Handler contract |
|------|---------------|----------|-----------------|
| **BFF** | Maintains a slice of system read-model views for an actor | `materializeToTable` | Pure stateless transform: `(payload, ctx) → WriteIntent[]` |
| **Controller** | Transforms lower-level events into higher-level domain events | `materializeToTable` | Domain logic + optional reads via DI deps: `(payload, ctx) → WriteIntent[]` |
| **Adapter** | Adapts the event system to/from third-party services | `createIngestionHandler` (if custom persistence) or `materializeToTable` (if results fit WriteIntents) | Custom side-effects, handler owns persistence |

Additionally, cross-cutting handler types exist that are already correctly mapped:
- **Agent pipeline** → `resumeStateMachine` (SFN task-token resume)
- **KB ingestor** → `materializeToBucket` (S3 write + Bedrock KB sync)
- **CDC publisher** → `changeDataCapture` (DDB Stream → EventBridge)
- **ES reducer** → `replayAndReduce` (DDB Stream → snapshot)

## Full Handler Classification

### Ingestion Handlers (event-listeners)

#### BFFs — `materializeToTable` (NO CHANGE)

Already correct. Handlers are pure transforms returning WriteIntents via `toUow()`.

| Service | Events | Transforms | Status |
|---------|--------|-----------|--------|
| advisory-bff | 5 events (DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED) | `decisionPacketCreated`, `decisionStatusChanged` | Correct |
| investor-bff | 3 events (USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED) | `userRegistered`, `notificationCreated`, `balanceUpdated` | Correct |
| dashboard-bff | 13 events | 6 transforms (portfolioSummary, positionSnapshot, recentActivity, advisoryStatus, investorSnapshot, timeTravelAvailability) | Correct |
| ledger-bff | 3 events (BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED) | `balanceUpdated`, `portfolioUpdated`, `ledgerEntryRecorded` | Correct |

#### Controllers — `materializeToTable` (REFACTOR: return WriteIntents instead of skip)

These services currently call `materializeToTable` but do their own DDB writes via
repository/service dependencies and return `skip()`. They should be refactored so
handlers return `WriteIntent`s and let the pipeline own persistence.

Handlers that need to **read** state (e.g., compliance-ctrl loading mandate snapshots)
keep their DI deps for reads but delegate writes to the intent system.

**1. advisory-ctrl** (PARTIAL refactoring)

Current: `skip()` after `lifecycleService.processDecisionPacket()` / `repository.updateDecisionStatus()`

The TRIGGER handler calls `invokeOrchestrator()` (Bedrock agent pipeline via
`@nestfolio/agent-orchestrator`) — an external side-effect with conditional
control flow (duplicate DecisionPacket check → early return). This cannot be
expressed as WriteIntents.

Proposed:
- TRIGGER events (9 types) → **stays imperative** with `skip()`. Handler calls lifecycle service (agent orchestration + DDB writes). This handler group is the only one that justifies imperative writes.
- COMPLIANCE events (DECISION_APPROVED, DECISION_BLOCKED) → **migrates to WriteIntents**: `update('DecisionPacket', { status, complianceResult, authorityLevel, blockReason }, { overrides })`
- USER events (USER_CONFIRMED, USER_REJECTED) → **migrates to WriteIntents**: `update('DecisionPacket', { status, userDecision, rejectionReason }, { overrides })`

DI deps: keeps `lifecycleService` for TRIGGER handlers. COMPLIANCE/USER handlers become pure functions (no deps needed).

**2. execution-ctrl**

Current: `skip()` after `lifecycleService.processApprovedDecision()`

Proposed:
- DECISION_APPROVED / USER_CONFIRMED → handler extracts proposed trades from decision packet → returns `record('Order', { orderId, symbol, side, quantity, status: 'SUBMITTED' })[]` (one intent per trade)
- CIRCUIT_BREAKER_* / ACCOUNT_CLOSURE_REQUESTED → `skip()` (log-only, no write — this is correct)

DI deps: lifecycle service logic (extracting trades from decision packet) becomes a pure function. No repository needed.

**3. investor-ctrl**

Current: `skip()` after `lifecycleService.executeNotificationLifecycle()`

Proposed:
- All 8 events → handler computes notification fields from event payload → `record('Notification', { tenantId, type, title, body, status: 'UNREAD' })`

DI deps: notification lifecycle logic (template selection, field mapping) becomes a pure function. No repository needed.

**4. compliance-ctrl**

Current: `skip()` after `repository.createComplianceCheck()` + `repository.createAuditArtifact()` + `repository.putMandateSnapshot()`

Proposed:
- DECISION events → handler reads mandate snapshot via `deps.repository.getMandateSnapshot()`, runs `ruleEngine.evaluate()` → returns `[record('ComplianceCheck', { ...result }), record('AuditArtifact', { ...artifact })]`
- MANDATE events → `project('MandateSnapshot', { tenantId, mandateId, ... })` for grant/update, or `update('MandateSnapshot', { status: 'REVOKED' })` for revoke

DI deps: keeps `repository` for reads (getMandateSnapshot), keeps `ruleEngine` for computation. Write calls are eliminated.

**5. reconciliation-ctrl**

Current: `skip()` after `reconciliationService.reconcile()`

Proposed:
- 3 events → handler calls `deps.reconciliationService.reconcile()` (which becomes a pure compute function returning results, not writing to DDB) → returns `[record('ReconciliationResult', { ...result }), ...drifts.map(d => record('DriftRecord', d))]`

DI deps: keeps `reconciliationService` for computation, but its write calls are eliminated.

**6. decision-workflow-ctrl/event-listener**

Current: already returns `record('WorkflowTrigger', { ... })` — **NO CHANGE needed**.

#### Engine-Level Services — `createIngestionHandler` (REFACTOR: pipeline swap)

These services have genuinely complex persistence that cannot be expressed as WriteIntents.

**7. broker-adpt**

Current: `materializeToTable` + `skip()` after TransactWrite / guardedWrite

Proposed: `createIngestionHandler` (no table config). Handler code stays identical — owns all reads, computation, and atomic writes.

Rationale: The adapter's job IS the complex persistence. `executeTrade` needs a 3-item TransactWrite with OCC versioning. `guardedAddToCashBalance` needs guarded atomic writes with 7-day TTL. These are intrinsic to broker simulation and would need equivalent complexity in a real broker integration.

Change: single line — `materializeToTable(...)` → `createIngestionHandler(...)`, remove table config.

**8. ledger-ctrl**

Current: `materializeToTable` + `skip()` after `repository.nextSequence()` + `repository.putLedgerEntry()`

Proposed: `createIngestionHandler` (no table config). Handler code stays identical.

Rationale: Two read-compute-write cycles that can't be split:
1. `nextSequence()` — atomic DDB counter increment (UpdateItem with ADD, returns new value) → value used in the ledger entry's sort key
2. `putLedgerEntry()` — conditional PutItem (`attribute_not_exists(pk)` for idempotency)
3. SIMULATION events additionally call `shadowFill.simulateFill()` per proposed trade (reads market data, computes simulated fill) before writing entries

The sequence number is critical for event-sourcing replay order (`replayAndReduce` depends on it).

Change: single line — `materializeToTable(...)` → `createIngestionHandler(...)`, remove table config.

#### Agent Pipelines — `resumeStateMachine` (NO CHANGE)

Already correct. All return `{ output, intents }` per the `ResumeHandler` contract.

| Service | Handler | Status |
|---------|---------|--------|
| investor-profile-ctrl | `ANALYZE_INVESTOR_PROFILE` | Correct |
| market-intelligence-ctrl | `ANALYZE_MARKET` | Correct |
| portfolio-engine-ctrl | `CONSTRUCT_PORTFOLIO` | Correct |
| advisory-narrative-ctrl | `GENERATE_NARRATIVE`, `DECISION_FEEDBACK` | Correct |
| decision-workflow-ctrl/sfn-callback | Agent completion, compliance, user response | Correct |

#### KB Ingestors — `materializeToBucket` (NO CHANGE)

Already correct. Handlers return `store()` intents.

| Service | Events | Status |
|---------|--------|--------|
| investor-profile-ctrl/kb | DECISION_BLOCKED, DECISION_APPROVED | Correct |
| market-intelligence-ctrl/kb | 5 feed events | Correct |
| portfolio-engine-ctrl/kb | SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED | Correct |

#### Scheduled Adapters — NORMALIZE to 3-Lambda Architecture

These 5 services are currently single-Lambda functions triggered by EventBridge
cron rules. They fetch external APIs and publish directly to EventBridge via
`publishOrUpload`. They should be normalized to the standard 3-Lambda pattern:

```
EventBridge Schedule → publishes FETCH_REQUESTED command → SQS
  → event-listener (materializeToTable): fetch API → record() WriteIntents → DDB
  → event-publisher (changeDataCapture): DDB Stream → domain events → EventBridge
```

**Current pattern (all 5 adapters):**
```typescript
// Single Lambda — EventBridge cron → direct execution
export const handler = createHandler(() => {
  // fetch from external API
  // publishOrUpload({ bus, bucket, eventType, content })
});
```

**Proposed pattern:**
```typescript
// event-listener — SQS handler
export const handler = materializeToTable({
  serviceName: '<adapter>',
  handlers: createHandlers(deps),
  errorEventType: '<ADAPTER>_FAILED',
});

// event-publisher — DDB Stream handler
export const handler = changeDataCapture({
  serviceName: '<adapter>',
  eventTypeMap: buildEventTypeMap([...]),
});
```

| Adapter | External Source | Current Events | DDB Entities | CDC Events |
|---------|---------------|----------------|-------------|------------|
| alpha-vantage-adpt | Alpha Vantage REST API (news + economic indicators) | `ALPHA_VANTAGE_NEWS_UPDATED` | `AlphaVantageArticle`, `EconomicIndicator` | Same event types via CDC |
| fred-adpt | FRED REST API (11 economic series) | `FRED_INDICATORS_UPDATED` | `FredIndicator` | Same |
| marketwatch-adpt | MarketWatch RSS (2 feeds) | `MARKETWATCH_UPDATED` | `MarketWatchArticle` | Same |
| yahoo-finance-adpt | Yahoo Finance RSS (per ticker) | `YAHOO_FINANCE_UPDATED` | `YahooFinanceArticle` | Same |
| sec-edgar-adpt | SEC EDGAR API (filings) | `SEC_8K_FILED`, `SEC_PROSPECTUS_UPDATED`, `SEC_10K_UPDATED` | `SecFiling` | Same |

**Design considerations:**
- The FETCH_REQUESTED command event is published by EventBridge Schedule → SQS rule (replaces cron → Lambda trigger)
- Each adapter's handler receives the command, fetches the external API, and returns WriteIntents for each data item
- Large payloads (article content, filing text) that currently use `publishOrUpload` S3 overflow will be stored as DDB items; CDC publishes the reference. Alternatively, the handler can return `store()` intents for large content and `record()` for metadata.
- Each adapter needs a new DDB table (via its CDK stack) and a new event-publisher Lambda
- The adapter's CDK stack needs an SQS queue subscribed to a schedule-triggered event rule

### Egestion Handlers

#### CDC Publishers — `changeDataCapture` (NO CHANGE)

15 services have `event-publisher.ts` files using `changeDataCapture` + `buildEventTypeMap`.
2 BFFs (dashboard-bff, ledger-bff) have no event-publisher — they are read-model-only
endpoints with no outbound domain events. This is correct: BFFs that only project
read-models and don't originate new facts need no CDC.

Note: advisory-ctrl has a second CDC handler at `src/handlers/tools/event-publisher.ts`
for its agent tool Lambda table.

Some services use custom event type overrides:
- investor-bff: `Deposit:INSERT → DEPOSIT_INITIATED`, `Withdrawal:INSERT → WITHDRAWAL_REQUESTED`
- ledger-ctrl: `BalanceEvent:INSERT → BALANCE_UPDATED`, etc.
- advisory-narrative-ctrl: raw inline map (no `buildEventTypeMap`)

No changes needed.

#### ES Reducer — `replayAndReduce` (NO CHANGE)

ledger-ctrl/reducer already correct. Filters `LedgerEntry` records, groups by `tenantId#streamType`, reduces with `accountReducer`, writes snapshots.

### Non-Pipeline Handlers (NO CHANGE)

| Handler | Type | Why no pipeline |
|---------|------|-----------------|
| decision-workflow-ctrl/assemble-packet | SFN Task Lambda | Direct invocation from Step Functions, not event-driven |
| ledger-bff/graphql-resolver | AppSync Lambda resolver | Request/response pattern, uses `applyMiddleware` |
| investor-web/post-confirmation | Cognito PostConfirmation trigger | Synchronous auth trigger, must return immediately |
| investor-web/post-authentication | Cognito PostAuthentication trigger | Synchronous auth trigger, must return immediately |
| advisory-narrative-ctrl/feedback-correlator | Helper called from resumeStateMachine handler | Part of DECISION_FEEDBACK handler — does DDB query + S3 write + Bedrock KB trigger. The S3 write and KB trigger are side-effects intrinsic to the agent feedback loop, not separable into intents. Already correctly encapsulated within the `resumeStateMachine` pipeline. |

## DI Standardization

All handlers should use the `createHandlers(deps)` factory pattern for testability.

**Currently missing DI factory:**
- advisory-bff (inline object map)
- investor-bff (inline object map)
- dashboard-bff (inline object map)
- ledger-bff (inline object map)

These BFF handlers should be wrapped in `createHandlers(deps)` even though they
have no deps today — the factory enables test isolation and follows the project
convention. The `deps` type can be empty or contain only the transform functions.

## Summary of Changes

### event-processor library changes
None. All required intents (`record`, `project`, `update`, `accumulate`, `skip`, `store`) and pipelines already exist.

### Service handler changes

| Service | Change | Type |
|---------|--------|------|
| advisory-ctrl | Partial: COMPLIANCE/USER handlers → WriteIntents; TRIGGER stays imperative | Controller → WriteIntents (partial) |
| execution-ctrl | Refactor handlers to return WriteIntents | Controller → WriteIntents |
| investor-ctrl | Refactor handlers to return WriteIntents | Controller → WriteIntents |
| compliance-ctrl | Refactor handlers to return WriteIntents (keep read deps) | Controller → WriteIntents |
| reconciliation-ctrl | Refactor handlers to return WriteIntents | Controller → WriteIntents |
| broker-adpt | `materializeToTable` → `createIngestionHandler` | Pipeline swap |
| ledger-ctrl | `materializeToTable` → `createIngestionHandler` | Pipeline swap |
| advisory-bff | Add `createHandlers()` DI wrapper | DI standardization |
| investor-bff | Add `createHandlers()` DI wrapper | DI standardization |
| dashboard-bff | Add `createHandlers()` DI wrapper | DI standardization |
| ledger-bff | Add `createHandlers()` DI wrapper | DI standardization |
| alpha-vantage-adpt | Normalize to 3-Lambda (event-listener + event-publisher) | Architecture normalization |
| fred-adpt | Normalize to 3-Lambda (event-listener + event-publisher) | Architecture normalization |
| marketwatch-adpt | Normalize to 3-Lambda (event-listener + event-publisher) | Architecture normalization |
| yahoo-finance-adpt | Normalize to 3-Lambda (event-listener + event-publisher) | Architecture normalization |
| sec-edgar-adpt | Normalize to 3-Lambda (event-listener + event-publisher) | Architecture normalization |
| decision-workflow-ctrl/event-listener | No change (already returns WriteIntents) | — |

### What does NOT change
- All event-publisher handlers (changeDataCapture) — already correct
- All agent pipeline handlers (resumeStateMachine) — already correct
- All KB ingestion handlers (materializeToBucket) — already correct
- ledger-ctrl/reducer (replayAndReduce) — already correct
- decision-workflow-ctrl/sfn-callback — already correct
- Non-pipeline handlers (assemble-packet, graphql-resolver, Cognito triggers) — already correct

## Risks and Mitigations (Verified)

All lifecycle services have been read. Findings:

### advisory-ctrl — external side-effect confirmed
`executeDecisionLifecycle()` calls `invokeOrchestrator()` (Bedrock agent pipeline via
`@nestfolio/agent-orchestrator`). This is an expensive external call with conditional
control flow (duplicate DecisionPacket check → early return). The TRIGGER handler group
stays imperative. COMPLIANCE and USER handler groups are simple status updates that
CAN migrate to WriteIntents. **Mitigation: partial refactoring (2 of 3 handler groups).**

### execution-ctrl — pure, fully migratable
`processApprovedDecision()` does: conditional createOrder + safetyChecks (pure computation)
+ updateOrderStatus + optional createStagedOrder. `isMarketOpen()` is a local time check.
No external calls. All writes can become intents with different return paths based on
safety/market conditions.

### investor-ctrl — pure today, future risk
`executeNotificationLifecycle()` does: createNotification + stubbed SNS/SES delivery
(currently just logs) + updateNotificationStatus + optional createMonthlyReport. When
real push/email delivery is implemented, the handler will need imperative calls for
those channels. **Mitigation: refactor to WriteIntents now; reassess when delivery is
implemented.**

### compliance-ctrl — two-phase write improvement
Currently creates a ComplianceCheck then updates it with the rule engine result.
Converting to WriteIntents means a single `record('ComplianceCheck', { ...fullResult })`
— one write instead of two. This is **better** (atomic, no partial state). The rule
engine is purely synchronous with no I/O.

### reconciliation-ctrl — fully migratable
`reconcile()` does: conditional createReconciliation (idempotent) + drift computation
(pure) + createDriftRecord per drift (idempotent) + updateReconciliationStatus. All
writes have `PutIfNotExists` guards making retry-safe intent execution possible.

## Testing Strategy

Each refactored handler needs updated tests:
- **Controller handlers**: test that the handler returns the correct WriteIntent(s) for each event type. Use `createHandlers(mockDeps)` with mock repositories for read-dependent handlers.
- **Engine-level handlers** (broker-adpt, ledger-ctrl): existing tests remain — handler logic is unchanged.
- **BFF DI wrappers**: existing transform tests remain; add thin integration test for the `createHandlers()` factory.
- **Scheduled adapter normalization**: new tests for event-listener handlers (mock HTTP clients, verify WriteIntents) and event-publisher handlers (verify CDC mapping).
