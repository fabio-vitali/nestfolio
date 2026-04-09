# Integration Test Full Run Report

**Date**: 2026-04-08
**Services tested**: 28/33 (5 excluded: 4 hubs + investor-web)
**Test files**: 32 across 4 domains
**Total runtime**: ~12 minutes (parallel=6)

---

## 1. Test Results Summary

**26/28 PASSED, 2 FAILED**

### Failed Services

| Service | Test File | Error | Root Cause |
|---------|-----------|-------|------------|
| execution-adpt | `from-investor.integration.test.ts` | EventBusTrap timeout 30s | Adapter EB Rule `source` filter mismatch (see Section 6) |
| advisory-adpt | `from-ledger.integration.test.ts` | EventBusTrap timeout 30s | Adapter EB Rule `source` filter mismatch (see Section 6) |

Both failures are in **cross-domain adapter forwarding** tests where the EB Rule doesn't correctly route the `integration-test:*` source prefix.

### Passing Services (26/28)

| Domain | Service | Tests | Duration | Notes |
|--------|---------|-------|----------|-------|
| **Advisory** | advisory-ctrl | 16 | 293s | Compliance callbacks + 11 agent triggers |
| | advisory-bff | varies | ~120s | AppSync queries + CDC materializations |
| | advisory-adpt | 2/3 | 52s | from-investor PASS, from-execution PASS, from-ledger FAIL |
| | advisory-narrative-ctrl | 1 | 28s | GENERATE_NARRATIVE -> AgentInvocation |
| | alpha-vantage-adpt | varies | ~50s | Full MockApi + CDC |
| | compliance-ctrl | varies | ~58s | Full pipeline |
| | decision-workflow-ctrl | varies | ~120s | Trigger events + SF paths |
| | fred-adpt | varies | ~50s | Full MockApi + CDC |
| | investor-profile-ctrl | varies | ~30s | KB ingestion smoke |
| | market-intelligence-ctrl | 1 | 12s | ANALYZE_MARKET -> AgentInvocation |
| | marketwatch-adpt | varies | ~50s | Full MockApi + CDC |
| | portfolio-engine-ctrl | 1 | 29s | CONSTRUCT_PORTFOLIO -> AgentInvocation |
| | sec-edgar-adpt | varies | ~50s | Full MockApi + CDC |
| | yahoo-finance-adpt | varies | ~50s | Full MockApi + CDC |
| **Execution** | execution-ctrl | 5 | 88s | Order creation + skip handlers |
| | execution-adpt | 1/2 | 47s | from-advisory PASS, from-investor FAIL |
| | broker-ctrl | 6 | 130s | ExecMode + normalizer + router |
| | broker-sim-adpt | 3 | 66s | Full sim order lifecycle |
| | broker-alpaca-adpt | varies | ~50s | MockApi + SSM override |
| **Investor** | investor-ctrl | 12 | 104s | Full notification CDC coverage |
| | investor-adpt | 1 | 9s | ORDER_REJECTED forwarding only |
| | investor-bff | varies | ~120s | Cognito + AppSync + materializations |
| | dashboard-bff | 20 | 311s | Largest suite, full coverage |
| | onboarding-bff | 3 | 6s | DDB schema validation only |
| **Ledger** | ledger-ctrl | varies | ~120s | ORDER_FILLED -> LedgerEntry + CDC (skip) |
| | ledger-adpt | 1 | 9s | ORDER_FILLED forwarding only |
| | ledger-bff | 10 | 103s | Materializations + AppSync |
| | reconciliation-ctrl | 1 | 32s | PORTFOLIO_UPDATED -> RECONCILIATION_COMPLETED |

---

## 2. Side-Effect Analysis

### Event Side Effects: NONE

The Ingress construct uses an L1 `$or` event pattern:
- **Clause 1**: Matches production events where `source` does NOT start with `integration-test:`
- **Clause 2**: Matches test events where `source` starts with `integration-test:{THIS_SERVICE_NAME}`

This ensures a test event targeted at `advisory-ctrl` is consumed ONLY by advisory-ctrl, not by compliance-ctrl or any other service on the same bus.

### Data Cleanup

