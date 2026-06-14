# Reconciliation

> reconciliation-ctrl compares intent positions against settlement positions per instrument, producing DriftRecord items for mismatches and a ReconciliationResult summary. CDC emits RECONCILIATION_COMPLETED and PORTFOLIO_DRIFT_DETECTED, which cross domains to update the investor dashboard and trigger the advisory rebalance cycle.

**Domains:** ledger, investor, advisory, execution

**Trigger:** Any of four events arriving on LedgerBus: PORTFOLIO_UPDATED (CDC from ledger-ctrl PortfolioEvent:INSERT), PORTFOLIO_SNAPSHOT_IMPORTED (execution cross-domain, pulled by ledger-adpt from ExecutionBus), CORPORATE_ACTION_APPLIED (execution cross-domain, pulled by ledger-adpt from ExecutionBus), ALPACA_ACCOUNT_SNAPSHOT (CDC from broker-alpaca-adpt AlpacaAccountSnapshot:INSERT, pulled by ledger-adpt from ExecutionBus). Each event only CACHES its side (Intent for the first three, Settlement for ALPACA_ACCOUNT_SNAPSHOT); reconciliation actually fires only when both the Intent and Settlement caches are present and fresh (<24h) — not on any single event in isolation.

## Flowchart

```mermaid
flowchart TD
    subgraph ledger["Ledger Domain"]
        reconciliation_ctrl["reconciliation-ctrl"]
    end
    subgraph investor["Investor Domain"]
        dashboard_bff["dashboard-bff"]
    end
    subgraph advisory["Advisory Domain"]
        decision_workflow_ctrl["decision-workflow-ctrl"]
    end
    reconciliation_ctrl -.->|"RECONCILIATION_COMPLETED"| dashboard_bff
    dashboard_bff -.->|"PORTFOLIO_DRIFT_DETECTED"| decision_workflow_ctrl
```

## Sequence Diagram

```mermaid
sequenceDiagram
    box ledger domain
        participant reconciliation_ctrl as reconciliation-ctrl
    end
    box investor domain
        participant dashboard_bff as dashboard-bff
    end
    box advisory domain
        participant decision_workflow_ctrl as decision-workflow-ctrl
    end
    Note over reconciliation_ctrl: CDC (Egress) processes DynamoDB Stream changes
    reconciliation_ctrl-)dashboard_bff: RECONCILIATION_COMPLETED (LedgerBus → InvestorBus)
    dashboard_bff-)decision_workflow_ctrl: PORTFOLIO_DRIFT_DETECTED (LedgerBus → AdvisoryBus)
```

## Steps

### Step 1: Cross-domain hop

- **Event:** `PORTFOLIO_SNAPSHOT_IMPORTED`
- **From:** ExecutionBus
- **To:** LedgerBus
- **Via:** ledger-adpt EB rule (LedgerIngress-FromExecution)

### Step 2: Cross-domain hop

- **Event:** `CORPORATE_ACTION_APPLIED`
- **From:** ExecutionBus
- **To:** LedgerBus
- **Via:** ledger-adpt EB rule (LedgerIngress-FromExecution)

### Step 3: Cross-domain hop

- **Event:** `ALPACA_ACCOUNT_SNAPSHOT`
- **From:** ExecutionBus
- **To:** LedgerBus
- **Via:** ledger-adpt EB rule (LedgerIngress-FromExecution)

### Step 4: reconciliation-ctrl

