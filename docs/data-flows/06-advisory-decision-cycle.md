> **Deprecated:** This document has been superseded by `flows/advisory-cycle.flow.yaml` and the agent documentation system. See `docs/agent-system.md` for details.

# Feature #6 — Advisory Decision Cycle (Happy Path)

The advisory decision cycle is the core AI-driven workflow, orchestrated by decision-workflow-ctrl via AWS Step Functions. Any of 9 trigger events writes a WorkflowTrigger record whose CDC starts a state machine execution. The state machine invokes 4 LangGraph agents — investor-profile-ctrl and market-intelligence-ctrl in parallel, then portfolio-engine-ctrl, then advisory-narrative-ctrl sequentially — using EventBridge `waitForTaskToken` callbacks. Each agent reads/writes to a shared AgentCore Memory session. After narrative generation, the assembled recommendation is published and compliance-ctrl validates it (mandate, guardrails, suitability), resolving authority level L1 (autonomous) or L2 (user confirmation). advisory-adpt forwards approved decisions to ExecutionBus.

**Trigger**: One of 9 domain events triggers the advisory decision lifecycle.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Trigger Events (9)"]
        T1["MANDATE_GRANTED"]
        T2["GOAL_UPDATED / RISK_PROFILE_UPDATED / OPERATING_MODE_CHANGED"]
        T3["DEPOSIT_DETECTED"]
        T4["PORTFOLIO_DRIFT_DETECTED"]
        T5["ORDER_FILLED / REJECTED / CANCELLED"]
    end
    subgraph subGraph1["Advisory Domain — Orchestration"]
        AB{{"AdvisoryBus"}}
        DW["decision-workflow-ctrl: Write WorkflowTrigger"]
        CDC1["CDC: WORKFLOW_TRIGGER_CREATED"]
        SF["Step Functions Execution"]
    end
    subgraph subGraph2["Parallel Agents (waitForTaskToken)"]
        A1["investor-profile-ctrl (LangGraph)"]
        A2["market-intelligence-ctrl (LangGraph)"]
    end
    subgraph subGraph3["Sequential Agents (waitForTaskToken)"]
        A3["portfolio-engine-ctrl (LangGraph)"]
        A4["advisory-narrative-ctrl (LangGraph)"]
    end
    subgraph subGraph4["Assembly + Compliance"]
        A5["Assemble Decision Packet"]
        A6["Publish RECOMMENDATION_PROPOSED"]
        C1["compliance-ctrl: Validate"]
        C2{"Approved?"}
        C3{"Authority Level?"}
    end
    subgraph subGraph5["User Confirmation"]
        U1["USER_CONFIRMATION_REQUESTED"]
        U2["advisory-bff: User Confirms"]
    end
    subgraph subGraph6["Execution Domain"]
        EB{{"ExecutionBus"}}
        E1["advisory-adpt: Forward"]
    end
    T1 & T2 & T3 & T4 & T5 --> AB
    AB --> DW
    DW --> CDC1
    CDC1 --> SF
    SF --> A1 & A2
    A1 -->|INVESTOR_PROFILE_COMPLETED| SF
    A2 -->|MARKET_ANALYSIS_COMPLETED| SF
    SF --> A3
    A3 -->|PORTFOLIO_COMPLETED| SF
    SF --> A4
    A4 -->|NARRATIVE_COMPLETED| SF
    SF --> A5
    A5 --> A6
    A6 --> C1
    C1 --> C2
    C2 -- Yes --> C3
    C2 -- No/BLOCKED --> END1["End"]
    C3 -- "L1: Autonomous" --> E1
    C3 -- "L2: Escalate" --> U1
    U1 --> U2
    U2 --> E1
    E1 --> EB

    T1:::investor
    T2:::investor
    T3:::execution
    T4:::ledger
    T5:::execution
    AB:::bus
    DW:::advisory
    CDC1:::advisory
    SF:::orchestrator
    A1:::agent
    A2:::agent
    A3:::agent
    A4:::agent
    A5:::advisory
    A6:::advisory
    C1:::compliance
    C2:::decision
    C3:::decision
    U1:::advisory
    U2:::user
    EB:::bus
    E1:::advisory
    END1:::decision
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef compliance fill:#FFD6E8,stroke:#B03A6F,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef decision fill:#FFF0AA,stroke:#C9A000,color:#000
    classDef user fill:#FFF,stroke:#333,color:#000
    classDef orchestrator fill:#E8D6FF,stroke:#6A3AB0,color:#000
    classDef agent fill:#C6F0C6,stroke:#2A8A2A,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | decision-workflow-ctrl | Advisory | Trigger event (1 of 9) | Write WorkflowTrigger record to DDB | WORKFLOW_TRIGGER_CREATED (CDC) | AdvisoryBus |