| Fixture | Cleans Up? | Mechanism |
|---------|------------|-----------|
| TableAssertions | YES | Deletes all items observed via waitForItem/assertItem (LIFO) |
| EventBusTrap | YES | Deletes SQS queue + EB Rule |
| CognitoFixture | YES | Deletes test Cognito user |
| MockApiFixture | YES | Deletes Lambda function + URL + IAM role |
| SsmOverrideFixture | YES | Restores original SSM parameter value |
| DdbSeedFixture | YES | Deletes all seeded items |
| AccountSeedingFixture | **NO** | Writes AccountSnapshot but never registers cleanup |

### Residual Data

1. **AccountSeedingFixture items** remain in DynamoDB after tests -- scoped by unique `integ-{timestamp}` tenantId, won't cause interference but accumulates over time.
2. **DDB items created by handlers but not queried by tests** -- if a test only verifies CDC via EventBusTrap but never reads the DDB item via TableAssertions, that item won't be tracked for cleanup.
3. **All residual data is scoped by unique tenantId** -- no production impact, but grows in DDB tables over repeated test runs.

### Open Handles Warning

All 28 test suites emit `Force exiting Jest: --detectOpenHandles`. This indicates AWS SDK clients (EventBridge, SQS, DynamoDB, etc.) are not being explicitly destroyed in `afterAll`. Not a functional issue but causes Jest to force-exit rather than clean shutdown.

---

## 3. Ingress/Egress Pipeline Coverage

### Coverage Legend
- Full: all event types tested with DDB + CDC assertions
- Partial: some event types tested, or assertions are incomplete
- Smoke: handler invoked without error, but no DDB/CDC assertions
- None: zero coverage for that pipeline direction

### Advisory Domain

| Service | Ingress Coverage | Egress Coverage | Details |
|---------|-----------------|-----------------|---------|
| advisory-ctrl | 15/15 (Full) | Partial | CDC assertions wrapped in try/catch (non-failing) |
| advisory-bff | Partial | Partial | DECISION_READ_MODEL CDC never verified |
| advisory-adpt | 3/13 rules (Partial) | N/A (stateless) | 1 test per source bus, 10 rules untested |
| advisory-narrative-ctrl | 1/2 (Partial) | None | No EventBusTrap deployed; DECISION_FEEDBACK untested |
| alpha-vantage-adpt | Full | Full | Exemplary: MockApi + SsmOverride + CDC trap |
| compliance-ctrl | Full | Full | Full pipeline with CDC verification |
| decision-workflow-ctrl | Partial | None | 0/8 CallbackIngress events tested (requires running SF) |
| fred-adpt | Full | Full | Exemplary: MockApi + SsmOverride + CDC trap |
| investor-profile-ctrl | 1/4 (Partial) | None | KB ingestion events (3) untested; no EventBusTrap |
| market-intelligence-ctrl | 1/4 (Partial) | None | KB ingestion events (3) untested; no EventBusTrap |
| marketwatch-adpt | Full | Full | Exemplary: MockApi + SsmOverride + CDC trap |
| portfolio-engine-ctrl | 1/3 (Partial) | None | KB ingestion events (2) untested; no EventBusTrap |
| sec-edgar-adpt | Full | Full | Exemplary: MockApi + SsmOverride + CDC trap |
| yahoo-finance-adpt | Full | Full | Exemplary: MockApi + SsmOverride + CDC trap |

### Execution Domain

| Service | Ingress Coverage | Egress Coverage | Details |
|---------|-----------------|-----------------|---------|
| execution-ctrl | 5/5 (Full) | Partial | ORDER_CREATED CDC verified; skip-handler events are smoke-only |
| execution-adpt | 1/2 buses (Partial) | N/A (stateless) | Advisory->Execution PASS; Investor->Execution FAIL |
| broker-ctrl | 6/6 (Full) | Full | ExecMode + normalizer CDC + router paths verified |
| broker-sim-adpt | 3/3 (Full) | Full | Order fill + deposit + withdrawal with CDC |
| broker-alpaca-adpt | Full | Full | MockApi + SSM override + CDC |

### Investor Domain

| Service | Ingress Coverage | Egress Coverage | Details |
|---------|-----------------|-----------------|---------|
| investor-ctrl | 11/11 (Full) | Full | NOTIFICATION_CREATED + MONTHLY_REPORT_CREATED CDC verified |
| investor-adpt | 1/23 rules (Minimal) | N/A (stateless) | Only ORDER_REJECTED tested; 2/3 source buses untested |
| investor-bff | Partial | Partial | Cognito + AppSync + materializations; some CDC unverified |
| dashboard-bff | Full | Full | 20 tests covering all materializations + AppSync queries |
| onboarding-bff | Smoke | None | DDB schema validation only -- no event-driven ingress test |

