# Portfolio Rebalance

> Portfolio drift detected by reconciliation-ctrl triggers advisory decision cycle which produces rebalance orders

**Domains:** ledger, advisory, execution

**Trigger:** reconciliation-ctrl emits PORTFOLIO_DRIFT_DETECTED (CDC from DriftRecord insert)

## Flowchart

```mermaid
flowchart TD
    subgraph ledger["Ledger Domain"]
        reconciliation_ctrl["reconciliation-ctrl"]
        investor_profile_ctrl["investor-profile-ctrl"]
    end
    subgraph advisory["Advisory Domain"]
        decision_workflow_ctrl["decision-workflow-ctrl"]
        advisory_ctrl["advisory-ctrl"]
        market_intelligence_ctrl["market-intelligence-ctrl"]
        portfolio_engine_ctrl["portfolio-engine-ctrl"]
        advisory_narrative_ctrl["advisory-narrative-ctrl"]
        compliance_ctrl["compliance-ctrl"]
    end
    subgraph execution["Execution Domain"]
        execution_ctrl["execution-ctrl"]
    end
    reconciliation_ctrl -->|"PORTFOLIO_DRIFT_DETECTED, PORTFOLIO_DRIFT_DE…"| decision_workflow_ctrl
    compliance_ctrl -.->|"DECISION_APPROVED"| execution_ctrl
```

## Sequence Diagram

```mermaid
sequenceDiagram
    box ledger domain
        participant reconciliation_ctrl as reconciliation-ctrl
        participant investor_profile_ctrl as investor-profile-ctrl
    end
    box advisory domain
        participant decision_workflow_ctrl as decision-workflow-ctrl
        participant advisory_ctrl as advisory-ctrl
        participant market_intelligence_ctrl as market-intelligence-ctrl
        participant portfolio_engine_ctrl as portfolio-engine-ctrl
        participant advisory_narrative_ctrl as advisory-narrative-ctrl
        participant compliance_ctrl as compliance-ctrl
    end
    box execution domain
        participant execution_ctrl as execution-ctrl
    end
    Note over reconciliation_ctrl: Reconciliation detects position drift exceeding t…
    reconciliation_ctrl-)decision_workflow_ctrl: PORTFOLIO_DRIFT_DETECTED (LedgerBus → AdvisoryBus)
    reconciliation_ctrl->>+advisory_ctrl: PORTFOLIO_DRIFT_DETECTED
    advisory_ctrl->>+investor_profile_ctrl: ANALYZE_INVESTOR_PROFILE
    investor_profile_ctrl->>+market_intelligence_ctrl: ANALYZE_MARKET
    market_intelligence_ctrl->>+portfolio_engine_ctrl: CONSTRUCT_PORTFOLIO
    portfolio_engine_ctrl->>+advisory_narrative_ctrl: GENERATE_NARRATIVE
    advisory_narrative_ctrl->>+compliance_ctrl: DECISION_PACKET_CREATED
    compliance_ctrl-)execution_ctrl: DECISION_APPROVED (AdvisoryBus → ExecutionBus)
```

## Steps

### Step 1: reconciliation-ctrl

- **Action:** Reconciliation detects position drift exceeding threshold
- **State change:** Writes DriftRecord to DDB (tenantId, instrument, intentQty, settlementQty, drift)
- **Emits:** `PORTFOLIO_DRIFT_DETECTED (CDC from DriftRecord insert)`
- **Idempotent:** yes

### Step 2: Cross-domain hop

- **Event:** `PORTFOLIO_DRIFT_DETECTED`
- **From:** LedgerBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule (AdvisoryIngress-FromLedger, DLQ FromLedgerDLQ 14d)

### Step 3: decision-workflow-ctrl

- **Receives:** `PORTFOLIO_DRIFT_DETECTED`
- **Via:** AdvisoryBus → SQS → decision-workflow-ctrl-trigger-ingress
- **State change:** Writes WorkflowTrigger record (tenantId, decisionId, trigger, triggerEventId, context)
- **Emits:** `WORKFLOW_TRIGGER (CDC from WorkflowTrigger insert)`
- **Idempotent:** yes

### Step 4: advisory-ctrl

- **Receives:** `PORTFOLIO_DRIFT_DETECTED`
- **Via:** AdvisoryBus → SQS → advisory-ctrl-ingress
- **State change:** Runs inline LangGraph agent pipeline (4 agents), writes DecisionPacket + AgentInvocation records
- **Emits:** `DECISION_PACKET (CDC from DecisionPacket insert)`
- **Idempotent:** yes

