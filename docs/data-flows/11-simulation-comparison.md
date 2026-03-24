# Feature #11 — Simulation Comparison (Happy Path)

Simulation comparison answers "what if we had followed every advisory recommendation?". In the background, whenever a DECISION_PACKET_CREATED event arrives, ledger-ctrl's ShadowFillService extracts proposed trades and simulates fills at current market prices via CachedMarketDataProvider, recording them as `streamType: simulated` ledger entries with synthetic eventIds (`${id}-sim-${symbol}`). The Reducer builds a parallel Account snapshot from the simulated stream. On query, ledger-bff reads both actual and simulated snapshots + positions in parallel (Promise.all), computes cash delta and per-symbol position diffs, and returns the comparison to ledger-mfe.

**Trigger**: User opens the comparison view in the ledger-mfe.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Simulation Stream (Background)"]
        S1["DECISION_PACKET_CREATED"]
        S2["ShadowFillService: Simulate Fills"]
        S3["Append LedgerEntry (simulated)"]
        S4["Reducer: Simulated Account Snapshot"]
    end
    subgraph subGraph1["Actual Stream (Background)"]
        T1["Execution Events"]
        T2["Append LedgerEntry (actual)"]
        T3["Reducer: Actual Account Snapshot"]
    end
    subgraph subGraph2["Ledger MFE"]
        A1["Open Comparison View"]
    end
    subgraph subGraph3["ledger-bff (Lambda Resolver)"]
        B1["Parallel Reads (Promise.all)"]
        B2["Fetch Actual Snapshot + Positions"]
        B3["Fetch Simulated Snapshot + Positions"]
        B4["Compute cashDeltaCents + positionDiffs"]
        B5["Return SimulationComparison"]
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
    S3:::simulation
    S4:::simulation
    T1:::execution
    T2:::ledger
    T3:::ledger
    A1:::ledgermfe
    B1:::ledger
    B2:::ledger
    B3:::simulation
    B4:::ledger
    B5:::ledger
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef simulation fill:#FFEEDD,stroke:#CC8833,color:#000
    classDef ledgermfe fill:#FFEACC,stroke:#B07A3A,color:#000
```

---

## Summary Table

**Background: Simulation stream creation**

| Step | Component | Domain | Input Event | Action | Output |
|------|-----------|--------|-------------|--------|--------|
| 1 | ledger-ctrl | Ledger | DECISION_PACKET_CREATED | ShadowFillService: extract proposedTrades from decision packet | _(internal)_ |
| 2 | ShadowFillService | Ledger | Proposed trades | Simulate fill per trade via CachedMarketDataProvider (synthetic price) | Synthetic ORDER_FILLED events (eventId: `${id}-sim-${symbol}`) |
| 3 | ledger-ctrl | Ledger | Synthetic events | Append LedgerEntry with streamType: `simulated` | LEDGER_ENTRY_RECORDED (CDC) |
| 4 | Reducer | Ledger | DDB Stream INSERT | Replay simulated stream (`tenantId#simulated`), build Account snapshot | Account snapshot stored |

**Foreground: Comparison query**

| Step | Component | Domain | Input | Action | Output |
|------|-----------|--------|-------|--------|--------|
| 1 | ledger-mfe | Frontend | User opens comparison view | GraphQL `getSimulationComparison` | _(request)_ |
| 2 | ledger-bff | Ledger | Query (Lambda resolver) | Promise.all: actual snapshot + simulated snapshot + actual positions + simulated positions | _(internal)_ |
| 3 | ledger-bff | Ledger | Both snapshots + positions | Compute `cashDeltaCents = simulated - actual`, `positionDiffs[]` per symbol (`quantityDiff = simulated - actual`) | SimulationComparison result |
| 4 | ledger-mfe | Frontend | Comparison response | Render divergence table (actual vs simulated) | _(UI render)_ |

**Note**: `getSimulationComparison` is a Lambda resolver (not JS pipeline) because it requires parallel DDB reads. See Feature #9 for dual-stream architecture.
