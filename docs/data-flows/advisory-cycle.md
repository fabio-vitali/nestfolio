# Advisory Cycle

> Advisory decision cycle — Step Functions orchestrates 2 sequential agents (Portfolio Engine → Narrative). Investor-profile and market-intelligence outputs are precomputed snapshots — the SF reads them from DWC-local DDB projections via Direct DDB GetItem (no per-cycle agent invocation). PE + AN are the only waitForTaskToken hops; their CDC-emitted PORTFOLIO_COMPLETED/NARRATIVE_COMPLETED (and *_FAILED) events resume the SF via DWC's CallbackIngress. AssembleDecisionPacket reads agent outputs from SF state, runs compliance check, then optionally requests user confirmation before forwarding to execution and ledger.

**Domains:** advisory, investor, execution, ledger

**Trigger:** decision-workflow-ctrl receives one of 7 trigger events (MANDATE_SNAPSHOT_CREATED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED); EventBridge starts the Step Functions execution directly via a native target (no Lambda hop). Pre-cycle snapshots (InvestorProfileSnapshot + MarketSnapshot) are continuously materialised in DWC-local DDB by SnapshotProjectorIngress so the SF can resolve them via Direct DDB GetItem without invoking IP/MI agents.

## Flowchart

```mermaid
flowchart TD
    subgraph advisory["Advisory Domain"]
        decision_workflow_ctrl["decision-workflow-ctrl"]
        market_intelligence_ctrl["market-intelligence-ctrl"]
        portfolio_engine_ctrl["portfolio-engine-ctrl"]
        advisory_narrative_ctrl["advisory-narrative-ctrl"]
        compliance_ctrl["compliance-ctrl"]
        advisory_bff["advisory-bff"]
    end
    subgraph investor["Investor Domain"]
        investor_profile_ctrl["investor-profile-ctrl"]
    end
    decision_workflow_ctrl -->|"MANDATE_SNAPSHOT_CREATED, DECISION_PACKET_CR…"| advisory_bff
    investor_profile_ctrl -->|"INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_…"| decision_workflow_ctrl
    market_intelligence_ctrl -->|"MARKET_SNAPSHOT_UPDATED"| decision_workflow_ctrl
    decision_workflow_ctrl -->|"CONSTRUCT_PORTFOLIO"| portfolio_engine_ctrl
    portfolio_engine_ctrl -->|"PORTFOLIO_COMPLETED, PORTFOLIO_FAILED"| decision_workflow_ctrl
    decision_workflow_ctrl -->|"GENERATE_NARRATIVE"| advisory_narrative_ctrl
    advisory_narrative_ctrl -->|"NARRATIVE_COMPLETED, NARRATIVE_FAILED"| decision_workflow_ctrl
    decision_workflow_ctrl -->|"RECOMMENDATION_PROPOSED"| compliance_ctrl
    compliance_ctrl -->|"DECISION_APPROVED, DECISION_BLOCKED"| decision_workflow_ctrl
    advisory_bff -->|"USER_CONFIRMED, USER_REJECTED"| decision_workflow_ctrl
```

## Sequence Diagram