### Ledger Domain

| Service | Ingress Coverage | Egress Coverage | Details |
|---------|-----------------|-----------------|---------|
| ledger-ctrl | 6/8 (Partial) | None (skipped) | CORPORATE_ACTION_APPLIED + simulation path untested; CDC in `describe.skip` |
| ledger-adpt | 1/11 rules (Minimal) | N/A (stateless) | Only ORDER_FILLED tested |
| ledger-bff | Full | Full | 10 tests: materializations + AppSync resolvers |
| reconciliation-ctrl | 1/1 (Full) | Full | PORTFOLIO_UPDATED -> RECONCILIATION_COMPLETED |

---

## 4. Test Implementation Patterns

### Pattern Categories

**A. Full-pipeline tests** (exemplary): Third-party feed adapters (alpha-vantage, fred, marketwatch, sec-edgar, yahoo-finance)
- Deploy MockApiFixture (Lambda + Function URL) as fake external API
- Use SsmOverrideFixture to redirect service to mock URL
- Publish trigger event via EventBridgeClient
- Assert DDB write via TableAssertions.waitForItem
- Assert CDC event via EventBusTrap.waitForEvent
- Full cleanup registered

**B. CDC chain tests**: investor-ctrl, broker-ctrl, execution-ctrl, broker-sim-adpt
- Publish event via EventBridgeClient
- Assert DDB write via TableAssertions
- Assert CDC event via EventBusTrap
- Good coverage of ingress -> state -> egress pipeline

**C. AppSync/BFF tests**: advisory-bff, investor-bff, dashboard-bff, ledger-bff
- Create Cognito test user
- Publish events to materialize DDB read models
- Execute GraphQL queries/mutations via AppSyncClient
- Assert response shapes and data correctness

**D. Adapter forwarding tests**: advisory-adpt, execution-adpt, investor-adpt, ledger-adpt
- Publish event to source bus
- Deploy EventBusTrap on target bus
- Assert event appears on target bus with correct detailType and tenantId
- Minimal -- typically 1 test per source bus

**E. Agent smoke tests**: advisory-narrative-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, investor-profile-ctrl
- Publish trigger event
- Assert AgentInvocation DDB write (proves handler processed event)
- No EventBusTrap -- CDC output unverified
- No KB ingestion event coverage

**F. DDB schema validation tests**: onboarding-bff
- Direct DDB writes and reads to validate schema
- No event-driven ingress testing

---

## 5. Test Inconsistencies and Issues

### Critical Issues

1. **Adapter EB Rule source filter mismatch** (execution-adpt, advisory-adpt)
   - Adapter stacks use CDK L2 `Match.anyOf(Match.anythingButPrefix, Match.prefix)` which produces a flat array content filter
   - Ingress construct uses L1 `$or` JSON pattern
   - These may not be semantically equivalent, causing the test source prefix not to match
   - **Impact**: 2 test failures, affects all adapter cross-domain forwarding tests

2. **ledger-ctrl CDC chain tests in `describe.skip`**
   - All egress verification is disabled due to "Reducer sk-prefix mismatch (stale deployment)"
   - Means zero active egress coverage for the entire ledger-ctrl service
   - **Impact**: CDC events (BALANCE_UPDATED, LEDGER_ENTRY_RECORDED, etc.) completely unverified

3. **advisory-ctrl agent trigger CDC assertions wrapped in try/catch**
   - All 11 agent trigger events have CDC assertions inside catch blocks that swallow timeouts
   - These assertions NEVER fail the test even if CDC is broken
   - **Impact**: False sense of egress coverage; effectively smoke tests

### Moderate Issues

4. **AccountSeedingFixture lacks cleanup**
   - Seeds DDB items but doesn't register teardown
   - Residual data accumulates per test run

5. **4 agent services missing `table.registerCleanup()`**
   - advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl
   - DDB items from these tests are never cleaned up

6. **Open handles in all 28 suites**
   - AWS SDK clients not destroyed, causing Jest force-exit
   - Not functionally breaking but indicates resource leak

7. **onboarding-bff tests are schema validation only**
   - No event-driven ingress testing
   - DDB writes are direct (not through Lambda handlers)
   - Doesn't validate the actual event processing pipeline

### Minor Issues

