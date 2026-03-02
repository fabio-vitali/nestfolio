# Event Flows

Describes inter-domain event routing, the cross-domain subscription matrix, and the primary end-to-end flows that drive Nestfolio's business processes. For service-level event contracts and intra-domain subscriptions, see [Service Inventory](./service-inventory.md).

> [Back to Index](../../README.md) | [Section Overview](./README.md)

---

## Event Hub Topology

Eight domain buses consolidated into three:

| Event Hub | Consolidates | Bus |
|---|---|---|
| `investor-hub` | identity-hub + investor-hub + notification-hub | Investor domain EventBridge bus |
| `advisory-hub` | advisory-hub + compliance-hub + operations-hub | Advisory domain EventBridge bus |
| `execution-hub` | execution-hub + portfolio-hub | Execution domain EventBridge bus |

Cross-domain forwarding routes reduced from approximately 25 directional routes to **6 directional routes**.

---

## Cross-Domain Forwarding Routes

| # | Direction | Purpose | Events Forwarded |
|---|---|---|---|
| 1 | Investor --> Advisory | Investor intent changes trigger advisory decisions and compliance guardrail materialization | `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED` |
| 2 | Investor --> Execution | Withdrawal requests and account closure flow to broker adapter | `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED` |
| 3 | Advisory --> Investor | Decision outcomes and operational incidents trigger notifications | `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED` |
| 4 | Advisory --> Execution | Approved decisions and circuit breaker state flow to order lifecycle | `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET` |
| 5 | Execution --> Investor | Trade outcomes and deposit/withdrawal status trigger notifications and update request state | `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_STAGED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `CORPORATE_ACTION_APPLIED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED` |
| 6 | Execution --> Advisory | Order outcomes and portfolio drift trigger new decisions; broker failures trigger incidents | `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `PORTFOLIO_DRIFT_DETECTED`, `BROKER_SESSION_LOST`, `STREAM_DISCONNECTED`, `RECONCILIATION_FAILED` |

---

## Cross-Domain Subscription Matrix

Rows represent consuming domains. Columns represent producing domains. Cells list events forwarded across domain boundaries.

| Consumer / Producer | Investor | Advisory | Execution |
|---|---|---|---|
| **Investor** | -- | `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED` | `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_STAGED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `CORPORATE_ACTION_APPLIED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED` |
| **Advisory** | `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED` | -- | `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `PORTFOLIO_DRIFT_DETECTED`, `BROKER_SESSION_LOST`, `STREAM_DISCONNECTED`, `RECONCILIATION_FAILED` |
| **Execution** | `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED` | `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET` | -- |

---

## Primary Cross-Domain Flows

### Decision Lifecycle

The core end-to-end flow from investor intent through AI-driven recommendation to trade execution.

```
Investor ──[GOAL_UPDATED, OPERATING_MODE_CHANGED]──> Advisory
Execution ──[PORTFOLIO_DRIFT_DETECTED]──────────────> Advisory
Execution ──[ORDER_FILLED, DEPOSIT_DETECTED]────────> Advisory
    |
    v
Advisory (advisory-ctrl: 6-agent orchestration --> Decision Packet)
    |
    v  DECISION_PACKET_CREATED (intra-domain)
Advisory (compliance-ctrl: validate --> approve/block)
    |
    v  DECISION_APPROVED (intra-domain)
Advisory (advisory-ctrl: Level 2? --> USER_CONFIRMATION_REQUESTED --> USER_CONFIRMED)
    |
    v  DECISION_APPROVED + USER_CONFIRMED (cross-domain --> execution-hub)
Execution (execution-ctrl: safety checks --> ORDER_SUBMITTED)
    |
    v  ORDER_SUBMITTED (intra-domain)
Execution (execution-adpt: IBKR --> ORDER_FILLED)
    |
    v  ORDER_FILLED + PORTFOLIO_SNAPSHOT_IMPORTED (intra-domain)
Execution (portfolio-bff: update projections; portfolio-ctrl: reconciliation)
```

**Trigger sources**: Investor intent changes (goal updates, operating mode changes), execution outcomes (order fills, deposits detected), portfolio drift detection.

**SAGA compensation**: On compliance block, advisory-ctrl rolls back the Decision Packet. On user rejection, the decision is archived without execution handoff.

---

### User Onboarding

```
Investor (investor-web: Cognito) ──[USER_REGISTERED]──> Investor (investor-bff)
    |                                                     [intra-domain]
    v
Investor (investor-bff: onboarding conversation)
    | GOAL_SET, RISK_PROFILE_SET, OPERATING_MODE_SELECTED, MANDATE_GRANTED
    | ONBOARDING_COMPLETED
    |
    |──> Advisory (compliance-ctrl: stores guardrail policy)     [cross-domain]
    |──> Advisory (advisory-ctrl: may trigger initial assessment) [cross-domain]
    +──> Investor (investor-ctrl: sends welcome notification)    [intra-domain]
```

---

### Reconciliation

Intra-domain flow within the Execution domain. Compares broker settlement truth against internal projection (intent truth).

