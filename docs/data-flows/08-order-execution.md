# Feature #8 — Order Execution (Happy Path)

**Trigger**: Advisory decision approved (L1 autonomous or L2 user-confirmed).

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        A1["Decision Approved"]
    end
    subgraph subGraph1["Execution Domain"]
        EB{{"ExecutionBus"}}
        B1["Run Safety Checks"]
        B2{"Market Open?"}
        B3["Submit Order"]
        B4["Stage Order"]
        B5["Broker Feed: Fill Recorded"]
        B6["Forward Events"]
    end
    subgraph subGraph2["Ledger Domain"]
        LB{{"LedgerBus"}}
        C1["Record Ledger Entry"]
    end
    subgraph subGraph3["Investor Domain"]
        IB{{"InvestorBus"}}
        D1["Notify User"]
    end
    A1 --> AB
    AB --> EB
    EB --> B1
    B1 --> B2
    B2 -- Yes --> B3
    B2 -- No --> B4
    B3 --> B5
    B5 --> B6
    B6 --> LB & IB
    LB --> C1
    IB --> D1

    A1:::advisory
    AB:::bus
    EB:::bus
    B1:::execution
    B2:::decision
    B3:::execution
    B4:::execution
    B5:::execution
    B6:::execution
    LB:::bus
    C1:::ledger
    IB:::bus
    D1:::investor
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef decision fill:#FFF0AA,stroke:#C9A000,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | advisory-adpt | Advisory | DECISION_APPROVED / USER_CONFIRMED | Cross-domain forward | Same events | ExecutionBus |
| 2 | execution-ctrl | Execution | DECISION_APPROVED | Run SafetyChecksService.runAllChecks() | _(internal)_ | — |
| 3a | execution-ctrl | Execution | Safety passed + market open | Create Order, submit immediately; function-based CDC mapping: INSERT status=SUBMITTED → ORDER_SUBMITTED | ORDER_SUBMITTED (CDC via customEventTypeMap) | ExecutionBus |
| 3b | execution-ctrl | Execution | Safety passed + market closed | Create Order + StagedOrder; function-based CDC mapping: INSERT status=STAGED → ORDER_STAGED | ORDER_STAGED (CDC via customEventTypeMap) | ExecutionBus |
| 4 | broker-adpt | Execution | ORDER_SUBMITTED | Simulation engine processes trades; emits DEPOSIT_DETECTED / WITHDRAWAL_COMPLETED via CDC (customEventTypeMap); broker feed records fill via CDC | ORDER_FILLED (CDC), DEPOSIT_DETECTED (CDC), WITHDRAWAL_COMPLETED (CDC) | ExecutionBus |
| 5 | execution-adpt | Execution | ORDER_FILLED | Cross-domain forward | ORDER_FILLED | LedgerBus + InvestorBus |
| 6 | ledger-ctrl | Ledger | ORDER_FILLED | Append event-sourced entry, update positions | LEDGER_ENTRY_RECORDED | LedgerBus |
| 7 | investor-ctrl | Investor | ORDER_FILLED | Create notification "Order Executed" (email) | NOTIFICATION_CREATED | InvestorBus |