```mermaid
sequenceDiagram
    box advisory domain
        participant decision_workflow_ctrl as decision-workflow-ctrl
        participant market_intelligence_ctrl as market-intelligence-ctrl
        participant portfolio_engine_ctrl as portfolio-engine-ctrl
        participant advisory_narrative_ctrl as advisory-narrative-ctrl
        participant compliance_ctrl as compliance-ctrl
        participant advisory_bff as advisory-bff
    end
    box investor domain
        participant investor_profile_ctrl as investor-profile-ctrl
    end
    decision_workflow_ctrl->>+investor_profile_ctrl: INVESTOR_PROFILE_UPDATED | MANDATE_ISSUED ...
    investor_profile_ctrl->>+decision_workflow_ctrl: INVESTOR_PROFILE_SNAPSHOT_CREATED | INVESTOR_PROFILE_SNAPSHOT_UPDATED
    decision_workflow_ctrl->>+market_intelligence_ctrl: YAHOO_FINANCE_UPDATED | MARKETWATCH_UPDATED ...
    market_intelligence_ctrl->>+decision_workflow_ctrl: MARKET_SNAPSHOT_UPDATED
    Note over decision_workflow_ctrl: SF ParallelProjections Branch A — Choice (payload…
    Note over decision_workflow_ctrl: SF ParallelProjections Branch B — Direct DDB GetI…
    Note over decision_workflow_ctrl: SF ResolveMandateSnapshot — Choice (payload-first…
    Note over decision_workflow_ctrl: SF emits CONSTRUCT_PORTFOLIO via EventBridge putE…
    decision_workflow_ctrl->>+portfolio_engine_ctrl: CONSTRUCT_PORTFOLIO
    portfolio_engine_ctrl->>+decision_workflow_ctrl: PORTFOLIO_COMPLETED | PORTFOLIO_FAILED
    Note over decision_workflow_ctrl: SF emits GENERATE_NARRATIVE via EventBridge putEv…
    decision_workflow_ctrl->>+advisory_narrative_ctrl: GENERATE_NARRATIVE
    advisory_narrative_ctrl->>+decision_workflow_ctrl: NARRATIVE_COMPLETED | NARRATIVE_FAILED
    Note over decision_workflow_ctrl: SF invokes AssemblePacket Lambda (lambda:invoke, …
    Note over decision_workflow_ctrl: SF emits RECOMMENDATION_PROPOSED with awaitingCom…
    decision_workflow_ctrl->>+compliance_ctrl: RECOMMENDATION_PROPOSED
    compliance_ctrl->>+decision_workflow_ctrl: DECISION_APPROVED | DECISION_BLOCKED
    Note over decision_workflow_ctrl: SF emits USER_CONFIRMATION_REQUESTED via EventBri…
    decision_workflow_ctrl-)advisory_bff: USER_CONFIRMATION_REQUESTED (AdvisoryBus → InvestorBus)
    decision_workflow_ctrl->>+advisory_bff: USER_CONFIRMATION_REQUESTED | DECISION_PACKET_CREATED ...
    Note over advisory_bff: User calls confirmDecision or rejectDecision Grap…
    advisory_bff->>+decision_workflow_ctrl: USER_CONFIRMED | USER_REJECTED
```

## Steps

### Step 1: Cross-domain hop

- **Event:** `INVESTOR_PROFILE_UPDATED | MANDATE_ISSUED | MANDATE_REVOKED`
- **From:** InvestorBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule (AdvisoryIngress-FromInvestor)

### Step 2: Cross-domain hop

- **Event:** `ORDER_FILLED | ORDER_REJECTED | ORDER_CANCELLED | DEPOSIT_DETECTED | PORTFOLIO_DRIFT_DETECTED`
- **From:** ExecutionBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule (AdvisoryIngress-FromExecution)

### Step 3: decision-workflow-ctrl

- **Receives:** `MANDATE_ISSUED | OPERATING_MODE_CHANGED`
- **Via:** AdvisoryBus -> SQS -> MandateProjectorIngress (handlers/mandate-projector.ts)
- **State change:** materializeToTable writes MandateSnapshot row with operatingMode + level + status='ACTIVE' (MANDATE_ISSUED → record; OPERATING_MODE_CHANGED → update operatingMode)
- **Emits:** `MANDATE_SNAPSHOT_CREATED (via Egress CDC on MandateSnapshot:INSERT only — operatingMode changes do NOT re-trigger the first decision)`
- **Idempotent:** yes

### Step 4: investor-profile-ctrl

- **Receives:** `INVESTOR_PROFILE_UPDATED | MANDATE_ISSUED | OPERATING_MODE_CHANGED`
- **Via:** AdvisoryBus -> SQS -> investor-profile-ctrl-Ingress
- **State change:** LangGraph investor-profile agent (Haiku goals + Opus risk-assessment, parallel) runs once per input event against the Regulatory KB; materializeToTable writes the InvestorProfileSnapshot row carrying the full agent output (operatingMode + goalInterpretation + riskEvaluation). No AgentCore Memory write on the critical path; no SF callback (pre-cycle precomputation).

