# Portfolio Management

Portfolio operations, rebalancing logic, execution flow, broker integration, and incident governance for the Nestfolio platform.

> [Back to Index](../README.md) | [Section Overview](./README.md)

---

## Portfolio Truth Model

Nestfolio adopts a **Dual Truth Model** aligned with institutional investment management practices.

| Truth Domain | Owner | Represents |
|---|---|---|
| Intent Truth | Nestfolio (Event Store) | Decisions, authorized trade plans, submitted orders, expected portfolio state |
| Settlement Truth | Interactive Brokers (IBKR) | Executed trades, actual holdings, cash balances, corporate actions |

**Settlement truth always prevails for real asset state.** When intent and settlement diverge, the system triggers reconciliation workflows to resolve the discrepancy rather than assuming internal state is correct.

---

## Portfolio Lifecycle

A portfolio progresses through a defined lifecycle from onboarding through ongoing management:

1. **Goal Capture** -- User expresses investment goals through conversational onboarding
2. **Risk Profiling** -- Risk Agent assesses suitability and assigns a risk band
3. **Mandate Grant** -- User grants a scoped discretionary mandate with an operating mode (Conservative, Balanced, or Aggressive)
4. **Portfolio Construction** -- Portfolio Construction Agent generates a target allocation based on goals, risk profile, and mandate
5. **Initial Execution** -- Execution Agent places initial orders via IBKR
6. **Ongoing Monitoring** -- Continuous monitoring for drift, market changes, and goal progress
7. **Rebalancing** -- Periodic or event-triggered adjustments to maintain alignment with target allocation
8. **Reporting** -- Regular performance reports and explanation delivery

The mandate can be updated or revoked at any point. Mandate changes are L2 actions requiring user confirmation.

---

## Rebalancing Logic

Rebalancing is the primary mechanism by which Nestfolio maintains portfolio alignment with user goals.

### Rebalancing Triggers

Rebalancing evaluation is initiated by:

- **Drift detection** -- Portfolio allocation drifts beyond the operating mode's threshold
- **Scheduled cadence** -- Periodic review at the frequency defined by the operating mode (quarterly, monthly, or bi-weekly)
- **Material events** -- Deposit confirmed, goal change, risk profile update, or corporate action applied
- **Market regime change** -- Significant shift in market conditions detected by the Market and Research Agent

### Rebalancing Flow

```
Trigger Event
     |
     v
Rebalance Need Detected
     |
     v
Portfolio Construction Agent --> Target Allocation
     |
     v
Rebalance Planner Agent --> Trade Plan
     |
     v
Risk Checks (pre/post risk band, stress tests)
     |
     v
Cost Checks (fees, slippage, tax impact)
     |
     v
Decision Packet Created
     |
     v
Compliance Agent Authorization
     |
     +-- Blocked --> Escalate or Postpone
     |
     +-- Approved (L2) --> Request User Confirmation
     |                           |
     |                     +-- Rejected --> Archive
     |                     |
     |                     +-- Confirmed --|
     |                                     |
     +-- Approved (L1) -------------------|
                                           |
                                           v
                                   Execution Agent
                                           |
                                           v
                                   Orders to IBKR
```

### Anti-Thrashing Rules

To prevent excessive trading caused by noisy signals:

- A minimum cool-down period is enforced per instrument after execution (10, 5, or 2 trading days depending on operating mode)
- New decisions affecting the same instrument are blocked during cool-down unless a circuit breaker is triggered or a user override (L2) is required
- Monthly turnover caps limit total trading volume per rebalance window

---

## Execution Flow

Nestfolio adopts an **Immediate Execution Policy** for MVP. Approved decisions are executed as soon as possible when compliance authorization is granted, guardrails are satisfied, and the market venue is open.

### Market Hours and Order Staging

- **Market open** -- Order submitted immediately
- **Market closed** -- Order enters `Staged` state and is submitted at the next valid trading window
- Staged orders are revalidated by the Compliance Agent before submission

### Pre-Submission Safety Checks

