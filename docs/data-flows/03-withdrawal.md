# Feature #3 — Withdrawal (Happy Path)

A withdrawal request flows from the Investor domain into Execution, where broker-adpt debits the virtual cash balance and emits WITHDRAWAL_COMPLETED via CDC. execution-adpt then fans the event to InvestorBus (notification) and LedgerBus (event-sourced recording and dashboard materialization).

**Trigger**: User requests a withdrawal via the investor-mfe.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Investor Domain"]
        A1["Request Withdrawal"]
        A2["BFF: Validate + Persist"]
        IB{{"InvestorBus"}}
        A3["Forward to Execution"]
        A4["Notify User"]
    end
    subgraph subGraph1["Execution Domain"]
        EB{{"ExecutionBus"}}
        B1["Debit Virtual Cash Balance"]
        B2["Forward Event"]
    end
    subgraph subGraph2["Ledger Domain"]
        LB{{"LedgerBus"}}
        C1["Record Ledger Entry"]
    end
    subgraph subGraph3["Read Models"]
        D1["Update Dashboard"]
    end
    U(("User")) --> A1
    A1 --> A2
    A2 --> IB
    IB --> A3
    A3 --> EB
    EB --> B1
    B1 --> B2
    B2 --> IB & LB
    IB --> A4
    LB --> C1
    C1 --> D1

    A1:::investor
    A2:::investor
    IB:::bus
    A3:::investor
    A4:::investor
    EB:::bus
    B1:::execution
    B2:::execution
    LB:::bus
    C1:::ledger
    D1:::read
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef read fill:#E6E6FF,stroke:#6A6AB0,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | investor-bff | Investor | GraphQL `requestWithdrawal` | JS resolver validate + atomic DDB TransactWriteItems (debit CashBalance + insert Withdrawal) | WITHDRAWAL_REQUESTED (CDC) | InvestorBus |
| 2 | investor-adpt | Investor | WITHDRAWAL_REQUESTED | Cross-domain forward | WITHDRAWAL_REQUESTED | ExecutionBus |
| 3 | broker-adpt | Execution | WITHDRAWAL_REQUESTED | Idempotent virtual cash balance debit + write WithdrawalCompleted record | WITHDRAWAL_COMPLETED (CDC) | ExecutionBus |
| 4 | execution-adpt | Execution | WITHDRAWAL_COMPLETED | Cross-domain forward | WITHDRAWAL_COMPLETED | InvestorBus + LedgerBus |
| 5 | investor-ctrl | Investor | WITHDRAWAL_COMPLETED | Create email notification "Withdrawal Completed" | NOTIFICATION_CREATED | InvestorBus |
| 6 | ledger-ctrl | Ledger | WITHDRAWAL_COMPLETED | Append event-sourced entry, debit cash | LEDGER_ENTRY_RECORDED | LedgerBus |
| 7 | dashboard-bff | Read Model | BALANCE_UPDATED | Update materialized view (cash, activity) | _(terminal)_ | — |
