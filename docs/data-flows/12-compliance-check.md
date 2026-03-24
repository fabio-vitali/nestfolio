# Feature #12 — Compliance Check (Happy Path)

**Trigger**: Advisory decision packet is created or enriched, triggering compliance validation.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Advisory Domain"]
        AB{{"AdvisoryBus"}}
        A1["Decision Packet Created / Enriched"]
    end
    subgraph subGraph1["Compliance"]
        B1["Validate Mandate"]
        B2["Evaluate Guardrails"]
        B3["Check Suitability"]
        B4["Resolve Authority Level"]
        B5{"All Checks Pass?"}
        B6{"Authority Level?"}
        B7["Emit DECISION_APPROVED"]
        B8["Emit USER_CONFIRMATION_REQUESTED"]
    end
    subgraph subGraph2["Advisory Domain (continued)"]
        C1["Auto-Approve (L1)"]
        C2["Await User Confirmation (L2)"]
    end
    A1 --> AB
    AB --> B1
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B4 --> B5
    B5 -- Yes --> B6
    B6 -- "L1: Autonomous" --> B7
    B6 -- "L2: Escalate" --> B8
    B7 --> C1
    B8 --> C2

    A1:::advisory
    AB:::bus
    B1:::compliance
    B2:::compliance
    B3:::compliance
    B4:::compliance
    B5:::decision
    B6:::decision
    B7:::compliance
    B8:::compliance
    C1:::advisory
    C2:::advisory
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef compliance fill:#FFD6E8,stroke:#B03A6F,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef decision fill:#FFF0AA,stroke:#C9A000,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | compliance-ctrl | Advisory | DECISION_PACKET_CREATED / DECISION_PACKET_ENRICHED | Validate mandate (effective dates, type, revocation) | _(internal)_ | — |
| 2 | compliance-ctrl | Advisory | _(internal)_ | Evaluate guardrails (turnover cap, concentration limits) | _(internal)_ | — |
| 3 | compliance-ctrl | Advisory | _(internal)_ | Check suitability (risk profile alignment, asset restrictions) | _(internal)_ | — |
| 4 | compliance-ctrl | Advisory | _(internal)_ | Resolve authority level (L1=autonomous, L2=escalate) | _(internal)_ | — |
| 5a | compliance-ctrl | Advisory | All checks pass, L1 | Approve decision for autonomous execution | DECISION_APPROVED (L1) | AdvisoryBus |
| 5b | compliance-ctrl | Advisory | All checks pass, L2 | Approve but escalate to user | DECISION_APPROVED (L2) + USER_CONFIRMATION_REQUESTED | AdvisoryBus |
| 6 | compliance-ctrl | Advisory | Any check | Create audit artifact for traceability | AUDIT_ARTIFACT_CREATED | AdvisoryBus |

**Guardrail rules:**

| Rule | Description |
|------|------------|
| MandateValidator | Mandate type (ADVISORY/DISCRETIONARY), effective dates, revocation status |
| GuardrailEvaluator | Monthly turnover cap, max single trade %, concentration limits |
| SuitabilityChecker | Risk profile alignment, restricted asset classes |
| AuthorityResolver | L1 (autonomous, within mandate) vs L2 (needs user confirmation) |