- **Receives:** `PORTFOLIO_UPDATED | PORTFOLIO_SNAPSHOT_IMPORTED | CORPORATE_ACTION_APPLIED`
- **Action:** Caches the event's positions as the INTENT side into a PositionCache#tenantId row (sk=Intent), then reads the SETTLEMENT side from DDB. If the other side is absent or stale (>24h), returns skip() — no reconciliation. Only when BOTH sides are fresh does it call ReconciliationService.reconcile(), computing drift (intentQty - settlementQty) per instrument; abs(drift) > 0.001 produces a DriftEntry. Status DRIFT_DETECTED if any drift, else COMPLETED. reconciliationId is content-derived (sha256 of canonicalized positions).
- **Via:** LedgerBus -> SQS -> reconciliation-ctrl-ingress
- **State change:** On reconcile only: writes ReconciliationResult (pk=Reconciliation#tenantId#<contentHash>, sk=Reconciliation) with status and driftCount, plus one DriftRecord per mismatched instrument (sk=DriftRecord#instrument) with intentQty, settlementQty, and drift.
- **Idempotent:** yes

### Step 5: reconciliation-ctrl

- **Receives:** `ALPACA_ACCOUNT_SNAPSHOT`
- **Action:** Reads positions from Alpaca-format payload (qty field) and caches them as the SETTLEMENT side (sk=Settlement) — unlike the other three events, which cache the INTENT side. Then cache-and-compare: reconciles only if a fresh Intent side exists, else skip().
- **Via:** LedgerBus -> SQS -> reconciliation-ctrl-ingress
- **State change:** On reconcile only: same ReconciliationResult + DriftRecord schema as the Intent-side path.
- **Idempotent:** yes

### Step 6: reconciliation-ctrl

- **Action:** CDC (Egress) processes DynamoDB Stream changes

### Step 7: Cross-domain hop

- **Event:** `RECONCILIATION_COMPLETED`
- **From:** LedgerBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule (InvestorIngress-FromLedger)

### Step 8: dashboard-bff

- **Receives:** `RECONCILIATION_COMPLETED`
- **Via:** InvestorBus -> SQS -> dashboard-bff-ingress
- **State change:** No-op. RECONCILIATION_COMPLETED is subscribed but the portfolioSummary transform explicitly skips it (only BALANCE_UPDATED / PORTFOLIO_UPDATED carry a ledger snapshot); guarded out before parseSubject so it does not poison-pill to the DLQ. No row written.
- **Idempotent:** yes

### Step 9: Cross-domain hop

- **Event:** `PORTFOLIO_DRIFT_DETECTED`
- **From:** LedgerBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule (AdvisoryIngress-FromLedger)

### Step 10: decision-workflow-ctrl

- **Receives:** `PORTFOLIO_DRIFT_DETECTED`
- **Action:** PORTFOLIO_DRIFT_DETECTED is one of the 7 TRIGGER_EVENT_TYPES that start the decision Step Functions workflow directly from EventBridge. The SF runs the 4-agent pipeline + compliance check (see advisory-cycle.flow.yaml).
- **Via:** AdvisoryBus -> EventBridge target -> Step Functions (direct EB -> SF)
- **State change:** SF execution starts; decisionId minted in UnpackTriggerEnvelope
- **Idempotent:** yes

## Success Criteria

- Intent and settlement positions compared for all instruments in the event payload
- DriftRecord created per instrument where abs(drift) > 0.001
- ReconciliationResult written with status COMPLETED or DRIFT_DETECTED and accurate driftCount
- RECONCILIATION_COMPLETED reaches dashboard-bff (currently a no-op — subscribed but not projected)
- PORTFOLIO_DRIFT_DETECTED reaches decision-workflow-ctrl and triggers a Step Functions execution (rebalance)

## Failure Modes

- **step 4-5 fails:** reconciliation-ctrl ingress DLQ; reconciliation not executed
- **step 6 fails:** CDC not emitted; downstream domains not notified
- **step 7 fails:** investor-adpt FromLedgerDLQ; dashboard not updated with reconciliation status
- **step 8 fails:** dashboard-bff ingress DLQ; portfolio summary stale
- **step 9 fails:** advisory-adpt FromLedgerDLQ; rebalance not triggered
- **step 10 fails:** EventBridge → SF native target invocation fails or is throttled; decision cycle not started