- **Emits:** `INVESTOR_PROFILE_SNAPSHOT_CREATED (CDC, InvestorProfileSnapshot:INSERT) | INVESTOR_PROFILE_SNAPSHOT_UPDATED (CDC, InvestorProfileSnapshot:MODIFY)`
- **Idempotent:** yes

### Step 5: decision-workflow-ctrl

- **Receives:** `INVESTOR_PROFILE_SNAPSHOT_CREATED | INVESTOR_PROFILE_SNAPSHOT_UPDATED`
- **Via:** AdvisoryBus -> SQS -> SnapshotProjectorIngress (handlers/snapshot-projector.ts)
- **State change:** materializeToTable mirrors IP-ctrl's snapshot into DWC's own DDB table as the InvestorProfileSnapshot row (pk=`InvestorProfileSnapshot#{tenantId}#{userId}`, sk='InvestorProfileSnapshot'). The SF reads this via Direct DDB GetItem during the cycle. CREATED → record; UPDATED → update. Missing subject.agentOutput → NotRetryableError.

- **Emits:** `(none — local projection)`
- **Idempotent:** yes

### Step 6: market-intelligence-ctrl

- **Receives:** `YAHOO_FINANCE_UPDATED | MARKETWATCH_UPDATED | SEC_8K_FILED | FRED_INDICATORS_UPDATED | ALPHA_VANTAGE_NEWS_UPDATED | MARKET_SNAPSHOT_REFRESH_TICK`
- **Via:** AdvisoryBus -> SQS -> market-intelligence-ctrl-Ingress
- **State change:** LangGraph market-intelligence agent (Sonnet) runs against the Market KB plus deterministic in-process context (market-data + instrument-universe pre-fetch); materializeToTable writes the MarketSnapshot row (one per region) carrying the agent output. Also writes legacy AgentInvocation row (emits MARKET_SIGNAL_DETECTED on insert only). Slow-tier tick (every 15 min) backstops idle feed periods; on stack Create a BootstrapSnapshotFn custom resource emits a synthetic tick and polls until the row materialises (5-min deadline).

- **Emits:** `MARKET_SNAPSHOT_UPDATED (CDC, MarketSnapshot:INSERT and MODIFY) | MARKET_SIGNAL_DETECTED (CDC, AgentInvocation:INSERT) | MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED (EventBridgeTraceEmitter)`
- **Idempotent:** yes

### Step 7: decision-workflow-ctrl

- **Receives:** `MARKET_SNAPSHOT_UPDATED`
- **Via:** AdvisoryBus -> SQS -> SnapshotProjectorIngress (handlers/snapshot-projector.ts)
- **State change:** materializeToTable mirrors MI-ctrl's snapshot into DWC's own DDB table as the MarketSnapshot row (pk=`MarketSnapshot#{region}`, sk='MarketSnapshot'). The SF reads this via Direct DDB GetItem during the cycle. Missing subject.agentOutput → NotRetryableError.

- **Emits:** `(none — local projection)`
- **Idempotent:** yes

### Step 8: decision-workflow-ctrl

- **Receives:** `MANDATE_SNAPSHOT_CREATED | INVESTOR_PROFILE_UPDATED | PORTFOLIO_DRIFT_DETECTED | ORDER_FILLED | ORDER_REJECTED | ORDER_CANCELLED | DEPOSIT_DETECTED`
- **Via:** AdvisoryBus -> EB Rule -> SfnStateMachine target (Orchestration.triggers, direct)
- **State change:** New DecisionStateMachine execution starts directly from the EventBridge target. The 7-event trigger list is wired declaratively on Orchestration.triggers. Entry Pass state (UnpackTriggerEnvelope) mints decisionId via States.UUID() and flattens {context.tenantId, context.userId, context.region, type, subject} to top-level SF state so every downstream putEvents task state can emit the event-processor envelope ({id, type, timestamp, subject, context}).