| 2 | Step Functions | Advisory | WORKFLOW_TRIGGER_CREATED | Start state machine execution | ANALYZE_INVESTOR_PROFILE + ANALYZE_MARKET (parallel, waitForTaskToken) | AdvisoryBus |
| 3a | investor-profile-ctrl | Advisory | ANALYZE_INVESTOR_PROFILE | LangGraph agent: analyze profile, read/write AgentCore Memory | INVESTOR_PROFILE_COMPLETED (SendTaskSuccess) | AdvisoryBus |
| 3b | market-intelligence-ctrl | Advisory | ANALYZE_MARKET | LangGraph agent: analyze market signals + data feeds, read/write Memory | MARKET_ANALYSIS_COMPLETED (SendTaskSuccess) | AdvisoryBus |
| 4 | portfolio-engine-ctrl | Advisory | CONSTRUCT_PORTFOLIO (after 3a+3b) | LangGraph agent: construct portfolio using upstream agent outputs from Memory | PORTFOLIO_COMPLETED (SendTaskSuccess) | AdvisoryBus |
| 5 | advisory-narrative-ctrl | Advisory | GENERATE_NARRATIVE (after 4) | LangGraph agent: generate investor narrative using all upstream outputs | NARRATIVE_COMPLETED (SendTaskSuccess) | AdvisoryBus |
| 6 | decision-workflow-ctrl | Advisory | All agents completed | Assemble decision packet from AgentCore Memory, publish recommendation | RECOMMENDATION_PROPOSED | AdvisoryBus |
| 7 | compliance-ctrl | Advisory | DECISION_PACKET_CREATED / DECISION_PACKET_ENRICHED | MandateValidator → GuardrailEvaluator → SuitabilityChecker → AuthorityResolver | DECISION_APPROVED or DECISION_BLOCKED | AdvisoryBus |
| 8a | decision-workflow-ctrl | Advisory | DECISION_APPROVED (L1) | State machine ends — autonomous execution | _(terminal)_ | — |
| 8b | decision-workflow-ctrl | Advisory | DECISION_APPROVED (L2) | Request user confirmation (72h timeout) | USER_CONFIRMATION_REQUESTED | AdvisoryBus |
| 9 | advisory-bff | Advisory | GraphQL `confirmDecision` | User confirms recommendation | USER_CONFIRMED (CDC) | AdvisoryBus |
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

**Agent invocation pattern**: Step Functions publishes event with embedded `$.Task.Token` → agent service processes → callback Lambda calls `SendTaskSuccess` to resume state machine.

**Memory sharing**: All 4 agents read/write to a shared AgentCore Memory session keyed by `tenantId + decisionId`. Sequential agents read upstream outputs from Memory.

**Agent tier escalation**: Haiku → Sonnet → Opus (on failure/insufficient quality).

**Compliance events**: compliance-ctrl also emits `GUARDRAIL_VIOLATION_DETECTED`, `ESCALATION_TRIGGERED`, `AUDIT_ARTIFACT_CREATED` for traceability.
