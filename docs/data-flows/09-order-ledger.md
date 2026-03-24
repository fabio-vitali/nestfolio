# Feature #9 — Order Ledger / Event Sourcing (Happy Path)

**Trigger**: Execution domain events are forwarded to the ledger for append-only recording.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Event Sources"]
        S1["ORDER_FILLED"]
        S2["ORDER_PARTIALLY_FILLED"]
        S3["DEPOSIT_DETECTED"]
        S4["WITHDRAWAL_COMPLETED"]
        S5["CORPORATE_ACTION_PROCESSED"]
    end
    subgraph subGraph1["Ledger Domain"]
        LB{{"LedgerBus"}}
        A1["Append Ledger Entry"]
        A2["Reducer: Replay + Reduce"]
        A3["Update Account Snapshot"]
        A4["Store Daily Snapshot"]
    end
    subgraph subGraph2["Read Models"]
        B1["Update Dashboard"]
    end
    S1 & S2 & S3 & S4 & S5 --> LB
    LB --> A1
    A1 --> A2
    A2 --> A3
    A3 --> A4
    A4 --> B1

    S1:::execution
    S2:::execution
    S3:::execution
    S4:::execution
    S5:::execution
    LB:::bus
    A1:::ledger
    A2:::ledger
    A3:::ledger
    A4:::ledger
    B1:::read
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef read fill:#E6E6FF,stroke:#6A6AB0,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | execution-adpt | Execution | ORDER_FILLED, DEPOSIT_DETECTED, etc. | Cross-domain forward | Same events | LedgerBus |
| 2 | ledger-ctrl | Ledger | Any execution event | Append LedgerEntry (streamType: actual, dedup by eventId) | LEDGER_ENTRY_RECORDED | LedgerBus |
| 3 | ledger-ctrl | Ledger | DDB Stream (Reducer) | Replay all entries, apply accountReducer | _(snapshot update)_ | — |
| 4 | ledger-ctrl | Ledger | Reducer output | Store daily Account snapshot | BALANCE_UPDATED / PORTFOLIO_UPDATED (CDC via customEventTypeMap) | LedgerBus |
| 5 | dashboard-bff | Read Model | BALANCE_UPDATED, PORTFOLIO_UPDATED | Update materialized portfolio views | _(terminal)_ | — |

**Reducer operations by event type:**

| Event Type | Reducer Action |
|-----------|---------------|
| DEPOSIT_DETECTED | RecordDeposit — add to cashBalanceCents |
| WITHDRAWAL_COMPLETED | RecordWithdrawal — debit cashBalanceCents |
| ORDER_FILLED / ORDER_PARTIALLY_FILLED | RecordFill — update positions + cost basis |
| CORPORATE_ACTION_PROCESSED | RecordCorporateAction — stock split / dividend |
| ORDER_REJECTED / ORDER_CANCELLED | No-op (state unchanged) |