8. **Adapter tests have minimal coverage**
   - investor-adpt: 1/23 forwarded event types tested
   - ledger-adpt: 1/11 forwarded event types tested
   - advisory-adpt: 3/13 forwarded event types tested
   - Since adapters are pure EB Rules (same pattern per source bus), 1 test per bus gives reasonable confidence, but zero tests for 2/3 buses is a gap

9. **ledger-ctrl missing simulation path coverage**
   - DECISION_PACKET_CREATED (simulation flow with shadow fill logic) has zero coverage
   - CORPORATE_ACTION_APPLIED handler exists but is untested
   - waitForLedgerEntry helper hardcodes `actual` stream, won't work for simulated entries

10. **decision-workflow-ctrl CallbackIngress completely untested**
    - 8 callback events (INVESTOR_PROFILE_COMPLETED, NARRATIVE_COMPLETED, etc.) require a running Step Functions execution
    - Integration test framework doesn't support SF execution setup yet

---

## 6. Adapter EB Rule Failure Analysis

The two failing tests share the same root cause. The adapter CDK stacks use CDK's L2 API:

```typescript
source: Match.anyOf(
  Match.anythingButPrefix('integration-test:'),
  Match.prefix('integration-test:advisory-adpt')
)
```

This synthesizes to a **flat array** content filter:
```json
"source": [
  { "anything-but": { "prefix": "integration-test:" } },
  { "prefix": "integration-test:advisory-adpt" }
]
```

However, the Ingress construct (used by regular services) uses a raw L1 `$or` pattern:
```json
{
  "$or": [
    { "source": [{ "anything-but": { "prefix": "integration-test:" }}], "detail-type": [...] },
    { "source": [{ "prefix": "integration-test:advisory-adpt" }], "detail-type": [...] }
  ]
}
```

**EventBridge does NOT support array-level OR for mixed content filter expressions.** When `anything-but` and `prefix` appear in the same array, the source must match BOTH filters — which is impossible for `integration-test:*` sources (they fail `anything-but: prefix: "integration-test:"`). The event is rejected even though the second clause should match.

The Ingress construct comment at `libs/cdk-constructs/src/core/ingress.ts:110-111` explicitly documents this:
> array-level OR with mixed content filters (anything-but + prefix) doesn't work for SQS targets despite passing test-event-pattern validation. Use $or instead.

**Why some adapter tests PASS:** Some rules may not have been redeployed since the `Match.anyOf` rewrite, meaning the older working `$or` pattern is still live in CloudFormation.

**Fix**: Replace `Match.anyOf(...)` in all 4 adapter stacks with the same L1 `$or` override:

```typescript
const cfnRule = rule.node.defaultChild as CfnRule;
cfnRule.addPropertyOverride('EventPattern', {
  '$or': [
    { 'detail-type': [...], 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
    { 'detail-type': [...], 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
  ],
});
```

**Affected stacks** (all rules in each):
- `services/execution/execution-adpt/src/service.stack.ts` — 2 rules
- `services/advisory/advisory-adpt/src/service.stack.ts` — 3 rules
- `services/investor/investor-adpt/src/service.stack.ts` — likely same pattern
- `services/ledger/ledger-adpt/src/service.stack.ts` — likely same pattern

---

## 7. Recommendations

### Immediate (before next test run)
1. Fix adapter EB Rule source filters to use L1 `$or` pattern (matches Ingress construct)
2. Remove `describe.skip` from ledger-ctrl CDC tests (fix sk-prefix mismatch first)
3. Remove try/catch wrappers from advisory-ctrl agent trigger CDC assertions

### Short-term
4. Add `registerCleanup()` calls to 4 agent service tests
5. Add cleanup to AccountSeedingFixture
6. Add at least 1 test per source bus for each adapter
7. Add EventBusTrap to agent service tests for CDC verification
8. Add `client.destroy()` calls in afterAll for AWS SDK clients

### Medium-term
9. Add simulation path tests for ledger-ctrl (DECISION_PACKET_CREATED)
10. Add KB ingestion event tests for agent services
11. Add CallbackIngress tests for decision-workflow-ctrl (requires SF execution support)
12. Convert onboarding-bff to event-driven integration tests
13. Add negative assertions (drain + expect empty) for side-effect verification

---

## 8. Cross-Cutting Issues from Agent Analysis

### DdbSeedFixture Convention Violation
- **broker-ctrl.integration.test.ts** uses DdbSeedFixture to pre-seed ExecutionMode records, violating the "No DDB seeding" project convention. Should create mode records via EXECUTION_MODE_CHANGED events instead.

