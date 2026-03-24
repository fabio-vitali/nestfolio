# Feature #5 — Portfolio Dashboard (Happy Path)

**Trigger**: User opens the dashboard-mfe to view portfolio status.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Event Sources"]
        S1["Investor Events"]
        S2["Advisory Events"]
        S3["Ledger Events"]
    end
    subgraph subGraph1["Investor Domain"]
        IB{{"InvestorBus"}}
        A1["Materialize Investor Snapshot"]
        A2["Materialize Portfolio Summary"]
        A3["Materialize Recent Activity"]
        A4["Materialize Advisory Status"]
        A5["BFF: Serve Queries"]
    end
    subgraph subGraph2["User"]
        U1["View Dashboard"]
    end
    S1 --> IB
    S2 --> IB
    S3 --> IB
    A5b["Materialize Position Snapshot"]
    A6["Materialize Time-Travel Availability"]
    IB --> A1 & A2 & A3 & A4 & A5b & A6
    A1 & A2 & A3 & A4 & A5b & A6 --> A5
    A5 --> U1

    S1:::investor
    S2:::advisory
    S3:::ledger
    IB:::bus
    A1:::read
    A2:::read
    A3:::read
    A4:::read
    A5b:::read
    A6:::read
    A5:::investor
    U1:::user
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef read fill:#E6E6FF,stroke:#6A6AB0,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef user fill:#FFF,stroke:#333,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | dashboard-bff | Investor | ONBOARDING_COMPLETED, GOAL_SET, RISK_PROFILE_SET | Materialize investor snapshot | _(terminal)_ | — |
| 2 | dashboard-bff | Investor | BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED | Materialize portfolio summary | _(terminal)_ | — |
| 3 | dashboard-bff | Investor | BALANCE_UPDATED, PORTFOLIO_UPDATED, DECISION_APPROVED | Materialize recent activity | _(terminal)_ | — |
| 4 | dashboard-bff | Investor | DECISION_PACKET_CREATED, DECISION_APPROVED, DECISION_BLOCKED | Materialize advisory status | _(terminal)_ | — |
| 5 | dashboard-bff | Investor | PORTFOLIO_UPDATED | Materialize position snapshot | _(terminal)_ | — |
| 6 | dashboard-bff | Investor | LEDGER_ENTRY_RECORDED | Materialize time-travel availability | _(terminal)_ | — |
| 7 | dashboard-bff | Investor | GraphQL queries | Serve materialized views to dashboard-mfe | _(response)_ | — |

**Feed events cross-domain sources:**

| Materialized View | Source Events | Original Domain |
|-------------------|--------------|-----------------|
| investorSnapshot | ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED | Investor (local) |
| portfolioSummary | BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED | Ledger (via ledger-adpt) |
| recentActivity | BALANCE_UPDATED, PORTFOLIO_UPDATED, DECISION_APPROVED, DECISION_BLOCKED | Ledger + Advisory (via adapters) |
| advisoryStatus | DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED | Advisory (via advisory-adpt) |
| positionSnapshot | PORTFOLIO_UPDATED | Ledger (via ledger-adpt) |
| timeTravelAvailability | LEDGER_ENTRY_RECORDED | Ledger (via ledger-adpt) |