- **Emits:** `(none -- SF internal)`
- **Idempotent:** no

### Step 9: decision-workflow-ctrl

- **Action:** SF ParallelProjections Branch A — Choice (payload-first hoist when trigger carries an InvestorProfile body) else Direct DDB GetItem on InvestorProfileSnapshot (pk=`InvestorProfileSnapshot#{tenantId}#{userId}`, sk='InvestorProfileSnapshot'). No event emitted; no Lambda invoked.
- **State change:** SF state Parameters carry investorProfile.agentOutput (operatingMode + goalInterpretation + riskEvaluation) for downstream PE + AN steps.

### Step 10: decision-workflow-ctrl

- **Action:** SF ParallelProjections Branch B — Direct DDB GetItem on MarketSnapshot (pk=`MarketSnapshot#{region}`, sk='MarketSnapshot'). No payload-first path (market signals are a global projection). No event emitted; no Lambda invoked.
- **State change:** SF state Parameters carry marketSnapshot.agentOutput for downstream PE + AN steps.

### Step 11: decision-workflow-ctrl

- **Action:** SF ResolveMandateSnapshot — Choice (payload-first hoist when trigger carries operatingMode) else LookupMandateSnapshot via Direct DDB GetItem. No event emitted.
- **State change:** SF state Parameters carry mandateSnapshot (operatingMode + level + status='ACTIVE').

### Step 12: decision-workflow-ctrl

- **Action:** SF emits CONSTRUCT_PORTFOLIO via EventBridge putEvents.waitForTaskToken
- **Emits:** `CONSTRUCT_PORTFOLIO (SF EventBridge integration with taskToken)`

### Step 13: portfolio-engine-ctrl

- **Receives:** `CONSTRUCT_PORTFOLIO`
- **Via:** AdvisoryBus -> SQS -> portfolio-engine-ctrl-Ingress
- **State change:** LangGraph portfolio-construction agent (Opus) runs against Fund KB; reads upstream agent outputs (operatingMode + investor-profile + market-analysis) directly from SF state Parameters (no AgentCore Memory roundtrip); materializeToTable writes AgentCompletion row on success (carries taskToken + agentOutput {allocations, trades, metadata}) or AgentFailure row on failure (carries taskToken + errorCode + cause). No states:SendTask* IAM grant on this service; the CDC event from the Egress is the sole bridge back to the SF.

- **Emits:** `PORTFOLIO_COMPLETED (CDC, AgentCompletion:INSERT) | PORTFOLIO_FAILED (CDC, AgentFailure:INSERT) | PORTFOLIO_CONSTRUCTION_PROPOSED (CDC, AgentInvocation:INSERT, legacy)`
- **Idempotent:** no

### Step 14: decision-workflow-ctrl

- **Receives:** `PORTFOLIO_COMPLETED | PORTFOLIO_FAILED`
- **Via:** AdvisoryBus -> SQS -> decision-workflow-ctrl-CallbackIngress
- **State change:** PORTFOLIO_COMPLETED: SendTaskSuccess resumes SF with agentOutput; sfn-callback also persists an AgentOutput record for the cycle. PORTFOLIO_FAILED: SendTaskFailure with errorCode + cause; SF state catches and the cycle ends as DECISION_WORKFLOW_FAILED.

- **Emits:** `AGENT_OUTPUT_CREATED | AGENT_OUTPUT_UPDATED (CDC, AgentOutput insert/modify, on success path)`
- **Idempotent:** yes

### Step 15: decision-workflow-ctrl

- **Action:** SF emits GENERATE_NARRATIVE via EventBridge putEvents.waitForTaskToken
- **Emits:** `GENERATE_NARRATIVE (SF EventBridge integration with taskToken)`

### Step 16: advisory-narrative-ctrl

