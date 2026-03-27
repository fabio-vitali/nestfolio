> **Deprecated:** This document has been superseded by `flows/deposit.flow.yaml` and the agent documentation system. See `docs/agent-system.md` for details.

# Feature #2 — Deposit (Happy Path)

A deposit starts in the Investor domain and ripples across all four domains. The investor-bff validates and persists the request, investor-adpt forwards it to ExecutionBus. In the Execution domain, `broker-ctrl` routes the deposit based on the tenant's **execution mode** — either to the simulation engine (`broker-sim-adpt`) or to the live broker (`broker-alpaca-adpt`). Both paths normalize back to a common `NormalizedEvent` via `deposit-withdrawal-normalizer`. execution-adpt then fans the event out to AdvisoryBus (which may trigger a rebalance decision) and LedgerBus (which appends an event-sourced entry and updates the portfolio snapshot).

**Trigger**: User initiates a deposit via investor-mfe (either during onboarding or as a subsequent top-up).

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
        R1["broker-ctrl: Route by Execution Mode"]
        R2{"Mode?"}
        SIM["broker-sim-adpt: Sim Engine"]
        LIVE["broker-alpaca-adpt: Alpaca API"]
        NORM["broker-ctrl: Normalize Result"]
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
    EB --> R1
    R1 --> R2
    R2 -- "simulation" --> SIM
    R2 -- "live" --> LIVE
    SIM --> NORM
    LIVE --> NORM
    NORM --> B2
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
    R1:::execution
    R2:::decision
    SIM:::execution
    LIVE:::execution
    NORM:::execution
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

## Execution Mode Routing (broker-ctrl)

`broker-ctrl/deposit-withdrawal-router` reads the tenant's execution mode from DDB (`ExecutionMode#${tenantId}`) and emits a mode-specific event:

| Execution Mode | Routed Event | Adapter | Direction Field |
|---------------|-------------|---------|-----------------|
| `simulation` | `SIM_DEPOSIT_INITIATED` | broker-sim-adpt | `INCOMING` |
| `live` | `ALPACA_TRANSFER_REQUESTED` | broker-alpaca-adpt | `INCOMING` |

Each adapter processes the deposit and emits a completion event:

| Adapter Path | Completion Event |
|-------------|-----------------|
| Simulation | `SIM_DEPOSIT_COMPLETED` |
| Live (Alpaca) | `ALPACA_TRANSFER_COMPLETED` (or `ALPACA_TRANSFER_FAILED`) |

`broker-ctrl/deposit-withdrawal-normalizer` materializes both completion paths into a common `NormalizedEvent` record (DDB key: `NormalizedEvent#${tenantId}#${depositId}`, sk: `DEPOSIT_DETECTED`), tagged with the `executionMode` that was used. This normalized record triggers CDC emission of `DEPOSIT_DETECTED`, which downstream services consume identically regardless of execution mode.

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | investor-bff | Investor | GraphQL mutation | JS resolver validate + DDB insert | DEPOSIT_INITIATED (CDC) | InvestorBus |
| 2 | investor-ctrl | Investor | DEPOSIT_INITIATED | Create push notification | NOTIFICATION_CREATED | InvestorBus |
| 3 | investor-adpt | Investor | DEPOSIT_INITIATED | Cross-domain forward | DEPOSIT_INITIATED | ExecutionBus |
| 4 | broker-ctrl | Execution | DEPOSIT_INITIATED | Read execution mode, route deposit | SIM_DEPOSIT_INITIATED or ALPACA_TRANSFER_REQUESTED | ExecutionBus |
| 5a | broker-sim-adpt | Execution | SIM_DEPOSIT_INITIATED | Simulation engine credits balance | SIM_DEPOSIT_COMPLETED | ExecutionBus |
| 5b | broker-alpaca-adpt | Execution | ALPACA_TRANSFER_REQUESTED | Alpaca API transfer (direction=INCOMING) | ALPACA_TRANSFER_COMPLETED or ALPACA_TRANSFER_FAILED | ExecutionBus |
| 6 | broker-ctrl | Execution | SIM_DEPOSIT_COMPLETED / ALPACA_TRANSFER_COMPLETED | Normalize to NormalizedEvent (DEPOSIT_DETECTED) | DEPOSIT_DETECTED (CDC) | ExecutionBus |
| 7 | execution-adpt | Execution | DEPOSIT_DETECTED | Cross-domain forward | DEPOSIT_DETECTED | AdvisoryBus + LedgerBus |
| 8 | advisory-ctrl | Advisory | DEPOSIT_DETECTED | Evaluate rebalance trigger | DECISION_PACKET_CREATED _(conditional)_ | AdvisoryBus |
| 9 | ledger-ctrl | Ledger | DEPOSIT_DETECTED | Append event-sourced entry | LEDGER_ENTRY_RECORDED | LedgerBus |
| 10 | dashboard-bff | Read Model | BALANCE_UPDATED | Update materialized view | _(terminal)_ | — |
