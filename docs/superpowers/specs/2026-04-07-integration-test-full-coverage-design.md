# Integration Test Full Coverage — Design Spec

**Date:** 2026-04-07
**Status:** Draft
**Supersedes:** `docs/superpowers/plans/2026-04-06-ledger-ctrl-full-cdc-test.md` (ledger-ctrl folded in)
**Branch:** `feat/all-services-integration-tests`
**Gold standard:** `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`

## Goal

Bring all 14 under-tested services to full integration test coverage: every handler path verified end-to-end with observable side effects (DDB state + CDC events), using real deployed infrastructure with mock external dependencies.

## Strategy Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Adapter mocking | One mock Lambda per adapter | Matches gold standard; each mock models API-specific behavior |
| Mock handler location | `services/{domain}/{service}/test/mocks/` | libs/integration-testing stays domain-agnostic |
| Step Functions testing | Full SF execution end-to-end | SFs run real state machines; assertions on DDB state + CDC events |
| Agent/LLM testing | Mock agent Lambda via MockApiFixture | No real Bedrock calls; deterministic canned responses |
| BFF AppSync testing | Full AppSync calls with Cognito auth | AppSyncClient + CognitoFixture already exist; apply to ALL BFFs |
| Coverage depth | Happy path + key error paths | ~2-3 tests per handler path |
| DDB cleanup | Track + delete in afterAll | Zero residual data after test teardown |
| Ledger-ctrl scope | Incorporated | Supersedes standalone plan |

## Isolation Guarantees

Every test suite MUST leave zero side effects:

- **No third-party API calls** — all external APIs mocked via MockApiFixture + SsmOverrideFixture
- **No LLM/Bedrock calls** — agent paths use mock agent Lambda returning canned results
- **No residual DDB data** — TableAssertions tracks observed items and deletes them in cleanup; DdbSeedFixture deletes seeded items
- **No residual infrastructure** — MockApiFixture (Lambda), EventBusTrap (SQS + EB rule), SsmOverrideFixture (SSM) all cleaned up via `ctx.cleanup.runAll()`

## Architecture: 4-Phase Execution

### Phase 1 — Shared Infrastructure (sequential, 5 tasks)

#### 1.1 DdbSeedFixture

New fixture in `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`:

```typescript
class DdbSeedFixture {
  constructor(ctx: IntegrationContext);
  async seed(opts: { table: string; items: Record<string, unknown>[] }): Promise<void>;
  // Registers cleanup to batch-delete all seeded items in afterAll
}
```

Usage: pre-seed DecisionReadModel, LedgerEntry, InvestorProfile records before testing queries/mutations.

#### 1.2 Extend TableAssertions — item cleanup

Modify `libs/integration-testing/src/assertions/table-assertions.ts`:
- Track every item PK/SK observed via `waitForItem()`
- Add cleanup handler that batch-deletes all tracked items
- Register with `ctx.cleanup`

#### 1.3 Add base URL SSM parameters to 3 adapters

Three adapter services currently lack SSM-based base URL configuration, preventing MockApiFixture + SsmOverrideFixture from redirecting their API calls. Add an SSM parameter for the base URL to each:

| Service | SSM Parameter to Add | Current Behavior |
|---|---|---|
| `marketwatch-adpt` | `/nestfolio/{prefix}-marketwatch-adpt/marketwatch/baseUrl` | Hardcoded RSS URL |
| `yahoo-finance-adpt` | `/nestfolio/{prefix}-yahoo-finance-adpt/yahoo/baseUrl` | Hardcoded RSS URL |
| `sec-edgar-adpt` | `/nestfolio/{prefix}-sec-edgar-adpt/edgar/baseUrl` | Hardcoded SEC EDGAR API URL |

Each service's handler and CDK stack must be updated to read the base URL from SSM (via AWS Parameters and Secrets Lambda Extension) instead of hardcoding it. Follow the `broker-alpaca-adpt` pattern where the Alpaca base URL comes from SSM.

#### 1.4 Migrate mock-alpaca.ts

Move `libs/integration-testing/src/mock-handlers/mock-alpaca.ts` → `services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts`. Update build target from `libs/integration-testing/project.json` to `services/execution/broker-alpaca-adpt/project.json`. Update the integration test's zip path reference.

#### 1.5 Mock build target pattern

Establish the standard `project.json` target for building mock handler zips:

