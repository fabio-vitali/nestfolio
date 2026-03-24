# Feature #2 — Deposit (Happy Path)

**Trigger**: User initiates a deposit via the Investor MFE onboarding wizard.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Investor Domain"]
        A1["Initiate Deposit"]
        A2["BFF: Validate + Persist"]
        IB{{"InvestorBus"}}
        A3["Notify User"]
        A4["Forward to Execution"]
    end
    subgraph subGraph1["Execution Domain"]
        EB{{"ExecutionBus"}}
        B1["Update Balance"]
        B2["Forward Event"]
    end
    subgraph subGraph2["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        C1["Evaluate Deposit"]
        C2{"Rebalance?"}
        C3["Create Decision Packet"]
    end
    subgraph subGraph3["Ledger Domain"]
        LB{{"LedgerBus"}}
        D1["Record Ledger Entry"]
    end
    subgraph subGraph4["Read Models"]
        E1["Update Dashboard"]
    end
    U(("User")) --> A1
    A1 --> A2
    A2 --> IB
    IB --> A3 & A4
    A4 --> EB
    EB --> B1 & B2
    B2 --> AB & LB
    AB --> C1
    C1 --> C2
    C2 -- Yes --> C3
    LB --> D1
    D1 --> E1

    A1:::investor
    A2:::investor
    IB:::bus
    A3:::investor
    A4:::investor
    EB:::bus
    B1:::execution
    B2:::execution
    AB:::bus
    C1:::advisory
    C2:::decision
    C3:::advisory
    LB:::bus
    D1:::ledger
    E1:::read
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef read fill:#E6E6FF,stroke:#6A6AB0,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef decision fill:#FFF0AA,stroke:#C9A000,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | investor-bff | Investor | GraphQL mutation | Zod validate + DDB insert | DEPOSIT_INITIATED (CDC) | InvestorBus |
| 2 | investor-ctrl | Investor | DEPOSIT_INITIATED | Create push notification | NOTIFICATION_CREATED | InvestorBus |
| 3 | investor-adpt | Investor | DEPOSIT_INITIATED | Cross-domain forward | DEPOSIT_INITIATED | ExecutionBus |
| 4 | broker-adpt | Execution | DEPOSIT_INITIATED | Idempotent cash balance update | _(terminal)_ | — |
| 5 | execution-adpt | Execution | DEPOSIT_INITIATED | Cross-domain forward | DEPOSIT_DETECTED | AdvisoryBus + LedgerBus |
| 6 | advisory-ctrl | Advisory | DEPOSIT_DETECTED | Evaluate rebalance trigger | DECISION_PACKET_CREATED _(conditional)_ | AdvisoryBus |
| 7 | ledger-ctrl | Ledger | DEPOSIT_DETECTED | Append event-sourced entry | LEDGER_ENTRY_RECORDED | LedgerBus |
| 8 | dashboard-bff | Read Model | BALANCE_UPDATED | Update materialized view | _(terminal)_ | — |