```
Execution (execution-adpt) ──[PORTFOLIO_SNAPSHOT_IMPORTED]──> Execution (portfolio-ctrl)
    --> Compare intent vs settlement                           [intra-domain]
    --> If drift: PORTFOLIO_DRIFT_DETECTED
    --> RECONCILIATION_LOCK_ACQUIRED
    --> Execution (execution-ctrl) pauses affected instruments  [intra-domain]
    --> Execution (portfolio-ctrl) corrects projections
    --> RECONCILIATION_COMPLETED --> RECONCILIATION_LOCK_RELEASED
    --> Execution resumes
```

Reconciliation runs on three schedules: post-execution (after every order fill), periodic (hourly, daily), and startup.

---

### Deposit Flow

```
Investor (investor-bff) ──[DEPOSIT_INITIATED]──> Investor (investor-ctrl: sends "pending")
                                                  [intra-domain]

Execution (execution-adpt) ──[DEPOSIT_DETECTED]──> Advisory (triggers investment assessment)
                                                    [cross-domain]
                                                  > Investor (investor-ctrl: sends "received")
                                                    [cross-domain]
                                                  > Investor (investor-bff: updates deposit status)
                                                    [cross-domain]
```

Deposit detection occurs when `execution-adpt` observes a cash balance increase in a periodic IBKR snapshot import.

---

### Withdrawal Flow

```
Investor (investor-bff) ──[WITHDRAWAL_REQUESTED]──> Execution (execution-adpt: submits to IBKR)
                                                     [cross-domain]

Execution ──[WITHDRAWAL_COMPLETED/REJECTED]──> Investor (investor-bff: updates status)
                                                [cross-domain]
                                              > Investor (investor-ctrl: notifies user)
                                                [cross-domain]
```

**SAGA compensation**: While `WITHDRAWAL_REQUESTED` is in flight, `execution-ctrl` excludes the withdrawal amount from rebalanceable cash and blocks new rebalance orders that would overlap. If `WITHDRAWAL_REJECTED` arrives while a rebalance is queued, held cash is released back to the rebalanceable pool and the queued rebalance re-evaluates. If a rebalance is already submitted and `WITHDRAWAL_REJECTED` arrives, no compensation is needed -- the next scheduled decision cycle accounts for the restored cash position.

---

### Account Closure

```
Investor (investor-bff) ──[ACCOUNT_CLOSURE_REQUESTED]──> Execution (execution-ctrl)
                                                          [cross-domain]
    --> Cancels all pending/staged orders
    --> Blocks new order submissions
    --> Account enters terminal wind-down state
    --> Investor (investor-bff) confirms ACCOUNT_CLOSED after wind-down
```

---

### Incident Response

```
Execution ──[failure/anomaly events]──> Advisory (operations-ctrl)  [cross-domain]
Advisory (advisory-ctrl failures)──> Advisory (operations-ctrl)     [intra-domain]
    --> Detection & classification (SEV-1 through SEV-5)
    --> CIRCUIT_BREAKER_TRIGGERED --> Execution pauses              [cross-domain]
    --> Stabilization workflows
    --> Human review via advisory-bff (ops dashboard)
    --> INCIDENT_RESOLVED --> CIRCUIT_BREAKER_RESET                 [cross-domain]
    --> Execution resumes
```

Incident triggers include broker session loss, stream disconnection, order rejection anomalies, portfolio drift detection, reconciliation failure, agent execution failure, guardrail violations, and suitability check failures.

---

## Frontend Composition

### Investor Web App (Host)

Mobile-first responsive web app (PWA candidate). Entry point: `investor-web` (CloudFront + Route53). Auth: Cognito. Locales: it-IT (primary), en-GB (secondary).

| Navigation Tab | Screen | Microfrontend Source |
|---|---|---|
| **Home** | Dashboard | Composite: `portfolio-bff` (portfolio value) + `advisory-bff` (status banner, action required) + `investor-bff` (recent activity) |
| **Portfolio** | Portfolio Detail | `portfolio-bff` (primary), `advisory-bff` (target allocation) |
| **Notifications** | Activity & Notifications | `investor-bff` |
| **Settings** | Settings & Profile | `investor-bff` (primary) + `advisory-bff` (safety rules) |
| -- | Onboarding | `investor-bff` |
| -- | Decision Detail "Why" | `advisory-bff` |
| -- | Confirmation Dialog | `advisory-bff` |
| -- | IBKR Connection | `investor-bff` |
| -- | Deposit Flow | `investor-bff` |
| -- | Withdrawal Flow | `investor-bff` |
| -- | Account Closure | `investor-bff` |
| -- | How Nestfolio Works | `investor-bff` + `advisory-bff` |
| -- | Landing / Marketing | `investor-web` (static) |
| -- | Sign Up / Sign In | `investor-web` (Cognito hosted UI) |

### Operations Dashboard (Host)

Desktop-first internal web app for Platform Operator, Compliance Reviewer, and AI Governance Reviewer.

| Section | Microfrontend Source |
|---|---|
| System Health & Incidents | `advisory-bff` |
| AI Model Registry & Promotion | `advisory-bff` |
| Shadow Comparison Reports | `advisory-bff` |
| Cost Governance | `advisory-bff` |
| Compliance Dashboard & Audit Trail | `advisory-bff` |