```json
{
  "targets": {
    "build-mock": {
      "executor": "nx:run-commands",
      "options": {
        "commands": [
          "esbuild test/mocks/mock-{name}.ts --bundle --platform=node --target=node20 --outfile=test/mocks/mock-{name}.js",
          "cd test/mocks && zip mock-{name}.zip mock-{name}.js"
        ],
        "cwd": "services/{domain}/{service}"
      }
    }
  }
}
```

---

### Phase 2 — Category A: Adapter Mocks (5 parallel tasks)

Each task creates a mock handler + expands the integration test. All follow the broker-alpaca-adpt gold standard.

#### 2.1 alpha-vantage-adpt

**Mock:** `services/advisory/alpha-vantage-adpt/test/mocks/mock-alpha-vantage.ts`
- Endpoints: `GET /v2/query?function=NEWS_SENTIMENT` (news), `GET /v2/query?function=REAL_GDP` (indicators)
- Scenarios: `integ-news-ok-` → valid articles, `integ-indicator-ok-` → valid data, `integ-error-` → API error response

**Tests (2-3):**
- Send `FETCH_ALPHA_VANTAGE_REQUESTED` → verify `AlphaVantageArticle` DDB writes → verify `ALPHA_VANTAGE_NEWS_UPDATED` CDC event
- Send with indicator function → verify `EconomicIndicator` DDB write → verify `ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED` CDC event
- Error scenario: API returns error → verify no DDB write or error record

**SSM override:** `/nestfolio/{prefix}-alpha-vantage-adpt/alpha-vantage/baseUrl`

#### 2.2 fred-adpt

**Mock:** `services/advisory/fred-adpt/test/mocks/mock-fred.ts`
- Endpoints: `GET /fred/series/observations?series_id={id}` for FEDFUNDS, CPIAUCSL, DGS10, VIXCLS, DEXUSEU
- Scenarios: `integ-ok-` → valid observations, `integ-error-` → API error

**Tests (2-3):**
- Send `FETCH_FRED_REQUESTED` → verify `FredIndicator` DDB writes → verify `FRED_INDICATORS_UPDATED` CDC event
- Error scenario: API returns error for one series → verify partial write handling

**SSM override:** `/nestfolio/{prefix}-fred-adpt/fred/baseUrl`

#### 2.3 marketwatch-adpt

**Mock:** `services/advisory/marketwatch-adpt/test/mocks/mock-marketwatch.ts`
- Endpoints: `GET /rss/topstories`, `GET /rss/marketpulse` — returns RSS/XML
- Scenarios: valid RSS with articles, empty feed, malformed XML

**Tests (2-3):**
- Send `FETCH_MARKETWATCH_REQUESTED` → verify `MarketWatchArticle` DDB writes → verify `MARKETWATCH_UPDATED` CDC event
- Empty feed scenario: no articles → verify no DDB writes, no CDC event (or empty event)

**SSM override:** `/nestfolio/{prefix}-marketwatch-adpt/marketwatch/baseUrl` (added in Phase 1.3)

#### 2.4 sec-edgar-adpt

**Mock:** `services/advisory/sec-edgar-adpt/test/mocks/mock-sec-edgar.ts`
- Endpoints: `GET /cgi-bin/browse-edgar?action=getcompany&CIK={cik}` (filing list), `GET /Archives/edgar/data/{cik}/{accession}` (filing content)
- Scenarios: 8-K filing → `SEC_8K_FILED`, 10-K filing → `SEC_10K_UPDATED`, 485BPOS → `SEC_PROSPECTUS_UPDATED`

**Tests (3-4):**
- Send `FETCH_SEC_EDGAR_REQUESTED` with 8-K response → verify `SecFiling` DDB write → verify `SEC_8K_FILED` CDC event
- Send with 10-K response → verify `SEC_10K_UPDATED` CDC event (form-type routing)
- Send with 485BPOS → verify `SEC_PROSPECTUS_UPDATED` CDC event
- Error: filing not found → verify error handling

**SSM override:** `/nestfolio/{prefix}-sec-edgar-adpt/edgar/baseUrl` (added in Phase 1.3)

#### 2.5 yahoo-finance-adpt

**Mock:** `services/advisory/yahoo-finance-adpt/test/mocks/mock-yahoo-finance.ts`
- Endpoints: `GET /rss/headline?s={ticker}` for VTI, BND, QQQ, VTIP, SPY — returns RSS/XML
- Scenarios: valid articles per ticker, empty feed, error response

