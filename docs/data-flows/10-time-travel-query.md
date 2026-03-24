# Feature #10 — Time-Travel Query (Happy Path)

**Trigger**: User selects a past timestamp in the ledger-mfe time-travel UI.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Ledger MFE"]
        A1["Select Timestamp"]
    end
    subgraph subGraph1["Ledger Domain"]
        B1["BFF: Validate Timestamp"]
        B2["Authorize Tenant"]
        B3["Retrieve Snapshot ≤ Timestamp"]
        B4["Return Portfolio State"]
    end
    subgraph subGraph2["Storage"]
        C1[("DDB: Account Snapshots")]
    end
    U(("User")) --> A1
    A1 --> B1
    B1 --> B2
    B2 --> B3
    B3 --> C1
    C1 --> B4
    B4 --> A1

    A1:::ledgermfe
    B1:::ledger
    B2:::ledger
    B3:::ledger
    B4:::ledger
    C1:::storage
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef ledgermfe fill:#FFEACC,stroke:#B07A3A,color:#000
    classDef storage fill:#F0F0F0,stroke:#999,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input | Action | Output |
|------|-----------|--------|-------|--------|--------|
| 1 | ledger-mfe | Frontend | User picks timestamp on timeline slider | GraphQL query `getPortfolioAt(timestamp)` | _(request)_ |
| 2 | order-ledger-bff | Ledger | GraphQL query | Validate timestamp (TimestampSchema) | _(internal)_ |
| 3 | order-ledger-bff | Ledger | Validated timestamp | Authorize tenant from Cognito claims | _(internal)_ |
| 4 | order-ledger-bff | Ledger | tenantId + timestamp | Retrieve latest Account snapshot ≤ target timestamp | Portfolio state |
| 5 | ledger-mfe | Frontend | Portfolio state response | Render positions, cash balance, holdings at that point in time | _(UI render)_ |

**Note**: This is a synchronous query flow (no events). Portfolio snapshots are pre-computed daily by the ledger-ctrl reducer (see Feature #9).
