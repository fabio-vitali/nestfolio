# Feature #13 — Portfolio Rebalancing (Happy Path)

Portfolio rebalancing is a composite flow that chains three existing features. It begins in the Ledger domain when reconciliation-ctrl detects drift between actual and target allocations. The drift event is forwarded to AdvisoryBus, triggering a full advisory decision cycle (Feature #6) with the rebalance planner agent. After compliance approval and optional user confirmation, the resulting trade orders flow through order execution (Feature #8) and back into the ledger (Feature #9) to rebuild the portfolio snapshot.

**Trigger**: Drift detected between actual and target portfolio allocations.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Ledger Domain"]
        LB{{"LedgerBus"}}
        A1["reconciliation-ctrl: Detect Drift"]
    end
    subgraph subGraph1["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        B1["Start Decision Cycle"]
        B2["Rebalance Planner Agent"]
        B3["Propose Rebalance Trades"]
        B4["Compliance Check"]
        B5["User Confirms"]
    end
    subgraph subGraph2["Execution Domain"]
        EB{{"ExecutionBus"}}
        C1["Execute Rebalance Orders"]
        C2["Broker Fills Trades"]
        C3["Forward Events"]
    end
    subgraph subGraph3["Ledger Domain (updated)"]
        LB2{{"LedgerBus"}}
        D1["Record Fill Entries"]
        D2["Reducer: New Snapshot"]
    end
    A1 --> LB
    LB --> AB
    AB --> B1
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B4 --> B5
    B5 --> EB
    EB --> C1
    C1 --> C2
    C2 --> C3
    C3 --> LB2
    LB2 --> D1
    D1 --> D2

    A1:::ledger
    LB:::bus
    AB:::bus
    B1:::advisory
    B2:::advisory
    B3:::advisory
    B4:::compliance
    B5:::user
    EB:::bus
    C1:::execution
    C2:::execution
    C3:::execution
    LB2:::bus
    D1:::ledger
    D2:::ledger
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef compliance fill:#FFD6E8,stroke:#B03A6F,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef user fill:#FFF,stroke:#333,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | reconciliation-ctrl | Ledger | Portfolio snapshot update | Compare intent vs settlement positions, detect drift | PORTFOLIO_DRIFT_DETECTED | LedgerBus |
| 2 | ledger-adpt | Ledger | PORTFOLIO_DRIFT_DETECTED | Cross-domain forward | PORTFOLIO_DRIFT_DETECTED | AdvisoryBus + ExecutionBus |
| 3 | advisory-ctrl | Advisory | PORTFOLIO_DRIFT_DETECTED | Trigger advisory decision cycle (1 of 9 triggers) | DECISION_PACKET_CREATED | AdvisoryBus |
| 4 | advisory-ctrl | Advisory | Decision packet | Invoke rebalance planner agent (Sonnet) | REBALANCE_PLAN_PRODUCED | AdvisoryBus |
| 5 | compliance-ctrl | Advisory | DECISION_PACKET_ENRICHED | Validate rebalance plan against guardrails | DECISION_APPROVED | AdvisoryBus |
| 6 | advisory-bff | Advisory | USER_CONFIRMATION_REQUESTED | User reviews and confirms rebalance trades | USER_CONFIRMED | AdvisoryBus |
| 7 | execution-ctrl | Execution | DECISION_APPROVED / USER_CONFIRMED | Create orders for each rebalance trade | ORDER_SUBMITTED | ExecutionBus |
| 8 | broker-adpt | Execution | ORDER_SUBMITTED | Simulation engine processes trades via CDC | ORDER_FILLED (per trade) | ExecutionBus |
| 9 | ledger-ctrl | Ledger | ORDER_FILLED (multiple) | Record each fill, rebuild portfolio snapshot | BALANCE_UPDATED, PORTFOLIO_UPDATED | LedgerBus |

**Note**: This flow composes Features #6 (advisory decision cycle), #8 (order execution), and #9 (order ledger). The drift detection is the unique entry point; the rest follows established patterns.
