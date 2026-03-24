# Feature #6 — Advisory Decision Cycle (Happy Path)

**Trigger**: One of 9 domain events triggers the advisory decision lifecycle.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Trigger Events"]
        T1["MANDATE_GRANTED"]
        T2["GOAL_UPDATED"]
        T3["DEPOSIT_DETECTED"]
        T4["PORTFOLIO_DRIFT_DETECTED"]
        T5["ORDER_FILLED / REJECTED / CANCELLED"]
    end
    subgraph subGraph1["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        A1["Create Decision Packet"]
        A2["Analyze Investor Profile"]
        A3["Analyze Market"]
        A4["Construct Portfolio"]
        A5["Generate Narrative"]
    end
    subgraph subGraph2["Compliance"]
        C1["Validate Mandate + Guardrails"]
        C2{"Approved?"}
        C3["Set Authority Level"]
        C4{"Level?"}
    end
    subgraph subGraph3["User Confirmation"]
        U1["Request User Confirmation"]
        U2["User Confirms"]
    end
    subgraph subGraph4["Execution Domain"]
        EB{{"ExecutionBus"}}
        E1["Execute Order"]
    end
    T1 & T2 & T3 & T4 & T5 --> AB
    AB --> A1
    A1 --> A2
    A2 --> A3
    A3 --> A4
    A4 --> A5
    A5 --> A6["Propose Recommendation"]
    A6 --> C1
    C1 --> C2
    C2 -- Yes --> C3
    C3 --> C4
    C4 -- "L1: Autonomous" --> EB
    C4 -- "L2: Escalate" --> U1
    U1 --> U2
    U2 --> EB
    EB --> E1

    T1:::investor
    T2:::investor
    T3:::execution
    T4:::ledger
    T5:::execution
    AB:::bus
    A1:::advisory
    A2:::advisory
    A3:::advisory
    A4:::advisory
    A5:::advisory
    A6:::advisory
    C1:::compliance
    C2:::decision
    C3:::compliance
    C4:::decision
    U1:::advisory
    U2:::user
    EB:::bus
    E1:::execution
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef compliance fill:#FFD6E8,stroke:#B03A6F,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef decision fill:#FFF0AA,stroke:#C9A000,color:#000
    classDef user fill:#FFF,stroke:#333,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | advisory-ctrl | Advisory | Trigger event (1 of 9) | Create decision packet (idempotent) | DECISION_PACKET_CREATED | AdvisoryBus |
| 2 | advisory-ctrl | Advisory | DECISION_PACKET_CREATED | Analyze investor profile agent (Haiku) | INVESTOR_PROFILE_ANALYZED | AdvisoryBus |
| 3 | advisory-ctrl | Advisory | INVESTOR_PROFILE_ANALYZED | Analyze market agent (Haiku) | MARKET_ANALYZED | AdvisoryBus |
| 4 | advisory-ctrl | Advisory | MARKET_ANALYZED | Construct portfolio agent (Sonnet) | PORTFOLIO_CONSTRUCTED | AdvisoryBus |
| 5 | advisory-ctrl | Advisory | PORTFOLIO_CONSTRUCTED | Generate narrative agent (Haiku) | NARRATIVE_GENERATED | AdvisoryBus |
| 6 | advisory-ctrl | Advisory | NARRATIVE_GENERATED | Propose recommendation | RECOMMENDATION_PROPOSED | AdvisoryBus |
| 7 | compliance-ctrl | Advisory | DECISION_PACKET_CREATED / DECISION_PACKET_ENRICHED | Validate mandate, guardrails, suitability | DECISION_APPROVED or DECISION_BLOCKED | AdvisoryBus |
| 8a | advisory-ctrl | Advisory | DECISION_APPROVED (L1) | Auto-approve, forward to execution | DECISION_APPROVED | ExecutionBus |
| 8b | advisory-ctrl | Advisory | DECISION_APPROVED (L2) | Request user confirmation | USER_CONFIRMATION_REQUESTED | AdvisoryBus |
| 9 | advisory-bff | Advisory | GraphQL `confirmDecision` | User confirms recommendation | USER_CONFIRMED | AdvisoryBus |
| 10 | advisory-adpt | Advisory | DECISION_APPROVED / USER_CONFIRMED | Cross-domain forward | Same events | ExecutionBus |

**Trigger events (9 total):**

| Event | Source Domain |
|-------|-------------|
| MANDATE_GRANTED | Investor |
| GOAL_UPDATED | Investor |
| RISK_PROFILE_UPDATED | Investor |
| OPERATING_MODE_CHANGED | Investor |
| DEPOSIT_DETECTED | Execution |
| ORDER_FILLED | Execution |
| ORDER_REJECTED | Execution |
| ORDER_CANCELLED | Execution |
| PORTFOLIO_DRIFT_DETECTED | Ledger |

**Agent tier escalation**: Haiku → Sonnet → Opus (on failure/insufficient quality).
