# Advisory Domain Integration Test Coverage Analysis

Generated: 2026-04-08

---

## 1. advisory-ctrl

**Test file**: `test/integration/advisory-ctrl.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions
**Ingress tested**: All 15 -- DECISION_BLOCKED, DECISION_APPROVED (L1+L2), USER_CONFIRMED, USER_REJECTED, MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
**Ingress NOT tested**: None -- full coverage
**Egress tested**: DECISION_PACKET_CREATED (best-effort via trap), DECISION_PACKET_UPDATED, AGENT_INVOCATION_*, WORKFLOW_STATE_* (trapped but assertions are try/catch best-effort)
**Egress NOT tested**: All CDC assertions are best-effort (catch blocks swallow failures). AGENT_INVOCATION and WORKFLOW_STATE are trapped but never explicitly asserted in individual tests.
**Side-effect checks**: Yes -- DDB writes verified for compliance and user-response paths; CDC trap deployed for agent trigger events
**Issues**: Agent trigger CDC assertions are entirely inside try/catch blocks -- they will never fail the test even if CDC is completely broken. This means egress verification is effectively absent for the 11 trigger events.

---

## 2. advisory-adpt

**Test files**: `test/integration/from-execution.integration.test.ts`, `from-investor.integration.test.ts`, `from-ledger.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap
**Ingress tested**: ORDER_FILLED (from execution), GOAL_UPDATED (from investor), PORTFOLIO_UPDATED (from ledger)
**Ingress NOT tested**: From Investor: GOAL_CREATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED (6 of 7 untested). From Execution: ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED (3 of 4 untested). From Ledger: PORTFOLIO_DRIFT_DETECTED (1 of 2 untested).
**Egress tested**: N/A (stateless adapter, no CDC)
**Egress NOT tested**: N/A
**Side-effect checks**: Yes -- verifies event arrives on advisory bus with correct detailType and tenantId
**Issues**: Only 3 of 13 forwarding rules are tested (one per source bus). Pattern is identical across rules so risk is low, but 10 event types have no integration coverage.

---

## 3. advisory-bff

**Test file**: `test/integration/advisory-bff.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions, CognitoFixture, AppSyncClient
**Ingress tested**: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED -- all 5
**Ingress NOT tested**: None -- full coverage
**Egress tested**: USER_CONFIRMED (via confirmDecision mutation CDC), USER_REJECTED (via rejectDecision mutation CDC)
**Egress NOT tested**: DECISION_READ_MODEL_CREATED/UPDATED, USER_INTERACTION -- these CDC events from ingress materializations are not trapped/verified
**Side-effect checks**: Yes -- DDB writes verified (DecisionReadModel, UserConfirmation, UserRejection records), CDC events verified for mutations, AppSync response fields checked
**Issues**: Well-structured. The inline polling loop (while/setTimeout) could use the `waitForFieldValue` helper pattern from advisory-ctrl for consistency. DECISION_READ_MODEL CDC events are never verified even though they are the primary egress output.

---

## 4. advisory-narrative-ctrl

**Test file**: `test/integration/advisory-narrative-ctrl.integration.test.ts`
**Fixtures**: EventBridgeClient, TableAssertions
**Ingress tested**: GENERATE_NARRATIVE
**Ingress NOT tested**: DECISION_FEEDBACK (subscribed in stack, handler exists, not tested)
**Egress tested**: None -- no EventBusTrap deployed
**Egress NOT tested**: EXPLANATION_GENERATED (ReasoningOutput insert CDC)
**Side-effect checks**: Partial -- verifies AgentInvocation DDB write only
**Issues**: No EventBusTrap deployed, so zero egress verification. DECISION_FEEDBACK handler is a no-op stub in production wiring but has a handler entry -- should still be tested. Test does not call `table.registerCleanup()` (cleanup is manual via ctx.cleanup only).

---

## 5. alpha-vantage-adpt

**Test file**: `test/integration/alpha-vantage-adpt.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions, MockApiFixture, SsmOverrideFixture
**Ingress tested**: FETCH_ALPHA_VANTAGE_REQUESTED -- full coverage (only 1 event type)
**Ingress NOT tested**: None
**Egress tested**: ALPHA_VANTAGE_NEWS_UPDATED, ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED -- both CDC events verified
**Egress NOT tested**: None -- full egress coverage
**Side-effect checks**: Yes -- DDB write (AlphaVantageArticle) + CDC event verification
**Issues**: None significant. Well-structured mock-based test with full ingress/egress coverage.

---

## 6. compliance-ctrl

