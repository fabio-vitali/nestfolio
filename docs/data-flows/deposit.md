# Deposit

> Investor initiates a deposit, routed through broker-ctrl to sim or Alpaca adapter, normalized back to canonical events

**Domains:** investor, execution, ledger

**Trigger:** investor-bff emits DEPOSIT_INITIATED (CDC from Deposit:INSERT)

## Flowchart

```mermaid
flowchart TD
    subgraph investor["Investor Domain"]
        investor_bff["investor-bff"]
        investor_adpt["investor-adpt"]
        investor_ctrl["investor-ctrl"]
    end
    subgraph execution["Execution Domain"]
        broker_ctrl["broker-ctrl"]
        broker_sim_adpt["broker-sim-adpt"]
        broker_alpaca_adpt["broker-alpaca-adpt"]
        execution_adpt["execution-adpt"]
    end
    subgraph ledger["Ledger Domain"]
        ledger_ctrl["ledger-ctrl"]
        ledger_adpt["ledger-adpt"]
    end
    investor_bff -->|"DEPOSIT_INITIATED"| investor_adpt
    investor_adpt -.->|"DEPOSIT_INITIATED"| broker_ctrl
    broker_ctrl -->|"SIM_DEPOSIT_INITIATED"| broker_sim_adpt
    broker_ctrl -->|"ALPACA_TRANSFER_REQUESTED"| broker_alpaca_adpt
    broker_sim_adpt -->|"SIM_DEPOSIT_COMPLETED"| broker_ctrl
    broker_alpaca_adpt -->|"ALPACA_TRANSFER_COMPLETED"| broker_ctrl
    broker_ctrl -->|"DEPOSIT_DETECTED"| execution_adpt
    execution_adpt -.->|"DEPOSIT_DETECTED"| ledger_ctrl
    ledger_ctrl -->|"BALANCE_UPDATED"| ledger_adpt
    ledger_adpt -.->|"BALANCE_UPDATED"| investor_ctrl
```

## Sequence Diagram

```mermaid
sequenceDiagram
    box investor domain
        participant investor_bff as investor-bff
        participant investor_adpt as investor-adpt
        participant investor_ctrl as investor-ctrl
    end
    box execution domain
        participant broker_ctrl as broker-ctrl
        participant broker_sim_adpt as broker-sim-adpt
        participant broker_alpaca_adpt as broker-alpaca-adpt
        participant execution_adpt as execution-adpt
    end
    box ledger domain
        participant ledger_ctrl as ledger-ctrl
        participant ledger_adpt as ledger-adpt
    end
    Note over investor_bff: User initiates deposit via GraphQL mutation
    investor_bff->>+investor_adpt: DEPOSIT_INITIATED
    investor_adpt-)broker_ctrl: DEPOSIT_INITIATED
    broker_ctrl->>+broker_sim_adpt: SIM_DEPOSIT_INITIATED
    broker_ctrl->>+broker_alpaca_adpt: ALPACA_TRANSFER_REQUESTED
    broker_alpaca_adpt->>+broker_ctrl: SIM_DEPOSIT_COMPLETED | ALPACA_TRANSFER_COMPLETED
    broker_ctrl->>+execution_adpt: DEPOSIT_DETECTED
    execution_adpt-)ledger_ctrl: DEPOSIT_DETECTED
    ledger_ctrl->>+ledger_adpt: BALANCE_UPDATED
    ledger_adpt-)investor_ctrl: BALANCE_UPDATED
```

## Steps

### Step 1: investor-bff

- **Action:** User initiates deposit via GraphQL mutation
- **State change:** Writes Deposit record to DDB
- **Emits:** `DEPOSIT_INITIATED (CDC)`
- **Idempotent:** yes

### Step 2: investor-adpt

- **Receives:** `DEPOSIT_INITIATED`
- **Via:** InvestorBus -> investor-adpt ToExecution rule
- **Forwards to:** ExecutionBus
- **Emits:** `DEPOSIT_INITIATED`