Before every order submission, the Execution Agent verifies:

- No active reconciliation lock for affected instruments
- No pending conflicting staged order
- Turnover limits respected
- Market liquidity checks pass

Failure of any check converts execution into an L2 escalation or postponement event.

### Escalation Conditions

Execution escalates to L2 when:

- Market liquidity is degraded
- Volatility circuit breaker is active
- Order would execute during abnormal market conditions
- Multiple rapid decisions detected within cool-down window

---

## Interactive Brokers Integration

Nestfolio integrates with IBKR using a **full trading plus streaming posture** for low-latency execution feedback, near real-time portfolio projections, and continuous reconciliation.

### Boundary of Responsibilities

| Nestfolio Owns | IBKR Owns |
|---|---|
| Mandate, guardrails, and suitability logic | Custody and settlement truth |
| Decision Packets and audit trail | Order routing and exchange connectivity |
| Order intent generation and idempotency keys | Execution outcomes (fills, partial fills, rejects) |
| Execution authorization (Compliance Agent) | Account and position balances as broker-of-record |
| Reconciliation logic and drift resolution | |
| User-facing explanations and reports | |

### Integration Surfaces

- **Authentication and Session Management** -- Secure connection setup and credential handling
- **Order APIs** -- Submit, modify, and cancel orders
- **Streaming Feeds** -- Order status updates, execution reports and fills, account and position updates, market data subscriptions

### Order Lifecycle

Internal order states map to IBKR execution events:

```
Draft --> Authorized --> Submitted --> Acknowledged --> PartiallyFilled --> Filled
                                                                       --> Rejected
                                                                       --> Cancelled
```

All state transitions are appended to the event store and drive projection updates.

### Idempotency and Safety

- Each Decision Packet has a unique `decision_id`
- Each order has an `order_key = hash(decision_id, instrument_id, side, quantity, limit_params)`
- Execution is idempotent on `order_key` (safe retry)
- Orders cannot be resubmitted unless explicitly invalidated by reconciliation events
- Only the Execution Agent can submit, modify, or cancel orders (Single Writer Principle)

### Streaming Reliability

**Connection strategy:**
- Persistent streaming connections per account context
- Heartbeats to detect stale streams
- Automatic reconnection with exponential backoff

**Catch-up on reconnect:**
1. Snapshot import (`PortfolioSnapshotImported`)
2. Stream resubscription
3. Reconciliation pass

### Error Taxonomy

| Category | Examples | Handling |
|---|---|---|
| Retriable | Network timeouts, 5xx broker errors, rate limiting, temporary data feed failures | Exponential backoff with jitter, idempotent resubmission via `order_key`, retry budgets per Decision Packet |
| Terminal | Insufficient funds/margin, invalid instrument, permission failures, compliance violations | Emit terminal error events, escalate to L2 (user notification), require reconciliation and/or user action |

### Credential Isolation

Nestfolio uses a **User-Delegated Authorization Model** for IBKR access:

1. User connects IBKR account via secure authorization flow
2. IBKR issues delegated access artifacts (tokens or equivalent)
3. Nestfolio stores only the delegated artifacts in a managed secrets vault, partitioned by `tenant_id`
4. Tokens are exchanged for short-lived runtime credentials at execution time

Only the Execution Agent can access broker secrets. Credentials never appear in logs, events, or Context Bundles. Token refresh is automatic. Users may revoke authorization at any time, which pauses execution until reauthorization.

See [Governance and Compliance](../06-governance-compliance.md) for the full secrets handling and break-glass controls.

---

## Reconciliation

The Reconciliation Agent continuously compares internal portfolio projections against IBKR settlement truth.

### Reconciliation Cadence

| Timing | Trigger |
|---|---|
| Post-execution | After order fills are confirmed |
| Scheduled (hourly) | Periodic consistency check |
| Daily full | Complete portfolio reconciliation |
| Startup | After outages or service restarts |

### Drift Detection

Drift is detected when any of the following occur:

- Position quantity mismatch between projection and broker
- Cash balance mismatch
- Missing or unexpected fills
- Corporate actions not reflected internally

Detected drift emits `PortfolioDriftDetected` and `ReconciliationRequired` events.

### Safe Recovery Flow

1. Execution paused for affected instruments (reconciliation lock)
2. IBKR snapshot imported as authoritative source
3. Internal projections corrected to match settlement truth
4. Adjustment events emitted to the event store
5. Compliance revalidation executed
6. Normal operation resumes

If reconciliation confidence is low, the system escalates to L2 or human review rather than proceeding automatically.

### Never-Double-Trade Guarantees

Duplicate execution is prevented through multiple layers:

- Decision Packet idempotency via `decision_id`
- Order keys tied to decision IDs
- Execution confirmation checkpoints
- Reconciliation lock during drift resolution
- Orders cannot be resubmitted unless explicitly invalidated by reconciliation events

---

## Circuit Breakers

Execution is automatically paused when:

- Market volatility exceeds configured thresholds for the operating mode
- IBKR portfolio sync mismatch is detected
- Data feeds are unavailable or inconsistent
- Compliance validation fails

### Recovery from Circuit Breaker

Resuming execution requires:

- Successful resynchronization of portfolio state
- Compliance revalidation of pending decisions
- User confirmation (depending on severity)

Circuit breakers can pause execution regardless of market hours or stream state.

---

## Incident Governance for Portfolio Operations

Incidents affecting portfolio operations follow the platform's autonomous containment model with human oversight.

### Portfolio-Related Incident Classes

| Class | Example | Automatic Response |
|---|---|---|
| Broker Connectivity | IBKR streaming loss | Execution pause, switch to monitoring-only |
| Portfolio Drift | Position mismatch after reconciliation | Reconciliation lock, snapshot import, projection rebuild |
| Execution Failure | Repeated order rejections | Agent retry with backoff, escalate after budget exhausted |
| Data Integrity | Inconsistent market data feeds | Pause non-critical analysis, continue safety checks |

### Containment Actions

Depending on incident severity, the system may automatically:

- Pause execution globally or per tenant
- Activate reconciliation lock
- Tighten guardrails temporarily
- Disable affected agents

All containment actions are reversible only after review by a Platform Operator or Compliance Reviewer.

### Severity Levels

| Level | Example | Automatic Action |
|---|---|---|
| SEV-1 | Market data disruption | Agent retry |
| SEV-2 | Broker streaming loss | Execution pause |
| SEV-3 | Portfolio drift mismatch | Reconciliation lock |
| SEV-4 | Model anomaly | Model rollback |
| SEV-5 | Systemic risk | Global execution freeze |

See [Operations and Deployment](../07-operations-deployment.md) for the full incident response lifecycle and production launch controls.

---

## User Communication for Portfolio Events

Portfolio actions generate user notifications following the platform's contextual hybrid communication model.

### Notification Timing by Authority Level

| Authority Level | Default Timing |
|---|---|
| L1 (Autonomous) | Post-execution explanation |
| L2 (Confirmation Required) | Pre-execution confirmation request |
| High-Impact L1 | Soft pre-notice when feasible (non-blocking) |

### Notification Severity Tiers

| Tier | Example | Timing |
|---|---|---|
| Informational | Monthly update, minor rebalance | Post-fact |
| Advisory | Recommendation available | Pre or post |
| Impactful | Large rebalance within guardrails | Soft pre-notice |
| Confirmable | Strategy or risk change | Pre-execution confirmation |
| Critical | Circuit breaker, execution pause | Immediate alert |

Users may override default timing preferences within safe bounds (post-fact, pre-intent, or hybrid mode). The Compliance Agent ensures overrides cannot bypass mandate or safety rules.

All notifications are linked to Decision Packet IDs for traceability. Explanations follow trust reinforcement principles: plain language, positive framing, easy access to "why" details, and clear indication when user action is required.

See [UI/UX Specification](../08-ui-ux/README.md) for notification channel design and messaging lifecycle.