**Tests (2-3):**
- Send `FETCH_YAHOO_FINANCE_REQUESTED` → verify `YahooFinanceArticle` DDB writes → verify `YAHOO_FINANCE_UPDATED` CDC event
- Empty feed for one ticker → verify partial results handled

**SSM override:** `/nestfolio/{prefix}-yahoo-finance-adpt/yahoo/baseUrl` (added in Phase 1.3)

---

### Phase 3 — Category B: Multi-handler Services (6 parallel tasks)

Each task expands the existing integration test to cover all handler paths.

#### 3.1 advisory-ctrl (15 subscriptions, 3 handler groups)

**Mock required:** Mock agent Lambda at `services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts`
- Returns canned agent results (tool calls + final answer) based on input event type
- Deployed via MockApiFixture, agent endpoint overridden via SsmOverrideFixture

**Tests (~8-10):**

*Trigger → agent path:*
- Send `MANDATE_CREATED` → verify `AgentInvocation` DDB write (status: IN_PROGRESS) → mock agent returns → verify status: COMPLETED + CDC event
- Send `GOAL_UPDATED` → same flow, different agent invocation type
- Error: mock agent returns failure → verify AgentInvocation status: FAILED + CDC event

*Compliance callback path:*
- Pre-seed `DecisionPacket` (status: AWAITING_COMPLIANCE) via DdbSeedFixture
- Send `DECISION_APPROVED` → verify DecisionPacket status → APPROVED + CDC event
- Send `DECISION_BLOCKED` → verify status → BLOCKED + CDC event

*User response path:*
- Pre-seed DecisionPacket (status: PENDING_USER)
- Send `USER_CONFIRMED` → verify status → CONFIRMED + CDC event
- Send `USER_REJECTED` → verify status → REJECTED + CDC event

#### 3.2 execution-ctrl (5 events + scheduled Lambda)

**Tests (~6-8):**
- `DECISION_APPROVED` — already tested. Add: missing portfolio data → error DDB record
- `USER_CONFIRMED` — verify staged order processing → `ORDER_SUBMITTED` CDC
- `CIRCUIT_BREAKER_TRIGGERED` → verify circuit breaker state DDB write + CDC
- `CIRCUIT_BREAKER_RESET` → verify reset state + CDC
- `ACCOUNT_CLOSURE_REQUESTED` → verify account closure flow + CDC
- Scheduled `staged-order-processor`: invoke Lambda directly → verify batch processing of staged orders → CDC events

#### 3.3 compliance-ctrl (5 events)

**Tests (~6):**
- `DECISION_PACKET_CREATED` — already tested. Add: compliance check fails → verify BLOCKED status + CDC
- `DECISION_PACKET_UPDATED` — re-evaluation after packet update → verify compliance result + CDC
- `MANDATE_CREATED` → verify compliance rules loaded + CDC
- `MANDATE_UPDATED` → verify rules re-evaluated for in-flight packets + CDC
- `OPERATING_MODE_CHANGED` → verify mode-specific compliance behavior + CDC

#### 3.4 broker-sim-adpt (3 events)

**Tests (~5):**
- `SIM_ORDER_REQUESTED` — already tested. Add: rejection scenario (insufficient funds mock)
- `SIM_DEPOSIT_INITIATED` → verify SimAccount DDB write + `SIM_DEPOSIT_COMPLETED` CDC
- `SIM_WITHDRAWAL_REQUESTED` → verify withdrawal processing + `SIM_WITHDRAWAL_COMPLETED` CDC
- Deposit with invalid amount → verify error handling

#### 3.5 advisory-bff (5 event paths + 3 mutations)

**Fixtures:** `AppSyncClient` + `CognitoFixture` (already exist), `DdbSeedFixture` (Phase 1)

**Tests (~8):**

*Event materializations (5 event types):*
- Send each inbound event → verify `DecisionReadModel` DDB write
- Test all 5: verify correct field mapping and status representation

*AppSync mutations (3):*
- Pre-seed `DecisionReadModel` via DdbSeedFixture
- `confirmDecision(decisionId)` → verify DDB status update + CDC event
- `rejectDecision(decisionId, reason)` → verify DDB status + reason field + CDC event
- `recordExplanationView(decisionId)` → verify view count increment + CDC event

*AppSync queries:*
- Pre-seed data → `getDecision`, `getPendingDecisions` → verify response shape and data

#### 3.6 ledger-ctrl (8 subscriptions, full CDC chain)

**Tests (~10-12):**

