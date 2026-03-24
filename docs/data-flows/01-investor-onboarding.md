# Feature #1 — Investor Onboarding (Happy Path)

**Trigger**: User completes the onboarding wizard in investor-mfe.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Investor Domain"]
        A1["Set Goal"]
        A2["Set Risk Profile"]
        A3["Grant Mandate"]
        A4["BFF: Validate + Persist"]
        IB{{"InvestorBus"}}
        A5["Notify User"]
        A6["Update Investor Snapshot"]
        A7["Forward to Advisory"]
    end
    subgraph subGraph1["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        B1["Start Decision Cycle"]
    end
    U(("User")) --> A1
    A1 --> A2
    A2 --> A3
    A3 --> A4
    A4 --> IB
    IB --> A5 & A6 & A7
    A7 --> AB
    AB --> B1

    A1:::investor
    A2:::investor
    A3:::investor
    A4:::investor
    IB:::bus
    A5:::investor
    A6:::read
    A7:::investor
    AB:::bus
    B1:::advisory
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef read fill:#E6E6FF,stroke:#6A6AB0,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | investor-bff | Investor | GraphQL mutations (updateGoal, updateMandate) | Zod validate + DDB insert per step | GOAL_SET, RISK_PROFILE_SET, MANDATE_GRANTED (CDC) | InvestorBus |
| 2 | investor-bff | Investor | Final wizard step | DDB insert InvestorProfile | ONBOARDING_COMPLETED (CDC) | InvestorBus |
| 3 | investor-ctrl | Investor | ONBOARDING_COMPLETED | Create notification "Welcome to Nestfolio" | NOTIFICATION_CREATED | InvestorBus |
| 4 | investor-ctrl | Investor | MANDATE_GRANTED | Create notification "Investment Mandate Activated" | NOTIFICATION_CREATED | InvestorBus |
| 5 | dashboard-bff | Investor | ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED | Materialize investor snapshot | _(terminal)_ | — |
| 6 | investor-adpt | Investor | MANDATE_GRANTED, GOAL_UPDATED, RISK_PROFILE_UPDATED | Cross-domain forward | Same events | AdvisoryBus |
| 7 | advisory-ctrl | Advisory | MANDATE_GRANTED | Start advisory decision cycle (see Feature #6) | DECISION_PACKET_CREATED | AdvisoryBus |