### Misclassified Test
- **broker-ctrl/order-lifecycle.test.ts** is in `test/integration/` but uses fully-mocked jest dependencies (no real AWS calls). Should be moved to `test/` as a unit test.

### Orchestration (Step Functions) Untested End-to-End
- **broker-ctrl**: OrderStateMachine, HealStateMachine
- **broker-alpaca-adpt**: OrderPollingStateMachine, TransferPollingStateMachine
- **decision-workflow-ctrl**: DecisionWorkflowStateMachine (CallbackIngress — 8 events)
- No integration test exercises SF execution paths. This is the single largest architectural gap.

### Scheduled Lambda Untested
- **execution-ctrl**: staged-order-processor (cron Lambda for processing staged orders when market opens) has no integration test coverage.

### No drain() Usage
Services without `drain()` (stray event detection): execution-adpt, broker-ctrl, broker-sim-adpt, broker-alpaca-adpt, advisory-adpt, investor-adpt, ledger-adpt, all 4 agent services, onboarding-bff. Only execution-ctrl uses drain() exemplary.

### Tests Depend on Ordered Execution
- **investor-bff**, **dashboard-bff**, **ledger-bff**: Query test blocks depend on DDB state created by prior materialization test blocks. If a materialization test is skipped or fails, downstream query tests may produce confusing errors.

---

## 9. Detailed Coverage Appendix

### Advisory Domain: Top 5 Gaps by Impact

1. **decision-workflow-ctrl CallbackIngress** — 8 events (4 agent completions, 2 compliance, 2 user response) covering SF resume + DecisionPacket state transitions. Most complex untested path.
2. **Agent service KB ingestion** — 9 events across investor-profile-ctrl (2), market-intelligence-ctrl (5), portfolio-engine-ctrl (2) with zero coverage. These write to S3 Vectors.
3. **Agent service egress** — 4 services deploy no EventBusTrap, so CDC output is completely unverified.
4. **advisory-ctrl agent trigger CDC** — 11 events have CDC assertions in try/catch that swallow failures.
5. **advisory-adpt forwarding rules** — 10 of 13 cross-domain rules untested.

### Execution Domain: Top 5 Gaps by Impact

1. **broker-ctrl callback-resolver** — 8 event types (SIM_ORDER_FILLED, ALPACA_ORDER_FILLED, etc.) have zero real integration coverage.
2. **broker-ctrl Orchestration** — ORDER_SUBMITTED and BROKER_CIRCUIT_OPEN SF triggers untested.
3. **broker-alpaca-adpt cancel flow** — ALPACA_ORDER_CANCEL_REQUESTED has no test.
4. **execution-ctrl staged-order-processor** — Cron Lambda entirely untested.
5. **broker-sim-adpt rejection** — SIM_ORDER_REJECTED never exercised.

### Investor Domain: Top 3 Gaps by Impact

1. **investor-adpt** — 1/23 forwarded events tested (1 of 3 source buses). Advisory->Investor and Ledger->Investor have zero coverage.
2. **investor-bff egress** — 5/14+ CDC types verified. ONBOARDING_COMPLETED produces 6 entity types (Goal, RiskProfile, OperatingMode, Mandate, Deposit, InvestorProfile) — DDB verified but CDC untrapped.
3. **onboarding-bff** — DDB schema validation only, no end-to-end CDC emission verified.

### Ledger Domain: Top 3 Gaps by Impact

1. **ledger-ctrl CDC entirely skipped** — All egress tests in `describe.skip`. Zero active egress verification.
2. **ledger-ctrl simulation path** — DECISION_PACKET_CREATED (shadow fill, simulated stream) completely untested.
3. **reconciliation-ctrl drift path** — PORTFOLIO_DRIFT_DETECTED never exercised. Test only covers zero-drift happy path.

### Exemplary Tests (reference implementations)

| Service | Why Exemplary |
|---------|--------------|
| sec-edgar-adpt | Covers all conditional CDC routing branches (3 form types), MockApi + SsmOverride |
| investor-ctrl | Full 11/11 ingress + 2/2 CDC egress via dual EventBusTrap |
| dashboard-bff | 20 tests, full materialization + AppSync coverage, RECONCILIATION_COMPLETED no-op verified |
| fred-adpt | Multi-series DDB verification (FEDFUNDS, DGS10) + full pipeline |
| execution-ctrl | Only service using drain() for stray event detection |