*Per-event coverage:*
- `ORDER_FILLED` → verify `LedgerEntry` (type: TRADE) DDB write + `LEDGER_ENTRY_CREATED` CDC
- `ORDER_PARTIALLY_FILLED` → verify partial fill ledger entry + CDC
- `ORDER_REJECTED` → verify reversal entry if applicable + CDC
- `ORDER_CANCELLED` → verify cancellation entry + CDC
- `DEPOSIT_DETECTED` → verify deposit ledger entry (type: CASH_IN) + CDC
- `WITHDRAWAL_COMPLETED` → verify withdrawal entry (type: CASH_OUT) + CDC
- `CORPORATE_ACTION_APPLIED` → verify corporate action entry + CDC
- `DECISION_PACKET_CREATED` → verify decision tracking entry + CDC

*Reducer accuracy:*
- Send sequence of events (deposit → buy → partial fill → full fill) → verify running balance calculations in JournalEntry aggregates

*CDC chain:*
- Verify cascading: LedgerEntry write → aggregate update → snapshot CDC event chain

---

### Phase 4 — Category C: Orchestration Services (2 parallel tasks)

#### 4.1 broker-ctrl (4 Ingress handlers + 2 State Machines)

**Tests (~5-6):**

*Mode ingress:*
- `EXECUTION_MODE_CHANGED` — already tested. Add: mode switch while orders in-flight

*Order lifecycle (full SF execution):*
- Send `DEPOSIT_INITIATED` → broker-ctrl writes BrokerOrder (PENDING) → SF starts → routes order event to broker-sim-adpt → sim processes → callback event returns (`SIM_ORDER_FILLED`) → SF resumes → broker-ctrl updates BrokerOrder (FILLED) → CDC event
- Timeout: 120-180s for full SF execution
- Rejection path: order routed → rejected → callback → BrokerOrder (REJECTED) → CDC

*Deposit/withdrawal normalizer:*
- Send `SIM_DEPOSIT_COMPLETED` → verify deposit status normalization + CDC
- Send `ALPACA_TRANSFER_COMPLETED` → same flow for Alpaca transfers

*HealStateMachine:*
- Trigger circuit breaker → verify HealStateMachine starts → recovery completes → CDC events

#### 4.2 decision-workflow-ctrl (DecisionStateMachine, 72h timeout, multi-stage)

**Mock required:** Own mock agent Lambda at `services/advisory/decision-workflow-ctrl/test/mocks/mock-agent-responses.ts`. This is a separate mock from advisory-ctrl's because decision-workflow-ctrl receives agent *callback events* (not direct agent invocations) — the mock returns canned callback payloads matching each agent type (InvestorProfile, MarketAnalysis, Portfolio, Narrative).

**Tests (~6-8):**

*Full decision lifecycle:*
1. Send `MANDATE_CREATED` → SF starts → DDB: DecisionPacket (INITIATED)
2. SF dispatches parallel agent invocations (InvestorProfile + MarketIntelligence)
3. Send callback events: `INVESTOR_PROFILE_COMPLETED`, `MARKET_ANALYSIS_COMPLETED` → SF resumes
4. SF dispatches PortfolioEngine → send `PORTFOLIO_COMPLETED` callback
5. SF dispatches AdvisoryNarrative → send `NARRATIVE_COMPLETED` callback
6. `assemble-packet` Lambda runs → DecisionPacket (ASSEMBLED) → `DECISION_PACKET_CREATED` CDC
7. Send `DECISION_APPROVED` callback → DecisionPacket (APPROVED) → CDC
8. Verify final DDB state + all intermediate CDC events

*Rejection path:*
- Same flow through step 6, then `DECISION_BLOCKED` → verify BLOCKED state + CDC

*User response path:*
- After APPROVED, send `USER_CONFIRMED` → verify final CONFIRMED state + CDC
- Send `USER_REJECTED` → verify REJECTED state + CDC

*Timeout: 120-180s per test (SF execution latency)*

---

### Phase 5 — BFF AppSync Coverage (4 parallel tasks)

Tests for the remaining 3 BFFs that need AppSync verification (advisory-bff covered in Phase 3.5).

#### 5.1 investor-bff (7 mutations + 4 queries)

**Fixtures:** AppSyncClient + CognitoFixture + DdbSeedFixture

**Tests (~10-12):**