**Test file**: `test/integration/compliance-ctrl.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions
**Ingress tested**: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, MANDATE_CREATED (3 of 5)
**Ingress NOT tested**: MANDATE_UPDATED, OPERATING_MODE_CHANGED
**Egress tested**: DECISION_APPROVED or DECISION_BLOCKED (CDC from ComplianceCheck insert)
**Egress NOT tested**: AUDIT_ARTIFACT (AuditArtifact CDC never verified)
**Side-effect checks**: Yes -- CDC event verified for decision packet tests; DDB write verified for mandate test
**Issues**: MANDATE_UPDATED is handled identically to MANDATE_CREATED in code so risk is low. OPERATING_MODE_CHANGED handler is a skip() no-op -- still should be integration-tested. AUDIT_ARTIFACT CDC is never verified. The compliance check test uses `expect(['DECISION_APPROVED', 'DECISION_BLOCKED']).toContain()` which is correct but doesn't test each outcome deterministically.

---

## 7. decision-workflow-ctrl

**Test file**: `test/integration/decision-workflow-ctrl.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions
**Ingress tested (TriggerIngress)**: All 11 -- MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
**Ingress NOT tested (CallbackIngress)**: All 8 -- INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED (documented: requires running SF execution)
**Egress tested**: WORKFLOW_TRIGGER_CREATED (1 test verifies CDC chain)
**Egress NOT tested**: DECISION_PACKET_CREATED/UPDATED, AGENT_OUTPUT_CREATED (trapped but only WORKFLOW_TRIGGER_CREATED is asserted)
**Side-effect checks**: Yes -- DDB WorkflowTrigger records verified for all 11 triggers; CDC verified for MANDATE_CREATED only
**Issues**: CallbackIngress (sfn-callback.ts) is entirely untested -- this is the most complex handler with compliance/user-response state transitions. Documented as deferred but represents a significant gap. CDC verification only covers WORKFLOW_TRIGGER_CREATED for 1 of 11 triggers. Manual cleanup in afterAll for queryItems-based records.

---

## 8. fred-adpt

**Test file**: `test/integration/fred-adpt.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions, MockApiFixture, SsmOverrideFixture
**Ingress tested**: FETCH_FRED_REQUESTED -- full coverage
**Ingress NOT tested**: None
**Egress tested**: FRED_INDICATORS_UPDATED -- verified
**Egress NOT tested**: None -- full coverage
**Side-effect checks**: Yes -- DDB writes verified (FredIndicator records, multiple series), CDC event verified
**Issues**: None significant. Thorough test with multi-series verification.

---

## 9. investor-profile-ctrl

**Test file**: `test/integration/investor-profile-ctrl.integration.test.ts`
**Fixtures**: EventBridgeClient, TableAssertions
**Ingress tested**: ANALYZE_INVESTOR_PROFILE (1 of 3)
**Ingress NOT tested**: DECISION_BLOCKED, DECISION_APPROVED (KB ingestion events -- subscribed in stack, separate handler)
**Egress tested**: None -- no EventBusTrap deployed
**Egress NOT tested**: GOAL_INTERPRETATION_PRODUCED (AgentInvocation insert), RISK_EVALUATION_PRODUCED (ReasoningOutput insert)
**Side-effect checks**: Partial -- DDB AgentInvocation write verified
**Issues**: No EventBusTrap, so zero egress verification. KB ingestion events (DECISION_BLOCKED, DECISION_APPROVED) are not tested -- these write to S3 Vectors and trigger KB sync. Missing `table.registerCleanup()` call.

---

## 10. market-intelligence-ctrl

**Test file**: `test/integration/market-intelligence-ctrl.integration.test.ts`
**Fixtures**: EventBridgeClient, TableAssertions
**Ingress tested**: ANALYZE_MARKET (1 of 6)
**Ingress NOT tested**: YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED, FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED (5 feed ingestion events)
**Egress tested**: None -- no EventBusTrap deployed
**Egress NOT tested**: MARKET_SIGNAL_DETECTED (AgentInvocation insert CDC)
**Side-effect checks**: Partial -- DDB AgentInvocation write verified
**Issues**: 5 of 6 ingress events untested. The feed ingestion events are subscribed in the stack and routed to a KB ingestion handler -- none are integration-tested. No egress verification. Missing `table.registerCleanup()` call.

---

## 11. marketwatch-adpt

**Test file**: `test/integration/marketwatch-adpt.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions, MockApiFixture, SsmOverrideFixture
**Ingress tested**: FETCH_MARKETWATCH_REQUESTED -- full coverage
**Ingress NOT tested**: None
**Egress tested**: MARKETWATCH_UPDATED -- verified
**Egress NOT tested**: None -- full coverage
**Side-effect checks**: Yes -- DDB writes verified (topstories + marketpulse feeds), CDC event verified
**Issues**: None significant. Well-structured.