### Step 5: investor-profile-ctrl

- **Receives:** `ANALYZE_INVESTOR_PROFILE`
- **Via:** AdvisoryBus → SQS → investor-profile-ctrl-ingress
- **State change:** Runs user-goals (Haiku) + risk-assessment (Opus) agents; writes AgentInvocation to DDB
- **Emits:** `GOAL_INTERPRETATION_PRODUCED (CDC from AgentInvocation insert)`
- **Idempotent:** no

### Step 6: market-intelligence-ctrl

- **Receives:** `ANALYZE_MARKET`
- **Via:** AdvisoryBus → SQS → market-intelligence-ctrl-ingress
- **State change:** Runs market-research (Sonnet) agent; writes AgentInvocation to DDB
- **Emits:** `MARKET_SIGNAL_DETECTED (CDC from AgentInvocation insert)`
- **Idempotent:** no

### Step 7: portfolio-engine-ctrl

- **Receives:** `CONSTRUCT_PORTFOLIO`
- **Via:** AdvisoryBus → SQS → portfolio-engine-ctrl-ingress
- **State change:** Runs portfolio-construction (Opus) + rebalance-planner (Sonnet) agents; writes AgentInvocation + ReasoningOutput
- **Emits:** `PORTFOLIO_CONSTRUCTION_PROPOSED (CDC from AgentInvocation insert), REBALANCE_PLAN_PRODUCED (CDC from ReasoningOutput insert)`
- **Idempotent:** no

### Step 8: advisory-narrative-ctrl

- **Receives:** `GENERATE_NARRATIVE`
- **Via:** AdvisoryBus → SQS → advisory-narrative-ctrl-ingress
- **State change:** Runs explainability (Sonnet) agent; writes ReasoningOutput to DDB
- **Emits:** `EXPLANATION_GENERATED (CDC from ReasoningOutput insert)`
- **Idempotent:** no

### Step 9: compliance-ctrl

- **Receives:** `DECISION_PACKET_CREATED`
- **Via:** AdvisoryBus → SQS → compliance-ctrl-ingress
- **State change:** Evaluates mandate, guardrails, suitability; writes ComplianceCheck + AuditArtifact to DDB
- **Emits:** `COMPLIANCE_CHECK (CDC from ComplianceCheck insert), AUDIT_ARTIFACT (CDC from AuditArtifact insert)`
- **Idempotent:** yes

### Step 10: Cross-domain hop

- **Event:** `DECISION_APPROVED`
- **From:** AdvisoryBus
- **To:** ExecutionBus
- **Via:** execution-adpt EB rule (ExecutionIngress-FromAdvisory, DLQ FromAdvisoryDLQ 14d)

### Step 11: execution-ctrl

- **Receives:** `DECISION_APPROVED`
- **Via:** ExecutionBus → SQS → execution-ctrl-ingress
- **State change:** Safety checks → writes Order (SUBMITTED|STAGED|REJECTED) + optional StagedOrder to DDB
- **Emits:** `ORDER_SUBMITTED or ORDER_STAGED or ORDER_REJECTED (CDC from Order insert, status-based mapping)`
- **Idempotent:** yes

## Success Criteria

- Drift quantified in DriftRecord by reconciliation-ctrl
- Advisory decision cycle (4 LangGraph agents) produces rebalance plan with proposed trades
- Compliance-ctrl evaluates and approves decision packet
- Rebalance orders created in execution-ctrl (SUBMITTED or STAGED)
- Staged orders processed at next market open

## Failure Modes

- **step 1 fails:** reconciliation-ctrl ingress DLQ; drift remains undetected
- **step 2 fails:** advisory-adpt FromLedgerDLQ (14d retention); advisory domain not notified
- **step 3 fails:** decision-workflow-ctrl TriggerIngress DLQ; decision cycle not started
- **step 4a fails:** agent invocation timeout (10 min); SF task token expires, workflow fails
- **step 4b fails:** portfolio-engine-ctrl agent failure; SF task token expires
- **step 4c fails:** advisory-narrative-ctrl agent failure; SF task token expires
- **step 7 fails:** compliance-ctrl ingress DLQ; compliance evaluation not performed
- **step 8 fails:** compliance callback fails; SF WaitForCompliance times out (24h)
- **step 9 fails:** execution-adpt FromAdvisoryDLQ (14d retention); execution not notified
- **step 10 fails:** execution-ctrl ingress DLQ; rebalance orders not created
- **safety checks fail:** Order written with status REJECTED; no broker submission