*Mutations:*
- Pre-seed InvestorProfile, Goals, Mandate records
- `initiateDeposit(input)` → verify DDB write + CDC event
- `requestWithdrawal(input)` → verify DDB write + CDC event
- `updateGoal(goalId, input)` → verify Goal update + CDC event
- `updateMandate(input)` → verify Mandate update + CDC event
- `revokeMandate()` → verify Mandate revocation + CDC event
- `requestAccountClosure()` → verify closure request + CDC event
- `markNotificationRead(id)` → verify Notification update
- Error: initiateDeposit with invalid amount → verify validation error

*Queries:*
- Pre-seed data → `getProfile()`, `getGoals()`, `getNotifications()`, `getUnreadCount()` → verify response shape

#### 5.2 dashboard-bff (read-only, 5 queries)

**Fixtures:** AppSyncClient + CognitoFixture + DdbSeedFixture

**Tests (~5-6):**
- Pre-seed DashboardView, PositionSnapshot, Activity records
- `getDashboard()` → verify dashboard data shape and values
- `getPositionSnapshots()` → verify position data
- `getRecentActivity(limit)` → verify activity feed + pagination
- `getTimeTravelAvailability()` → verify time-travel metadata
- `getSimulationSummary()` → verify simulation data

#### 5.3 ledger-bff (read-only, 2 queries)

**Fixtures:** AppSyncClient + CognitoFixture + DdbSeedFixture

**Tests (~3-4):**
- Pre-seed TimeSeriesEntry records (portfolio snapshots at different timestamps)
- `getPortfolioAt(timestamp)` → verify portfolio reconstruction at point-in-time
- `getSimulationComparison(timestamp)` → verify simulation vs actual comparison
- Edge case: timestamp with no data → verify graceful empty response

#### 5.4 onboarding-bff (agent-based, no AppSync)

**Out of scope.** onboarding-bff uses CopilotKit + LangGraph with Bedrock AgentCore runtime — not the standard event → DDB → CDC pattern. It has 11 existing unit/integration test files covering agent tools, graph, state, and session. Adding mock-based integration tests for this service requires a different fixture pattern (AgentCore mock) and is deferred to a future plan.

---

## Test Count Summary

| Phase | Services | Estimated Tests |
|---|---|---|
| Phase 2 — Adapter mocks | 5 | ~13-16 |
| Phase 3 — Multi-handler | 6 | ~43-49 |
| Phase 4 — Orchestration | 2 | ~11-14 |
| Phase 5 — BFF AppSync | 3 (onboarding-bff deferred) | ~18-22 |
| **Total** | **16** | **~85-101** |

## Task Dependency Graph

```
Phase 1 (sequential)
├── 1.1 DdbSeedFixture
├── 1.2 Extend TableAssertions (cleanup)
├── 1.3 Add base URL SSM to 3 adapters
├── 1.4 Migrate mock-alpaca.ts
└── 1.5 Mock build target pattern
    │
    ├──► Phase 2 (5 parallel) ──► Cat A adapters
    ├──► Phase 3 (6 parallel) ──► Cat B multi-handler
    │        └── 3.5 advisory-bff needs AppSyncClient (already exists)
    ├──► Phase 4 (2 parallel) ──► Cat C orchestration
    │        └── 4.2 decision-workflow-ctrl needs mock agent from 3.1
    └──► Phase 5 (4 parallel) ──► BFF AppSync coverage
```

Note: Phases 2-5 can all run in parallel after Phase 1 completes, EXCEPT:
- Phase 4.2 (decision-workflow-ctrl) depends on the mock agent pattern established in Phase 3.1 (advisory-ctrl)

## File Changes Summary

**New files:**
- `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`
- 5 adapter mock handlers: `services/advisory/{service}/test/mocks/mock-{name}.ts`
- 1 agent mock handler: `services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts`
- 1 agent mock handler: `services/advisory/decision-workflow-ctrl/test/mocks/mock-agent-responses.ts`

**Modified files:**
- `libs/integration-testing/src/assertions/table-assertions.ts` — add item tracking + cleanup
- `libs/integration-testing/src/index.ts` — export DdbSeedFixture
- 3 adapter service handlers + CDK stacks — add base URL SSM parameter (marketwatch, yahoo-finance, sec-edgar)
- `services/execution/broker-alpaca-adpt/test/integration/*.ts` — update mock zip path
- 14 integration test files — expanded test cases
- 8 service `project.json` files — add `build-mock` target

**Moved files:**
- `libs/integration-testing/src/mock-handlers/mock-alpaca.ts` → `services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts`
