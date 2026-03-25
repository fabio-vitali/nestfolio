# Feature #1 — Investor Onboarding (Happy Path)

The onboarding flow is a conversational AI-guided experience. The onboarding-mfe connects to onboarding-bff — a LangGraph state machine powered by Claude Sonnet via CopilotKit — that walks the user through 7 phases: goal, horizon, account mode, capital, risk profile, operating mode, and mandate. The agent renders rich UI components (sliders, option cards, amount pickers) via tool calls, persists each phase to DynamoDB (own table, CDC via DynamoDB Streams), and uses a Bedrock Knowledge Base for product questions (RAG). Once committed, CDC events on InvestorBus trigger downstream processing: investor-ctrl generates welcome notifications, dashboard-bff materializes the investor snapshot, and investor-adpt forwards the mandate to AdvisoryBus — kicking off the first advisory decision cycle. When investor-bff processes the ONBOARDING_COMPLETED event, it atomically creates 7 entities including an initial Deposit record (if capitalAmount > 0), which triggers the standard deposit flow (see Feature #2).

**Trigger**: User starts the onboarding wizard in onboarding-mfe (guarded by `onboardingPendingGuard` in shell).

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Investor Domain"]
        subgraph agent["onboarding-bff (LangGraph + CopilotKit)"]
            A0["Conversational Agent (Claude Sonnet)"]
            A1["Phase 1: Goal"]
            A1b["Phase 2: Horizon"]
            A1c["Phase 3: Account Mode"]
            A1d["Phase 4: Capital"]
            A2["Phase 5: Risk Profile"]
            A2b["Phase 6: Operating Mode"]
            A3["Phase 7: Mandate + Consent"]
            KB[("Bedrock Knowledge Base")]
        end
        A4["DDB Persist (own table)"]
        IB{{"InvestorBus"}}
        A5["Notify User"]
        A6["Update Investor Snapshot"]
        A7["Forward to Advisory"]
        A8["investor-bff: Create Profile + Initial Deposit"]
        A9["Deposit Flow (Feature #2)"]
    end
    subgraph subGraph1["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        B1["Start Decision Cycle"]
    end
    U(("User")) --> A0
    A0 --> A1
    A1 --> A1b
    A1b --> A1c
    A1c --> A1d
    A1d --> A2
    A2 --> A2b
    A2b --> A3
    A0 -.->|RAG| KB
    A1 & A1b & A1c & A1d & A2 & A2b & A3 -->|commit_phase| A4
    A4 --> IB
    IB --> A5 & A6 & A7 & A8
    A8 -->|DEPOSIT_INITIATED| A9
    A7 --> AB
    AB --> B1

    A0:::agent_style
    A1:::investor
    A1b:::investor
    A1c:::investor
    A1d:::investor
    A2:::investor
    A2b:::investor
    A3:::investor
    KB:::kb
    A4:::investor
    IB:::bus
    A5:::investor
    A6:::read
    A7:::investor
    A8:::investor
    A9:::execution
    AB:::bus
    B1:::advisory
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef read fill:#E6E6FF,stroke:#6A6AB0,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef agent_style fill:#E8D6FF,stroke:#6A3AB0,color:#000
    classDef kb fill:#F0E6FF,stroke:#8A6AB0,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | onboarding-bff | Investor | User conversation (CopilotKit) | LangGraph 7-phase state machine (Claude Sonnet), render UI tools, RAG via Bedrock KB | _(commit_phase per step)_ | — |
| 2 | onboarding-bff | Investor | commit_phase tool call | DDB persist per phase (own table) | GOAL_SET, RISK_PROFILE_SET, MANDATE_GRANTED (CDC) | InvestorBus |
| 3 | onboarding-bff | Investor | Final mandate consent | DDB insert OnboardingCompleted | ONBOARDING_COMPLETED (CDC) | InvestorBus |
| 3a | investor-bff | Investor | ONBOARDING_COMPLETED | transactWrite: InvestorProfile + Goal + RiskProfile + OperatingMode + AccountMode + Mandate + initial Deposit (if capitalAmount > 0) | DEPOSIT_INITIATED (CDC) | InvestorBus → deposit flow (Feature #2) |
| 4 | investor-ctrl | Investor | ONBOARDING_COMPLETED | Create notification "Welcome to Nestfolio" | NOTIFICATION_CREATED | InvestorBus |
| 5 | investor-ctrl | Investor | MANDATE_GRANTED | Create notification "Investment Mandate Activated" | NOTIFICATION_CREATED | InvestorBus |
| 6 | dashboard-bff | Investor | ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED | Materialize investor snapshot | _(terminal)_ | — |
| 7 | investor-adpt | Investor | MANDATE_GRANTED, GOAL_UPDATED, RISK_PROFILE_UPDATED | Cross-domain forward | Same events | AdvisoryBus |
| 8 | advisory-ctrl | Advisory | MANDATE_GRANTED | Start advisory decision cycle (see Feature #6) | DECISION_PACKET_CREATED | AdvisoryBus |
