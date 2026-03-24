# Feature #4 — Notification Delivery (Happy Path)

Notifications are a cross-cutting concern handled entirely within the Investor domain. investor-ctrl listens for 11 events from all domains (onboarding, goals, deposits, withdrawals, operating mode, decisions, order fills/rejections, balance updates) and creates notification records in DynamoDB. investor-bff serves them via GraphQL queries and pushes real-time updates through AppSync subscriptions.

**Trigger**: A domain event occurs that requires user notification.

---

## Flowchart

```mermaid
flowchart TB
    subgraph subGraph0["Source Domains"]
        S1["Investor Events"]
        S2["Advisory Events"]
        S3["Execution Events"]
        S4["Ledger Events"]
    end
    subgraph subGraph1["Investor Domain"]
        IB{{"InvestorBus"}}
        A1["Create Notification Record"]
        A2["BFF: Serve via GraphQL"]
        A3["AppSync Subscription Push"]
    end
    subgraph subGraph2["User"]
        U1["Receive Push"]
        U2["View Notification List"]
        U3["Mark as Read"]
    end
    S1 & S2 & S3 & S4 --> IB
    IB --> A1
    A1 --> A3
    A3 --> U1
    A2 --> U2
    U2 --> U3
    U3 --> A2

    S1:::investor
    S2:::advisory
    S3:::execution
    S4:::ledger
    IB:::bus
    A1:::investor
    A2:::investor
    A3:::investor
    U1:::user
    U2:::user
    U3:::user
    classDef investor fill:#D6E4FF,stroke:#3A6FB0,color:#000
    classDef advisory fill:#D6FFD9,stroke:#3AB05A,color:#000
    classDef execution fill:#FFE2D6,stroke:#B05A3A,color:#000
    classDef ledger fill:#FFF5CC,stroke:#B09A3A,color:#000
    classDef bus fill:#F5F5F5,stroke:#999,stroke-dasharray:5 5
    classDef user fill:#FFF,stroke:#333,color:#000
```

---

## Summary Table

| Step | Component | Domain | Input Event | Action | Output Event | Target Bus |
|------|-----------|--------|-------------|--------|-------------|------------|
| 1 | investor-ctrl | Investor | ONBOARDING_COMPLETED | Create notification "Welcome to Nestfolio" (email) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | MANDATE_GRANTED | Create notification "Investment Mandate Activated" (push) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | GOAL_UPDATED | Create notification "Goal Updated" (push) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | DEPOSIT_INITIATED | Create notification "Deposit Received" (push) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | OPERATING_MODE_CHANGED | Create notification "Operating Mode Changed" (push) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | DECISION_APPROVED | Create notification "Investment Decision Approved" (push) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | DECISION_BLOCKED | Create notification "Decision Blocked" (push) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | ORDER_FILLED | Create notification "Order Executed" (email) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | ORDER_REJECTED | Create notification "Order Rejected" (push) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | WITHDRAWAL_COMPLETED | Create notification "Withdrawal Completed" (email) | NOTIFICATION_CREATED | InvestorBus |
| 1 | investor-ctrl | Investor | BALANCE_UPDATED | Create notification (default template, push) | NOTIFICATION_CREATED | InvestorBus |
| 2 | investor-bff | Investor | GraphQL `getNotifications` | Query paginated notifications from DDB | _(response)_ | — |
| 3 | investor-bff | Investor | AppSync subscription `onNotification` | Real-time push to connected clients | _(websocket)_ | — |
| 4 | investor-bff | Investor | GraphQL `markNotificationRead` | Update status to READ | NOTIFICATION_READ (CDC) | InvestorBus |