---

## 12. portfolio-engine-ctrl

**Test file**: `test/integration/portfolio-engine-ctrl.integration.test.ts`
**Fixtures**: EventBridgeClient, TableAssertions
**Ingress tested**: CONSTRUCT_PORTFOLIO (1 of 3)
**Ingress NOT tested**: SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED (KB ingestion events)
**Egress tested**: None -- no EventBusTrap deployed
**Egress NOT tested**: PORTFOLIO_CONSTRUCTION_PROPOSED (AgentInvocation insert), REBALANCE_PLAN_PRODUCED (ReasoningOutput insert)
**Side-effect checks**: Partial -- DDB AgentInvocation write verified
**Issues**: KB ingestion events (SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED) untested. No egress verification. Missing `table.registerCleanup()` call.

---

## 13. sec-edgar-adpt

**Test file**: `test/integration/sec-edgar-adpt.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions, MockApiFixture, SsmOverrideFixture
**Ingress tested**: FETCH_SEC_EDGAR_REQUESTED -- full coverage
**Ingress NOT tested**: None
**Egress tested**: SEC_8K_FILED, SEC_PROSPECTUS_UPDATED, SEC_10K_UPDATED -- all 3 form-type CDC events verified
**Egress NOT tested**: None -- full coverage
**Side-effect checks**: Yes -- DDB writes verified per CIK/form type, CDC events verified per form type
**Issues**: None. Exemplary test -- covers all CDC routing branches.

---

## 14. yahoo-finance-adpt

**Test file**: `test/integration/yahoo-finance-adpt.integration.test.ts`
**Fixtures**: EventBridgeClient, EventBusTrap, TableAssertions, MockApiFixture, SsmOverrideFixture
**Ingress tested**: FETCH_YAHOO_FINANCE_REQUESTED -- full coverage
**Ingress NOT tested**: None
**Egress tested**: YAHOO_FINANCE_UPDATED -- verified
**Egress NOT tested**: None -- full coverage
**Side-effect checks**: Yes -- DDB writes (VTI + BND tickers), CDC event verified
**Issues**: None significant.

---

## Summary

### Full Coverage (ingress + egress verified)
- **alpha-vantage-adpt** -- exemplary
- **fred-adpt** -- exemplary
- **marketwatch-adpt** -- exemplary
- **sec-edgar-adpt** -- exemplary (best in class: tests all CDC routing branches)
- **yahoo-finance-adpt** -- exemplary
- **advisory-bff** -- full ingress, partial egress (DECISION_READ_MODEL CDC not verified)
- **advisory-ctrl** -- full ingress, but CDC assertions are best-effort (never fail)

### Partial Coverage
| Service | Ingress Tested | Ingress Total | Egress Verified |
|---|---|---|---|
| advisory-adpt | 3 | 13 | N/A (stateless) |
| compliance-ctrl | 3 | 5 | Partial (no AUDIT_ARTIFACT) |
| decision-workflow-ctrl | 11/11 trigger, 0/8 callback | 19 | 1 of 3 types |
| advisory-narrative-ctrl | 1 | 2 | None |
| investor-profile-ctrl | 1 | 3 | None |
| market-intelligence-ctrl | 1 | 6 | None |
| portfolio-engine-ctrl | 1 | 3 | None |

### Top Gaps
1. **decision-workflow-ctrl CallbackIngress** (8 events) -- most impactful gap; covers the SF callback path with compliance/user-response state transitions
2. **Agent service KB ingestion** -- investor-profile-ctrl (2), market-intelligence-ctrl (5), portfolio-engine-ctrl (2) -- 9 ingestion events with zero coverage
3. **Agent service egress** -- 4 services (narrative, investor-profile, market-intelligence, portfolio-engine) have no EventBusTrap deployed, so zero CDC verification
4. **advisory-adpt** -- 10 of 13 forwarding rules untested (low risk given identical pattern, but no coverage)
5. **advisory-ctrl agent triggers** -- CDC assertions are all try/catch no-op, effectively untested

### Common Issues
- **Missing `table.registerCleanup()`**: advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl
- **No EventBusTrap in agent services**: The 4 agent services (narrative, investor-profile, market-intelligence, portfolio-engine) only verify DDB writes, never CDC output
- **Best-effort CDC assertions**: advisory-ctrl wraps all agent trigger CDC checks in try/catch, making them non-failing