### Step 3: broker-ctrl

- **Receives:** `DEPOSIT_INITIATED`
- **Via:** ExecutionBus -> SQS -> broker-ctrl-DepositWithdrawalIngress
- **State change:** deposit-withdrawal-router reads ExecutionMode and routes to SIM_DEPOSIT_INITIATED or ALPACA_TRANSFER_REQUESTED
- **Emits:** `SIM_DEPOSIT_INITIATED or ALPACA_TRANSFER_REQUESTED (explicit publish)`
- **Idempotent:** yes

### Step 4: broker-sim-adpt

- **Receives:** `SIM_DEPOSIT_INITIATED`
- **Via:** ExecutionBus -> SQS -> broker-sim-adpt-ingress
- **State change:** Simulates deposit, writes DepositDetected record
- **Emits:** `SIM_DEPOSIT_COMPLETED (CDC)`
- **Idempotent:** yes

### Step 5: broker-alpaca-adpt

- **Receives:** `ALPACA_TRANSFER_REQUESTED`
- **Via:** ExecutionBus -> SQS -> broker-alpaca-adpt-ingress
- **State change:** Submits ACH transfer to Alpaca API, writes AlpacaTransferResult
- **Emits:** `ALPACA_TRANSFER_COMPLETED or ALPACA_TRANSFER_FAILED (CDC)`
- **Idempotent:** yes

### Step 6: broker-ctrl

- **Receives:** `SIM_DEPOSIT_COMPLETED | ALPACA_TRANSFER_COMPLETED`
- **Via:** ExecutionBus -> SQS -> broker-ctrl-DepositWithdrawalNormalizerIngress
- **State change:** Writes NormalizedEvent record (sk = DEPOSIT_DETECTED)
- **Emits:** `DEPOSIT_DETECTED (CDC from NormalizedEvent:INSERT, sk is event type)`
- **Idempotent:** yes

### Step 7: execution-adpt

- **Receives:** `DEPOSIT_DETECTED`
- **Via:** ExecutionBus -> execution-adpt ToLedger rule
- **Forwards to:** LedgerBus
- **Emits:** `DEPOSIT_DETECTED`

### Step 8: ledger-ctrl

- **Receives:** `DEPOSIT_DETECTED`
- **Via:** LedgerBus -> SQS -> ledger-ctrl-ingress
- **State change:** Records BalanceEvent (credit) and LedgerEntryEvent in DDB; reducer materializes account snapshot
- **Emits:** `BALANCE_UPDATED, LEDGER_ENTRY_RECORDED (CDC)`
- **Idempotent:** yes

### Step 9: ledger-adpt

- **Receives:** `BALANCE_UPDATED`
- **Via:** LedgerBus -> ledger-adpt ToInvestor rule
- **Forwards to:** InvestorBus
- **Emits:** `BALANCE_UPDATED`

### Step 10: investor-ctrl

- **Receives:** `BALANCE_UPDATED`
- **Via:** InvestorBus -> SQS -> investor-ctrl-ingress
- **State change:** Updates investor balance view, may trigger notification
- **Emits:** `NOTIFICATION_CREATED (CDC)`
- **Idempotent:** yes

## Success Criteria

- Deposit amount credited in ledger-ctrl balance
- BALANCE_UPDATED event reaches investor domain
- LEDGER_ENTRY_RECORDED event persists audit trail

## Failure Modes

- **step 2 fails:** investor-adpt ToExecutionDLQ; deposit not routed to execution domain
- **step 3 fails:** broker-ctrl DepositWithdrawalIngress DLQ; deposit not routed to adapter
- **step 4 fails:** broker-sim-adpt ingress DLQ; simulated deposit not completed
- **step 5 fails:** broker-alpaca-adpt ingress DLQ; Alpaca transfer not submitted
- **step 6 fails:** broker-ctrl DepositWithdrawalNormalizerIngress DLQ; normalized event not created
- **step 8 fails:** ledger-ctrl ingress DLQ; balance not updated
