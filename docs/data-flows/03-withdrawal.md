# Feature #3 — Withdrawal (Happy Path)

A withdrawal request flows from the Investor domain into Execution, where safety checks and market-hours logic determine whether the order is submitted immediately or staged for the next market open. Once filled, the event is forwarded to the Ledger domain for event-sourced recording and dashboard materialization.

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
    end
    subgraph subGraph1["Execution Domain"]
        EB{{"ExecutionBus"}}
        B1["Run Safety Checks"]
        B2{"Market Open?"}
        B3["Submit Order"]
        B4["Stage Order"]
        B5["Forward Event"]
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
    B2 -- Yes --> B3
    B2 -- No --> B4
    B3 --> B5
    B4 --> B5
    B5 --> LB
    LB --> C1
    C1 --> D1

    A1:::investor
    A2:::investor
    IB:::bus
    A3:::investor
    EB:::bus
    B1:::execution
    B2:::decision
    B3:::execution
    B4:::execution
    B5:::execution
    LB:::bus
    C1:::ledger
    D1:::read
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef read fill:#E6E6FF,stroke:#6A6AB0,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef decision fill:#FFF0AA,stroke:#C9A000,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | investor-bff | Investor | GraphQL `requestWithdrawal` | Zod validate + DDB insert | WITHDRAWAL_REQUESTED (CDC) | InvestorBus |
| 2 | investor-adpt | Investor | WITHDRAWAL_REQUESTED | Cross-domain forward | WITHDRAWAL_REQUESTED | ExecutionBus |
| 3 | execution-ctrl | Execution | WITHDRAWAL_REQUESTED | Safety checks + market hours check | ORDER_SUBMITTED or ORDER_STAGED | ExecutionBus |
| 4 | broker-adpt | Execution | ORDER_SUBMITTED | Execute withdrawal at broker | ORDER_FILLED | ExecutionBus |
| 5 | execution-adpt | Execution | ORDER_FILLED | Cross-domain forward | WITHDRAWAL_COMPLETED | LedgerBus |
| 6 | ledger-ctrl | Ledger | WITHDRAWAL_COMPLETED | Append event-sourced entry, debit cash | LEDGER_ENTRY_RECORDED | LedgerBus |
| 7 | dashboard-bff | Read Model | BALANCE_UPDATED | Update materialized view (cash, activity) | _(terminal)_ | — |