- **Receives:** `GENERATE_NARRATIVE`
- **Via:** AdvisoryBus -> SQS -> advisory-narrative-ctrl-Ingress
- **State change:** LangGraph narrative agent (Haiku 4.5) runs against Explainability KB; reads upstream agent outputs from SF state Parameters; materializeToTable writes AgentCompletion row on success (carries taskToken + agentOutput carrying explanation) or AgentFailure row on failure. No states:SendTask* IAM grant on this service.

- **Emits:** `NARRATIVE_COMPLETED (CDC, AgentCompletion:INSERT) | NARRATIVE_FAILED (CDC, AgentFailure:INSERT) | EXPLANATION_GENERATED (CDC, ReasoningOutput:INSERT)`
- **Idempotent:** no

### Step 17: decision-workflow-ctrl

- **Receives:** `NARRATIVE_COMPLETED | NARRATIVE_FAILED`
- **Via:** AdvisoryBus -> SQS -> decision-workflow-ctrl-CallbackIngress
- **State change:** NARRATIVE_COMPLETED: SendTaskSuccess resumes SF with agentOutput (explanation); sfn-callback persists an AgentOutput record. NARRATIVE_FAILED: SendTaskFailure; SF state catches and the cycle ends as DECISION_WORKFLOW_FAILED.

- **Emits:** `AGENT_OUTPUT_CREATED | AGENT_OUTPUT_UPDATED (CDC, AgentOutput insert/modify, on success path)`
- **Idempotent:** yes

### Step 18: decision-workflow-ctrl

- **Action:** SF invokes AssemblePacket Lambda (lambda:invoke, synchronous — NOT waitForTaskToken)
- **State change:** Reads all 4 agent outputs from SF state Parameters — investor-profile + market from the precomputed snapshots resolved in Phase 2a/2b, portfolio + narrative from the waitForTaskToken callbacks. No AgentCore Memory reads. Builds proposedTrades from portfolio.allocations; extracts explanation from narrative.explainability.rationale (fallback summary). Writes DecisionPacket row with status='PENDING' via putIfNotExists (idempotent under SF retries).

- **Emits:** `DECISION_PACKET_CREATED (CDC, DecisionPacket:INSERT)`
- **Idempotent:** yes

### Step 19: decision-workflow-ctrl

- **Action:** SF emits RECOMMENDATION_PROPOSED with awaitingCompliance=true via EventBridge putEvents.waitForTaskToken; waits up to 24h for compliance result
- **Emits:** `RECOMMENDATION_PROPOSED (SF EventBridge integration with taskToken)`

### Step 20: compliance-ctrl

- **Receives:** `RECOMMENDATION_PROPOSED`
- **Via:** AdvisoryBus -> SQS -> compliance-ctrl-Ingress
- **State change:** Loads GuardrailPolicy (MandateSnapshot) from DDB — projected ahead of time from MANDATE_ISSUED and OPERATING_MODE_CHANGED events (not from the InvestorProfile carrier). Runs MandateValidator -> GuardrailEvaluator -> SuitabilityChecker -> AuthorityResolver (mode-specific: maxSingleTradePercent, monthlyTurnoverCapPercent, singleEtfConcentrationPercent for L1/L2 resolution); writes ComplianceCheck + AuditArtifact records to DDB.

- **Emits:** `DECISION_APPROVED or DECISION_BLOCKED (CDC, field dispatch on ComplianceCheck.result — APPROVED->DECISION_APPROVED, BLOCKED->DECISION_BLOCKED), AUDIT_ARTIFACT (CDC, AuditArtifact:INSERT)`
- **Idempotent:** yes

### Step 21: decision-workflow-ctrl

- **Receives:** `DECISION_APPROVED | DECISION_BLOCKED`
- **Via:** AdvisoryBus -> SQS -> decision-workflow-ctrl-CallbackIngress
- **State change:** SendTaskSuccess resumes SF with {decision, authorityLevel}. If DECISION_APPROVED: updates DecisionPacket status to APPROVED (L1) or AWAITING_CONFIRMATION (L2). If DECISION_BLOCKED: updates DecisionPacket status to BLOCKED.

