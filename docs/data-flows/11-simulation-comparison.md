# Feature #11 — Simulation Comparison (Happy Path)

**Trigger**: User opens the comparison view in the ledger-mfe.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Simulation Stream (Background)"]
        S1["DECISION_PACKET_CREATED"]
        S2["ShadowFillService: Simulate Fills"]
        S3["Record Simulated Entries"]
        S4["Reducer: Simulated Snapshot"]
    end
    subgraph subGraph1["Actual Stream (Background)"]
        T1["Execution Events"]
        T2["Record Actual Entries"]
        T3["Reducer: Actual Snapshot"]
    end
    subgraph subGraph2["Ledger MFE"]
        A1["Open Comparison View"]
    end
    subgraph subGraph3["Ledger Domain"]
        B1["BFF: Parallel Reads"]
        B2["Fetch Actual Snapshot"]
        B3["Fetch Simulated Snapshot"]
        B4["Compute Position Diffs"]
        B5["Return Comparison"]
    end
    S1 --> S2
    S2 --> S3
    S3 --> S4
    T1 --> T2
    T2 --> T3
    U(("User")) --> A1
    A1 --> B1
    B1 --> B2 & B3
    B2 --> B4
    B3 --> B4
    B4 --> B5
    B5 --> A1

    S1:::advisory
    S2:::ledger
    S3:::ledger
    S4:::ledger
    T1:::execution
    T2:::ledger
    T3:::ledger
    A1:::ledgermfe
    B1:::ledger
    B2:::ledger
    B3:::ledger
    B4:::ledger
    B5:::ledger
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef ledgermfe fill:#FFEACC,stroke:#B07A3A,color:#000
```

---

## Summary Table

**Background: Simulation stream creation**

| Step | Component | Domain | Input Event | Action | Output |
|------|-----------|--------|-------------|--------|--------|
| 1 | ledger-ctrl | Ledger | DECISION_PACKET_CREATED | Extract proposed trades from decision packet | _(internal)_ |
| 2 | ShadowFillService | Ledger | Proposed trades | Simulate fill for each trade (synthetic price) | Synthetic ORDER_FILLED events |
| 3 | ledger-ctrl | Ledger | Synthetic events | Record entries with streamType: simulated | LEDGER_ENTRY_RECORDED |
| 4 | Reducer | Ledger | DDB Stream | Replay simulated stream, build Account snapshot | _(snapshot stored)_ |

**Foreground: Comparison query**

| Step | Component | Domain | Input | Action | Output |
|------|-----------|--------|-------|--------|--------|
| 1 | ledger-mfe | Frontend | User opens comparison view | GraphQL `getSimulationComparison` | _(request)_ |
| 2 | order-ledger-bff | Ledger | Query | Parallel reads (Promise.all): actual + simulated snapshots + positions | _(internal)_ |
| 3 | order-ledger-bff | Ledger | Both snapshots | Compute cashDeltaCents + positionDiffs by symbol | Comparison result |
| 4 | ledger-mfe | Frontend | Comparison response | Render divergence table (actual vs simulated) | _(UI render)_ |
