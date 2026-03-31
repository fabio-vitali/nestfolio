# Order Ledger

> Order fill events from execution domain are recorded as ledger entries, balance and portfolio snapshots are materialized and forwarded cross-domain

**Domains:** execution, ledger, investor, advisory

**Trigger:** broker-ctrl emits ORDER_FILLED (CDC from NormalizedEvent:INSERT)

## Flowchart

```mermaid
flowchart TD
    subgraph ledger["Ledger Domain"]
        ledger_ctrl["ledger-ctrl"]
        reconciliation_ctrl["reconciliation-ctrl"]
    end
    subgraph investor["Investor Domain"]
        investor_ctrl["investor-ctrl"]
        dashboard_bff["dashboard-bff"]
    end
    ledger_ctrl -->|"BALANCE_UPDATED, BALANCE_UPDATED"| investor_ctrl
    ledger_ctrl -->|"PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED ..."| dashboard_bff
```

## Sequence Diagram

```mermaid
sequenceDiagram
    box ledger domain
        participant ledger_ctrl as ledger-ctrl
        participant reconciliation_ctrl as reconciliation-ctrl
    end
    box investor domain
        participant investor_ctrl as investor-ctrl
        participant dashboard_bff as dashboard-bff
    end
    ledger_ctrl-)investor_ctrl: BALANCE_UPDATED (LedgerBus → InvestorBus)
    ledger_ctrl-)investor_ctrl: PORTFOLIO_UPDATED (LedgerBus → AdvisoryBus)
    ledger_ctrl-)investor_ctrl: LEDGER_ENTRY_RECORDED (LedgerBus → InvestorBus)
    ledger_ctrl->>+dashboard_bff: BALANCE_UPDATED | PORTFOLIO_UPDATED ...
    ledger_ctrl->>+reconciliation_ctrl: PORTFOLIO_UPDATED
```

## Steps

### Step 1: Cross-domain hop

- **Event:** `ORDER_FILLED`
- **From:** ExecutionBus
- **To:** LedgerBus
- **Via:** ledger-adpt EB rule

### Step 2: ledger-ctrl

- **Receives:** `ORDER_FILLED`
- **Via:** LedgerBus -> SQS -> ledger-ctrl-ingress
- **State change:** Records LedgerEntryEvent (trade journal entry), BalanceEvent (cash debit/credit), PortfolioEvent (position update); reducer materializes account snapshots
- **Emits:** `BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED (CDC)`
- **Idempotent:** yes

### Step 3: ledger-ctrl

- **Receives:** `ORDER_PARTIALLY_FILLED`
- **Via:** LedgerBus -> SQS -> ledger-ctrl-ingress
- **State change:** Records partial fill as LedgerEntryEvent and PortfolioEvent (partial position update)
- **Emits:** `PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED (CDC)`
- **Idempotent:** yes

### Step 4: Cross-domain hop

- **Event:** `BALANCE_UPDATED`
- **From:** LedgerBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule

### Step 5: Cross-domain hop

- **Event:** `PORTFOLIO_UPDATED`
- **From:** LedgerBus
- **To:** AdvisoryBus
- **Via:** advisory-adpt EB rule

### Step 6: Cross-domain hop

- **Event:** `LEDGER_ENTRY_RECORDED`
- **From:** LedgerBus
- **To:** InvestorBus
- **Via:** investor-adpt EB rule

### Step 7: investor-ctrl

- **Receives:** `BALANCE_UPDATED`
- **Via:** InvestorBus -> SQS -> investor-ctrl-ingress
- **State change:** Updates investor balance view
- **Emits:** `NOTIFICATION_CREATED (CDC)`
- **Idempotent:** yes

### Step 8: dashboard-bff

- **Receives:** `BALANCE_UPDATED | PORTFOLIO_UPDATED | LEDGER_ENTRY_RECORDED`
- **Via:** InvestorBus -> SQS -> dashboard-bff-ingress
- **State change:** Updates portfolio dashboard read model
- **Idempotent:** yes

### Step 9: reconciliation-ctrl

- **Receives:** `PORTFOLIO_UPDATED`
- **Via:** LedgerBus -> SQS -> reconciliation-ctrl-ingress
- **State change:** Triggers reconciliation check comparing intent vs settlement positions
- **Emits:** `RECONCILIATION_COMPLETED or PORTFOLIO_DRIFT_DETECTED (CDC)`
- **Idempotent:** yes

## Success Criteria

- Trade recorded as LedgerEntryEvent with correct debit/credit
- Balance and portfolio snapshots materialized by reducer
- BALANCE_UPDATED reaches investor domain for dashboard update
- PORTFOLIO_UPDATED reaches advisory domain for drift monitoring

## Failure Modes

- **step 1 fails:** execution-adpt ToLedgerDLQ; ledger not notified of fill
- **step 2 fails:** ledger-ctrl ingress DLQ; trade not recorded
- **step 4-6 fails:** ledger-adpt forwarding DLQs; downstream domains not notified
- **step 10 fails:** reconciliation-ctrl ingress DLQ; drift not detected