- **Emits:** `DECISION_PACKET_UPDATED (CDC, DecisionPacket:MODIFY auto-expand)`
- **Idempotent:** yes

### Step 22: decision-workflow-ctrl

- **Action:** SF emits USER_CONFIRMATION_REQUESTED via EventBridge putEvents.waitForTaskToken; waits up to 72h for user response
- **Emits:** `USER_CONFIRMATION_REQUESTED (SF EventBridge integration with taskToken)`

### Step 23: Cross-domain hop

- **Event:** `USER_CONFIRMATION_REQUESTED`
- **From:** AdvisoryBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule (InvestorIngress-FromAdvisory)

### Step 24: advisory-bff

- **Receives:** `MANDATE_SNAPSHOT_CREATED | INVESTOR_PROFILE_UPDATED | PORTFOLIO_DRIFT_DETECTED | ORDER_FILLED | ORDER_REJECTED | ORDER_CANCELLED | DEPOSIT_DETECTED`
- **Via:** AdvisoryBus -> SQS -> advisory-bff-Ingress
- **State change:** Increments AdvisoryStatus.inFlightCount; sets lastTriggerAt; emits ADVISORY_STATUS_UPDATED via CDC
- **Emits:** `ADVISORY_STATUS_UPDATED (CDC, AdvisoryStatus insert/modify)`
- **Idempotent:** yes

### Step 25: advisory-bff

- **Receives:** `USER_CONFIRMATION_REQUESTED | DECISION_PACKET_CREATED | DECISION_APPROVED | DECISION_BLOCKED | DECISION_PACKET_UPDATED`
- **Via:** AdvisoryBus -> SQS -> advisory-bff-Ingress
- **State change:** Materialises DecisionReadModel for GraphQL queries; user sees decision in UI. DECISION_PACKET_CREATED also decrements AdvisoryStatus.inFlightCount (counter closes at packet-creation time).

- **Emits:** `DECISION_READ_MODEL_CREATED | DECISION_READ_MODEL_UPDATED (CDC, DecisionReadModel insert/modify) | USER_INTERACTION_CREATED (CDC, UserInteraction insert) | ADVISORY_STATUS_UPDATED (CDC, AdvisoryStatus modify on DECISION_PACKET_CREATED)`
- **Idempotent:** yes

### Step 26: advisory-bff

- **Action:** User calls confirmDecision or rejectDecision GraphQL mutation; BFF writes UserConfirmation or UserRejection record to DDB
- **State change:** Writes UserConfirmation or UserRejection record
- **Emits:** `USER_CONFIRMED (CDC, UserConfirmation:INSERT) or USER_REJECTED (CDC, UserRejection:INSERT)`

### Step 27: decision-workflow-ctrl

- **Receives:** `USER_CONFIRMED | USER_REJECTED`
- **Via:** AdvisoryBus -> SQS -> decision-workflow-ctrl-CallbackIngress
- **State change:** SendTaskSuccess resumes SF with {decision}. If USER_CONFIRMED: updates DecisionPacket status to CONFIRMED. If USER_REJECTED: updates DecisionPacket status to REJECTED with rejectionReason.

- **Emits:** `DECISION_PACKET_UPDATED (CDC, DecisionPacket:MODIFY auto-expand)`
- **Idempotent:** yes

### Step 28: Cross-domain hop

- **Event:** `DECISION_APPROVED`
- **From:** AdvisoryBus
- **To:** ExecutionBus
- **Via:** execution-adpt EB rule (ExecutionIngress-FromAdvisory)

### Step 29: Cross-domain hop

- **Event:** `DECISION_APPROVED`
- **From:** AdvisoryBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule (InvestorIngress-FromAdvisory)

### Step 30: Cross-domain hop

- **Event:** `DECISION_PACKET_CREATED`
- **From:** AdvisoryBus
- **To:** LedgerBus
- **Via:** ledger-adpt EB rule (LedgerIngress-FromAdvisory)

### Step 31: Cross-domain hop

- **Event:** `DECISION_PACKET_CREATED`
- **From:** AdvisoryBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule (InvestorIngress-FromAdvisory)

### Step 32: Cross-domain hop

- **Event:** `DECISION_BLOCKED`
- **From:** AdvisoryBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule (InvestorIngress-FromAdvisory)

### Step 33: Cross-domain hop

- **Event:** `EXPLANATION_GENERATED`
- **From:** AdvisoryBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule (InvestorIngress-FromAdvisory)

### Step 34: Cross-domain hop

- **Event:** `USER_CONFIRMED`
- **From:** AdvisoryBus
- **To:** ExecutionBus
- **Via:** execution-adpt EB rule (ExecutionIngress-FromAdvisory)

## Success Criteria

- InvestorProfileSnapshot + MarketSnapshot projections exist in DWC-local DDB before the cycle begins (continuously materialised; MarketSnapshot bootstrapped on stack Create)
- SF resolves both snapshots via Direct DDB GetItem (no IP/MI agent invocation per cycle)
- PE + AN agents return via materializeToTable AgentCompletion CDC within their windows; PORTFOLIO_COMPLETED / NARRATIVE_COMPLETED reach DWC's CallbackIngress and SendTaskSuccess resumes the SF
- AssemblePacket writes a DecisionPacket row; CDC emits DECISION_PACKET_CREATED reaching advisory-bff (UI), ledger-adpt (audit), and investor-bff (decision history)
- compliance-ctrl emits exactly one of DECISION_APPROVED / DECISION_BLOCKED
- For L1 approved DecisionPacket.status='APPROVED' and DECISION_APPROVED reaches ExecutionBus
- For L2 approved confirmDecision/rejectDecision mutation lands within 72h; USER_CONFIRMED causes DECISION_APPROVED propagation; USER_REJECTED ends the cycle with no execution

## Failure Modes

- **trigger ingestion fails:** EventBridge → SF native target invocation fails or is throttled; SF not started; trigger event sits on source-bus DLQ. No automatic retry of the cycle; manual replay.
- **InvestorProfileSnapshot missing at cycle start (IP-ctrl Ingress DLQ accumulating, or new tenant never went through onboarding):** SF Branch A's Choice payload-first path is the safety net only when the trigger payload carries the IP body; otherwise the Direct DDB GetItem returns no row and SF state catches the error.
- **MarketSnapshot missing at cycle start (MI-ctrl Ingress DLQ, or pre-bootstrap race):** the BootstrapSnapshotFn custom resource closes the cold-start window; otherwise Direct DDB GetItem returns no row and SF state catches the error.
- **SnapshotProjectorIngress fails (DWC-local mirror falls behind IP/MI source rows):** DWC's SF reads a stale snapshot until the SQS retry succeeds; missing subject.agentOutput → NotRetryableError so corrupt envelopes go straight to DLQ.
- **PE / AN agent invocation fails (Lambda exception, AgentCore degraded response):** handler writes AgentFailure row → CDC emits PORTFOLIO_FAILED / NARRATIVE_FAILED → CallbackIngress calls SendTaskFailure → SF state catches and the cycle fails with DECISION_WORKFLOW_FAILED.
- **PE / AN agent stalls past waitForTaskToken window:** SF TaskTimedOut fires; CDC-based completion event arriving after the timeout is logged and ignored. Manual replay; no auto-retry.
- **AssemblePacket fails:** Lambda invocation error; SF state catches the error. Cycle ends without a DecisionPacket row. No retry.
- **compliance fails:** compliance-ctrl Ingress DLQ; WaitForCompliance times out at 24h. Manual DLQ replay; SF can resume only if token is still valid (won't be after 24h).
- **compliance callback fails:** CallbackIngress DLQ; SF stuck waiting; eventually times out at 24h. Manual replay (token-lag risk applies).
- **user confirmation cross-bus hop fails:** investor-adpt FromAdvisoryDLQ accumulates; user never sees the request. SF will time out at 72h.
- **user callback fails:** CallbackIngress DLQ; SF stuck waiting. Manual replay within the 72h window.
