# Nestfolio — Volume 2: System Architecture

## 1. Purpose of this Document
This document evolves the Nestfolio product vision into an actionable system plan. It will define architecture, agents, data flows, compliance boundaries, and operational behaviors.

This is a living document and will be iteratively refined.

---

## 2. Product Summary
Nestfolio is an AI‑managed investment platform that acts as a digital financial coach for novice investors.

Core promise:
- Users express goals conversationally
- AI manages portfolios automatically
- Trades are executed via Interactive Brokers (IBKR)
- Users receive simple explanations and actionable guidance

---

## 3. System Goals
- Fully automated portfolio lifecycle
- Trust-first user experience
- Explainable AI decisions
- Regulatory auditability
- Localization-first architecture
- Scalable multi-agent backend

---

## 4. High-Level System Domains

### 4.1 User Experience Domain
Handles all user-facing interactions:
- Conversational onboarding
- Dashboard
- Recommendations
- Explainability views
- Notifications

### 4.2 AI Advisory Domain
Responsible for investment reasoning:
- Goal interpretation
- Risk profiling
- Portfolio strategy
- Rebalancing decisions
- Recommendation generation

### 4.3 Execution Domain
Responsible for real-world actions:
- Order generation
- IBKR integration
- Trade execution
- Position synchronization

### 4.4 Compliance & Trust Domain
Ensures regulatory alignment:
- Decision audit trails
- Model explainability
- Activity logging
- User consent tracking

### 4.5 Platform Infrastructure Domain
Underlying technical capabilities:
- Identity & authentication
- Data storage
- Event processing
- Agent orchestration
- Localization services

---

## 5. Core Architectural Principles
- Event-driven system
- Agent-based orchestration
- Human-readable decision layer
- Separation of advice vs execution
- Deterministic audit replay

---

## 6. Open Questions (Iteration 1)
- What is the primary architectural style for agents? (central orchestrator vs autonomous agents)
- What level of autonomy can agents have before compliance approval?
- Where does explainability live: generated on demand or stored with decisions?
- Real-time vs batch portfolio management cadence?
- What is the MVP regulatory scope (advice vs discretionary management)?

---

## 7. Decision Authority Model (Hybrid)

Nestfolio operates under a **Hybrid Delegated Mandate Model**.

Users grant Nestfolio a scoped discretionary mandate during onboarding. The AI system may autonomously execute investment actions **within predefined guardrails**, while certain actions remain user‑controlled.

### Authority Levels

**Level 0 — Informational**
- Portfolio insights
- Market explanations
- Progress updates
- No execution impact

**Level 1 — Autonomous Actions (Pre‑Authorized)**
- Portfolio rebalancing within risk band
- Asset allocation drift correction
- Dividend reinvestment
- Tax‑efficient adjustments

**Level 2 — User Confirmation Required**
- Strategy change
- Risk profile modification
- Large allocation shifts
- Withdrawal recommendations

**Level 3 — User Exclusive Actions**
- Deposits
- Withdrawals
- Account closure
- Mandate revocation

---

## 8. Agent Topology (Governed Multi‑Agent)

Nestfolio uses a **Governed Multi‑Agent Architecture**:
- Specialized agents perform analysis and propose actions.
- A deterministic **Orchestrator** coordinates workflows.
- A **Compliance Control Layer** authorizes (or blocks) any action that could impact execution.
- Only the Execution Agent can place orders, and only after authorization.

### Topology Overview

**Orchestrator (Deterministic Control Plane)**
- Owns workflow state machines and timing (cadence)
- Routes events to agents
- Enforces step ordering and idempotency
- Produces canonical “Decision Packets” for audit

**Specialized Intelligence Agents (Non‑executing)**
- **User & Goals Agent**: goal interpretation, timeline, constraints
- **Risk Agent**: risk profiling, risk band, guardrails evaluation
- **Market & Research Agent**: signals, market regime, watchlists
- **Portfolio Construction Agent**: target allocation, instrument selection
- **Rebalance Planner Agent**: trade plan generation, cost/impact estimation
- **Recommendation & Explainability Agent**: plain‑language outputs, UX narratives

**Compliance Control Layer (Authorizer)**
- **Compliance Agent**: validates mandate scope, suitability constraints, and thresholds
- Generates immutable audit artifacts
- Can require human review in future iterations (optional “Human-in-the-Loop” gate)

**Execution Layer (Single Writer Principle)**
- **Execution Agent**: IBKR integration, order placement, status tracking
- **Positions & Ledger Service**: canonical holdings and cash accounting

---

## 9. Compliance Boundary Definition

Nestfolio enforces strict separation between:

- **Advice Generation** (AI reasoning)
- **Decision Authorization** (mandate + guardrails)
- **Trade Execution** (broker integration)

Every executed action must be:
1. Traceable to a mandate
2. Supported by stored reasoning
3. Replayable for audit

All decisions generate immutable audit events.

---

## 10. System State Model (Event Sourcing)

Nestfolio uses **Event Sourcing** as the system-of-record for all user, portfolio, decision, and execution activity.

### Why Event Sourcing
- Deterministic audit replay (regulatory + trust)
- Traceable explainability: explanations are derived from stored inputs and rationale
- Strong idempotency and recovery (avoids double execution)
- Clean separation between immutable history and UI-friendly projections

### Canonical Record
The canonical record is an append-only **Event Store**. All current “state” is derived from projections.

---

## 11. Event Taxonomy (Draft)

### 11.1 User & Mandate Events
- `UserRegistered`
- `OnboardingAnswerRecorded`
- `GoalSet`
- `RiskProfileSet`
- `MandateGranted`
- `MandateUpdated`
- `MandateRevoked`

### 11.2 Portfolio State Events
- `PortfolioSnapshotImported` (from IBKR sync)
- `CashBalanceUpdated`
- `PositionUpdated`
- `CorporateActionApplied`

### 11.3 Decision & Planning Events
- `RebalanceNeedDetected`
- `RecommendationProposed`
- `DecisionPacketCreated`
- `DecisionApproved` / `DecisionBlocked`
- `UserConfirmationRequested`
- `UserConfirmed` / `UserRejected`

### 11.4 Execution Events
- `OrderSubmitted`
- `OrderAccepted`
- `OrderPartiallyFilled`
- `OrderFilled`
- `OrderRejected`
- `OrderCancelled`

### 11.5 Explainability & Reporting Events
- `ExplanationGenerated`
- `UserViewedExplanation`
- `MonthlyReportGenerated`

---

## 12. Decision Packet (Canonical Unit)

A **Decision Packet** is the orchestrator’s canonical artifact for any portfolio-impacting change.
It is immutable once created and is fully auditable.

### 12.1 Decision Packet Contents (Draft Schema)
- **decision_id** (UUID)
- **user_id**
- **trigger** (event references + timestamps)
- **portfolio_context** (projection version + key metrics)
- **mandate_context** (mandate_id, scope, limits)
- **proposed_actions** (one or more action plans)
- **trade_plan** (candidate orders, quantities, constraints)
- **risk_checks** (pre/post risk band, stress checks)
- **cost_checks** (fees, slippage estimate, tax impact estimate if available)
- **explainability_factors** (human-readable factor list)
- **required_authority_level** (L0–L3)
- **compliance_decision** (approved/blocked + reasons)
- **execution_outcome** (filled/rejected + references)

---

## 13. Idempotency & Safety Rules

### 13.1 Single-Writer Execution
Only the **Execution Agent** can submit orders.

### 13.2 Idempotency Keys
- Each Decision Packet has a unique `decision_id`.
- Each order has an `order_key = hash(decision_id, instrument_id, side, quantity, limit_params)`.
- Execution must be idempotent on `order_key` (safe retry).

### 13.3 Dedupe & Replay
- Orchestrator maintains a processed-event checkpoint per stream.
- All agent outputs are referenced by event IDs.
- Replays must recreate the same Decision Packet for the same inputs (within deterministic constraints).

---

## 14. Projections (Read Models)

Projections are materialized views built from the event store:

- **Portfolio Projection**: holdings, cash, performance, drift
- **Goal Projection**: progress vs target, runway
- **Recommendation Projection**: current actionable nudges
- **Explainability Projection**: “why” narratives per action
- **Compliance Projection**: audit views, approvals, blocks

The UI reads only projections; it never writes portfolio state directly.

---

## 15. Decision Lifecycle (Event-Sourced)

1. Trigger event occurs (market, schedule, user change, IBKR sync)
2. Orchestrator routes to analysis agents
3. Agents emit proposals as events
4. Orchestrator composes **Decision Packet**
5. Compliance Agent authorizes (or blocks)
6. If required: request user confirmation
7. Execution Agent submits idempotent orders to IBKR
8. Fills/rejections are recorded as execution events
9. Projections update; user receives simplified explanation

---

## 17. Guardrails as Configurable Operating Modes

Nestfolio supports three configurable operating modes that determine autonomy, thresholds, and user confirmation requirements.

### Mode 1 — Conservative (Trust-First)
Designed for cautious users and early-stage launch.
- Narrow risk bands and drift thresholds
- Smaller max trade sizes
- Less frequent rebalancing
- Strategy changes always require confirmation

### Mode 2 — Balanced (Default)
Designed for most users.
- Moderate risk bands and drift thresholds
- Moderate max trade sizes
- Regular rebalancing cadence
- Some strategy adjustments can be autonomous if within mandate scope

### Mode 3 — Aggressive (Autonomy-First)
Designed for users who explicitly opt in.
- Wider risk bands and drift thresholds
- Larger max trade sizes
- More frequent rebalancing
- Faster adaptation to market regimes (still within suitability constraints)

### Mode Selection & Governance
- The operating mode is selected during onboarding (and can be changed later).
- Mode changes are **Level 2 (User Confirmation Required)**.
- The Compliance Agent validates that the selected mode is compatible with the user’s risk profile and mandate.

### Guardrail Policy Structure (Draft)
Each mode defines a policy bundle:
- **Risk bands**: allowable ranges for key exposures (e.g., equity, duration)
- **Drift thresholds**: when rebalancing is triggered
- **Max turnover**: per rebalance window and per month
- **Max order size**: absolute and portfolio-percentage caps
- **Confirmation thresholds**: triggers that escalate Level 1 → Level 2
- **Cool-down rules**: minimum time between rebalances
- **Circuit breakers**: pause execution under abnormal conditions

---

## 19. Guardrail Parameters (Standard Scope - MVP)

Nestfolio MVP adopts **Standard Guardrails**, balancing autonomy with strong safety guarantees.

### 19.1 Guardrail Dimensions

The following constraints are enforced by the Compliance Agent before execution:

- Asset allocation risk bands
- Drift thresholds
- Maximum trade size
- Rebalance frequency
- Monthly turnover limits
- Volatility & drawdown circuit breakers
- Liquidity constraints
- Concentration limits

---

## 19.2 Baseline Mode Parameters (Initial Defaults)

| Parameter | Conservative | Balanced (Default) | Aggressive |
|---|---|---|---|
| Equity Risk Band | ±3% | ±6% | ±10% |
| Drift Trigger | 2% | 4% | 7% |
| Max Trade Size | 5% portfolio | 10% portfolio | 20% portfolio |
| Rebalance Cadence | Quarterly | Monthly | Bi‑Weekly |
| Monthly Turnover Cap | 10% | 25% | 50% |
| Single ETF Concentration | 20% | 30% | 40% |
| Illiquid Asset Allowed | No | Limited | Allowed (screened) |
| Volatility Pause Trigger | High | Medium | Extreme |
| Drawdown Circuit Breaker | −8% | −12% | −18% |

NOTE: Values are initial product defaults and may evolve following regulatory review and live performance analysis.

---

## 19.3 Level Escalation Rules

Actions automatically escalate from Level 1 → Level 2 when:

- Allocation change exceeds mode risk band
- Trade exceeds max trade size
- Monthly turnover cap would be breached
- Portfolio drawdown exceeds circuit breaker
- Strategy model changes allocation class
- User mandate or risk profile mismatch detected

---

## 19.4 Circuit Breakers

Execution is automatically paused when:

- Market volatility exceeds configured thresholds
- IBKR portfolio sync mismatch detected
- Data feeds unavailable or inconsistent
- Compliance validation fails

Recovery requires:
- Successful resynchronization
- Compliance revalidation
- Or user confirmation (depending on severity)

---

## 21. Portfolio Truth & Reconciliation Model (Dual Truth)

Nestfolio adopts a **Dual Truth Model** aligned with industry best practices.

- The **Event Store** represents *intent truth* (what Nestfolio decided).
- **Interactive Brokers (IBKR)** represents *settlement truth* (what actually exists in custody).

Both sources are continuously reconciled.

---

## 21.1 Truth Domains

### Intent Truth (Nestfolio)
Owned internally via Event Sourcing.
Represents:
- Decisions
- Authorized trade plans
- Submitted orders
- Expected portfolio state

### Settlement Truth (IBKR)
Owned externally by the broker.
Represents:
- Executed trades
- Actual holdings
- Cash balances
- Corporate actions

IBKR settlement truth always prevails for real asset state.

---

## 21.2 Reconciliation Agent

A dedicated **Reconciliation Agent** continuously compares:

- Expected portfolio projection
- IBKR portfolio snapshots

Responsibilities:
- Detect drift between intent and settlement
- Emit reconciliation events
- Trigger safe correction workflows
- Prevent duplicate execution

---

## 21.3 Reconciliation Cadence

- Post‑execution reconciliation (after fills)
- Scheduled reconciliation (e.g., hourly)
- Daily full portfolio reconciliation
- Startup reconciliation after outages

---

## 21.4 Drift Detection

Drift occurs when:

- Position quantity mismatch
- Cash balance mismatch
- Missing or unexpected fills
- Corporate actions not reflected internally

Detected drift emits:
- `PortfolioDriftDetected`
- `ReconciliationRequired`

---

## 21.5 Safe Recovery Flow

1. Execution paused for affected instruments
2. IBKR snapshot imported
3. Internal projections corrected
4. Adjustment events emitted
5. Compliance revalidation executed
6. Normal operation resumes

If reconciliation confidence is low → escalate to Level 2 or human review.

---

## 21.6 Never Double‑Trade Guarantees

Nestfolio prevents duplicate execution via:

- Decision Packet idempotency
- Order keys tied to decision IDs
- Execution confirmation checkpoints
- Reconciliation lock during drift resolution

Orders cannot be resubmitted unless explicitly invalidated by reconciliation events.

---

## 23. Operational Timing Model (Hybrid Cadence)

Nestfolio uses a **Hybrid Cadence** operating model:

- **Event‑Driven Triggers** for responsiveness
- **Scheduled Cycles** for stability, coverage, and compliance routines

---

## 23.1 Event‑Driven Triggers (Examples)

Agents are triggered by events such as:
- Deposit confirmed
- Goal or risk profile change
- Portfolio drift detected
- Order filled / rejected
- Volatility circuit breaker trip
- Data feed outage / recovery

Event triggers typically generate:
- Updated recommendations
- Rebalance evaluation
- Compliance checks
- Reconciliation workflows

---

## 23.2 Scheduled Cycles (Examples)

Scheduled workflows ensure coverage even when no events occur:
- Daily portfolio health check
- Daily IBKR snapshot reconciliation
- Weekly risk review
- Monthly strategic rebalance review
- Monthly report generation

---

## 23.3 Market-Hours Behavior (Draft)

- Execution respects market hours per instrument.
- If a decision is approved outside market hours:
  - Orders are staged and submitted at next valid window.
- Circuit breakers can pause execution regardless of market hours.

---

## 25. IBKR Integration Boundary (Full Trading + Streaming)

Nestfolio integrates with Interactive Brokers (IBKR) using a **full trading + streaming posture**.

Goals:
- Low-latency execution feedback (fills, rejects)
- Near real-time portfolio projections
- Stronger reconciliation through continuous updates

---

## 25.1 Boundary Responsibilities

### Nestfolio Owns
- Mandate, guardrails, suitability logic
- Decision Packets and audit trail
- Order intent generation and idempotency keys
- Execution authorization (Compliance Agent)
- Reconciliation logic and drift resolution
- User-facing explanations and reports

### IBKR Owns
- Custody and settlement truth
- Order routing and exchange connectivity
- Execution outcomes (fills, partial fills, rejects)
- Account/position balances as broker-of-record

---

## 25.2 Integration Surfaces (Conceptual)

- **Authentication & Session Management**
- **Order APIs**: submit / modify / cancel
- **Streaming Feeds**:
  - Order status updates
  - Execution reports / fills
  - Account and position updates
  - Market data subscriptions (where applicable)

(Exact endpoints/protocols are implementation details but must support streaming semantics and reconnection.)

---

## 25.3 Order Lifecycle Mapping (Nestfolio ↔ IBKR)

Nestfolio Order States (internal):
- `Draft` → `Authorized` → `Submitted` → `Acknowledged` → `PartiallyFilled` → `Filled` OR `Rejected` OR `Cancelled`

IBKR Events are mapped into internal events:
- `OrderSubmitted` / `OrderAccepted` / `OrderPartiallyFilled` / `OrderFilled` / `OrderRejected` / `OrderCancelled`

All mapping events are appended to the Event Store and drive projections.

---

## 25.4 Streaming Reliability & Recovery

### Connection Strategy
- Persistent streaming connections per account context
- Heartbeats to detect stale streams
- Automatic reconnection with backoff

### Catch-Up on Reconnect
- On reconnect, perform:
  1. Snapshot import (`PortfolioSnapshotImported`)
  2. Stream resubscription
  3. Reconciliation pass

---

## 25.5 Error Taxonomy (Execution & Streaming)

### Retriable Errors
- Network timeouts / transient connectivity
- 5xx broker/service errors
- Rate limiting
- Temporary market data subscription failures

Handling:
- Exponential backoff with jitter
- Idempotent order submission using `order_key`
- Retry budgets per decision packet

### Terminal Errors
- Insufficient funds / margin
- Invalid instrument / contract
- Permission/authorization failures
- Compliance guardrail violations

Handling:
- Emit terminal error events
- Escalate to Level 2 (user notification)
- Require reconciliation and/or user action

---

## 25.6 Safety Constraints for Streaming Execution

- **Single Writer**: only Execution Agent can submit/modify/cancel orders.
- **Idempotent Submit**: no resubmission without explicit reconciliation invalidation.
- **Reconciliation Lock**: when drift is detected, execution pauses for impacted instruments.
- **Circuit Breakers**: can pause all execution regardless of stream state.

---

## 27. Decision Windows & Execution Policy (Immediate Execution)

Nestfolio adopts an **Immediate Execution Policy** for MVP.

Approved decisions are executed as soon as possible when:
- Compliance authorization is granted
- Guardrails are satisfied
- Market venue is open for the instrument

This maximizes responsiveness while remaining bounded by safety mechanisms.

---

## 27.1 Market Hours & Order Staging

- If market is **open** → order submitted immediately.
- If market is **closed** → order enters `Staged` state and is submitted at the next valid trading window.
- Staged orders are revalidated by Compliance before submission.

---

## 27.2 Cool‑Down & Anti‑Thrashing Rules

To prevent excessive trading caused by noisy signals:

- Minimum cool‑down enforced per instrument after execution.
- New decisions affecting the same instrument are blocked during cool‑down unless:
  - Circuit breaker triggered, or
  - User action requires override (Level 2).

### Default Cool‑Down by Mode
| Mode | Instrument Cool‑Down |
|---|---|
| Conservative | 10 trading days |
| Balanced | 5 trading days |
| Aggressive | 2 trading days |

---

## 27.3 Immediate Execution Safety Checks

Before submission, Execution Agent verifies:
- No active reconciliation lock
- No pending conflicting staged order
- Turnover limits respected
- Market liquidity checks pass

Failure of any check converts execution into a Level 2 escalation or postponement event.

---

## 27.4 Escalation Conditions (Timing Related)

Execution escalates to Level 2 when:
- Market liquidity is degraded
- Volatility circuit breaker active
- Order would execute during abnormal market conditions
- Multiple rapid decisions detected within cool‑down window

---

## 29. User Communication & Notification Model (Configurable Hybrid)

Nestfolio adopts a **Contextual Hybrid Communication Model** with strong user configurability.

### Default Behavior
- **Level 1 (Autonomous)** → Post‑execution explanation
- **Level 2 (Confirmation Required)** → Pre‑execution confirmation
- **High‑Impact Level 1** → Soft pre‑notice when feasible (non‑blocking)

---

## 29.1 Notification Timing Modes (User‑Configurable)

Users may override default timing preferences within safe bounds:

- **Post‑Fact Mode**: notify after execution
- **Pre‑Intent Mode**: notify before execution with optional cancel window
- **Hybrid (Default)**: system‑chosen timing based on impact level

Compliance Agent ensures overrides cannot bypass mandate or safety rules.

---

## 29.2 Notification Severity Tiers

| Tier | Example | Timing |
|---|---|---|
| Informational | Monthly update, minor rebalance | Post‑fact |
| Advisory | Recommendation available | Pre or Post |
| Impactful | Large rebalance within guardrails | Soft pre‑notice |
| Confirmable | Strategy/risk change | Pre‑execution confirmation |
| Critical | Circuit breaker, execution pause | Immediate alert |

---

## 29.3 Messaging Lifecycle

1. Decision Packet created
2. Impact classification computed
3. Notification policy resolved (default + user overrides)
4. Message generated by Recommendation & Explainability Agent
5. Delivery via configured channels
6. User interaction events appended to Event Store

---

## 29.4 Channels (MVP)

- In‑app notifications
- Email summaries
- Push notifications (mobile)

All communications are linked to Decision Packet IDs for traceability.

---

## 29.5 Trust Reinforcement Principles

- Plain‑language explanations
- Positive framing (“No action needed — we handled this”)
- Easy access to "Why" explanations
- Clear indication when user action is required

---

## 31. AI Reasoning Persistence Model (Dual Layer)

Nestfolio adopts a **Dual Layer Reasoning Model**:
- Preserve auditable *decision intent* at execution time.
- Allow safe regeneration of richer explanations later.

---

## 31.1 Stored Artifacts (at Decision Time)

For each Decision Packet, the system persists:
- **Reasoning Factors** (structured, non‑CoT)
- **Feature Snapshot** (key inputs used for decision)
- **Model Metadata** (model id, version, policy set)
- **Prompt/Policy Hash** (immutable reference)
- **Decision Hash** (deterministic integrity check)

Example Reasoning Factors:
- Equity drift exceeded risk band
- Portfolio volatility within mandate
- Goal horizon: long-term
- Expected risk-adjusted improvement
- Turnover within mode limits

---

## 31.2 Explanation Generation

### Default (Deterministic)
- Explanations reconstructed directly from stored factors.
- Instant, replayable, audit-safe.

### Enhanced (Adaptive)
- LLM generates natural-language explanation using stored factors as bounded context.
- Cannot introduce facts outside recorded factors.

---

## 31.3 Audit & Reproducibility Guarantees

- Decisions are reproducible from stored feature snapshots and policy hashes.
- Explanations remain consistent over time.
- Model upgrades do not alter historical intent.
- All explanation views reference the originating `decision_id`.

---

## 31.4 Governance Constraints

- Raw chain-of-thought is **not stored**.
- PII minimized within reasoning factors.
- Regeneration is constrained to Decision Packet context.
- Compliance Agent validates reasoning completeness before execution.

---

## 33. AI Model Governance & Promotion Pipeline

Nestfolio adopts a **Governed Model Promotion Pipeline** aligned with institutional financial system practices.

AI model changes are treated as controlled operational events.

---

## 33.1 Model Lifecycle Stages

### Stage 1 — Offline Evaluation
- Candidate models evaluated on historical market and portfolio datasets.
- Metrics evaluated:
  - Risk compliance
  - Portfolio stability
  - Turnover impact
  - Decision consistency
  - Guardrail adherence

No production exposure.

---

### Stage 2 — Shadow Mode
- Candidate model runs in parallel with production model.
- Generates Decision Packets marked as `shadow`.
- No execution allowed.
- Differences analyzed:
  - Allocation deviation
  - Trade frequency
  - Risk exposure

Shadow decisions are stored for comparison and audit.

---

### Stage 3 — Limited Rollout
- Model enabled for a controlled subset of users or portfolios.
- Compliance monitoring intensified.
- Circuit breakers tightened.

Automatic rollback available.

---

### Stage 4 — Promotion
- Model promoted to production after approval.
- Promotion recorded as immutable governance event.
- Model version becomes eligible for Decision Packets.

---

## 33.2 Model Registry

All models are registered with:
- model_id
- version
- training data reference
- evaluation results
- approval timestamp
- approver identity (human or governance process)

Decision Packets reference model metadata for reproducibility.

---

## 33.3 Safety & Rollback

- Previous production model retained for rollback.
- Rollback emits `ModelRollbackTriggered` event.
- Active executions paused during rollback if required.

---

## 33.4 Governance Principles

- Model upgrades must not alter historical decisions.
- Explainability compatibility required before promotion.
- Guardrail compliance validated pre‑promotion.
- Human approval required for promotion (MVP).

---

## 35. Agent Runtime Model (Serverless via Amazon AgentCore)

Nestfolio adopts a **Serverless / Event‑Activated Agent Runtime** powered by **Amazon AgentCore**.

Agents are instantiated on-demand in response to events emitted by the Event Store or orchestrator workflows.

---

## 35.1 Runtime Principles

- Agents are **stateless** across invocations.
- All durable context is sourced from the Event Store and projections.
- Agent execution is deterministic given:
  - Event inputs
  - Feature snapshots
  - Model & policy versions

This aligns with Nestfolio’s event‑sourced architecture and audit requirements.

---

## 35.2 Responsibilities by Runtime Type

### Event‑Activated Agents (AgentCore)
- Advisory reasoning
- Risk evaluation
- Portfolio construction
- Rebalance planning
- Recommendation generation
- Explainability synthesis

Characteristics:
- Short‑lived execution
- Horizontally scalable
- Idempotent processing per event

### Persistent Control Services
Remain continuously available:
- Orchestrator (workflow/state machine owner)
- Execution Agent (single writer to IBKR)
- Reconciliation Agent
- Projection builders

---

## 35.3 Invocation Lifecycle

1. Event appended to Event Store
2. Orchestrator emits Agent Invocation
3. AgentCore executes agent with bounded context
4. Agent emits result events
5. Results appended to Event Store
6. Projections update

All invocations reference a `decision_id` or `event_id`.

---

## 35.4 Concurrency & Idempotency

- Each event processed exactly-once logically (at-least-once physically).
- Agents must be idempotent.
- Duplicate invocations deduped via event checkpoints and decision hashes.

---

## 35.5 Failure Isolation

- Agent failures do not impact orchestrator availability.
- Failed invocations emit `AgentExecutionFailed` events.
- Automatic retry with exponential backoff and jitter.
- Retry budgets enforced per Decision Packet.

---

## 35.6 Cost & Scaling Characteristics

- Compute scales with decision activity, not user count.
- Idle portfolios incur near-zero reasoning cost.
- Heavy market events scale horizontally without pre-provisioning.

---

## 37. Agent Memory Model (Structured Retrieval Context)

Nestfolio adopts a **Structured Retrieval Context Model** for all AgentCore invocations.

Agents do not independently query system state. Instead, the Orchestrator prepares a curated **Context Bundle** containing all required inputs.

---

## 37.1 Context Bundle Principles

- Deterministic inputs per invocation
- Minimal necessary information
- Audit‑replay compatibility
- Token and cost efficiency

Agents must treat the Context Bundle as the authoritative working memory.

---

## 37.2 Context Bundle Contents (Draft)

Each invocation receives:
- triggering_event
- decision_id (if applicable)
- portfolio_projection_snapshot
- mandate_context
- guardrail_policy (mode-derived)
- relevant market signals
- prior decision references (bounded window)
- feature snapshot
- model & policy versions

Bundles are immutable once generated.

---

## 37.3 Retrieval Responsibilities

### Orchestrator
- Builds Context Bundle
- Performs projection queries
- Applies retrieval limits
- Ensures determinism

### Agents
- Consume provided bundle
- Produce outputs/events only
- Do not access persistent storage directly

---

## 37.4 Cost & Token Containment

- Context window bounded per agent type.
- Historical references limited to relevance windows.
- Large historical data accessed via summarized projections.

This prevents inference cost growth with account age.

---

## 37.5 Audit & Reproducibility

- Context Bundle hash stored in Decision Packet.
- Replaying the same bundle must reproduce equivalent reasoning factors.
- Enables deterministic audit replay.

---

## 39. Observability & Operational Monitoring (Institutional Grade)

Nestfolio adopts **Institutional Observability**, extending beyond infrastructure monitoring to include AI behavior, financial safety, and decision quality.

---

## 39.1 Observability Layers

### Infrastructure Layer
- Agent invocation latency
- Error rates
- Streaming connection health
- Queue depth and throughput
- Service availability

---

### Operational AI Layer
- Agent success/failure rates
- Decision throughput
- Execution latency
- Retry and backoff frequency
- Context bundle size trends

---

### Financial Safety Layer
- Portfolio drift frequency
- Reconciliation mismatch rate
- Order rejection ratio
- Circuit breaker activations
- Turnover pressure indicators

---

### Decision Quality Layer
- Guardrail proximity metrics
- Strategy deviation monitoring
- Allocation volatility
- Trade clustering detection
- Model divergence vs shadow models

---

## 39.2 AI Health Indicators

Derived metrics include:
- Decision Stability Index
- Guardrail Pressure Index
- Reconciliation Confidence Score
- Model Agreement Score (production vs shadow)

Threshold breaches emit operational alerts.

---

## 39.3 Monitoring Dashboards

Separate visibility planes:

- **Operations Dashboard**: system health and performance
- **Compliance Dashboard**: audit events and mandate adherence
- **AI Governance Dashboard**: model performance and divergence

---

## 39.4 Automated Safety Responses

System may automatically:
- Pause execution for affected portfolios
- Tighten guardrails temporarily
- Escalate to human review
- Trigger reconciliation workflows

All automated actions are event‑logged.

---

## 39.5 Incident Classes

| Class | Example |
|---|---|
| Infra Incident | Stream disconnect |
| Agent Incident | Repeated execution failure |
| Financial Incident | Drift mismatch |
| Model Incident | Shadow divergence |
| Compliance Incident | Guardrail violation |

Each incident produces immutable incident events.

---

## 41. Security & Data Isolation Model (Tenant Isolation)

Nestfolio adopts a **Tenant Isolation** security model.

Core concept:
- Every request and every backend action is scoped to a **tenant_id**.
- `tenant_id` is carried in the user JWT as a custom claim.
- All storage and processing paths enforce tenant partition constraints.

---

## 41.1 Identity & Authorization

### User Identity
- Users authenticate and receive a JWT.
- JWT includes a custom claim: `tenant_id`.

### Service Authorization
- Services and agents extract `tenant_id` and apply it as a required scope.
- Authorization checks occur at:
  - API boundary
  - Orchestrator workflows
  - Event store append/read paths
  - Projection reads

---

## 41.2 Resource Partitioning

Tenant isolation is enforced via partitioning of:
- Event streams
- Projection stores
- Order/decision artifacts
- Notification and messaging records

All resource keys include (or map to) `tenant_id`.

---

## 41.3 IAM ABAC & Dynamic Policies

Nestfolio uses **IAM Attribute-Based Access Control (ABAC)** to constrain access to tenant partitions.

- Principal/session attributes include `tenant_id`.
- Resource tags include `tenant_id`.
- Dynamic policies enforce:
  - Principal `tenant_id` must match Resource `tenant_id`
  - Agents/services only access permitted partitions

This applies to both user-initiated and system-initiated workflows.

---

## 41.4 Agent & Service Scoping

- AgentCore invocations include `tenant_id` in the Context Bundle.
- Orchestrator enforces tenant-scoped routing.
- Execution and Reconciliation operate tenant-scoped; no cross-tenant operations.

---

## 41.5 Audit Integrity (Tenant Scoped)

- All Decision Packets, Context Bundles, and audit events are stored with `tenant_id`.
- Audit queries are tenant-scoped by default.

---

## 42. Secrets Handling & IBKR Credential Isolation (Delegated Tokens)

Nestfolio adopts a **User‑Delegated Authorization Model** for Interactive Brokers (IBKR) access.

Goal:
- Minimize custody of long‑lived broker credentials
- Maintain per‑tenant isolation
- Enable automated trading within user‑granted scopes

---

## 42.1 Delegated Authorization Flow

1. User connects IBKR account via secure authorization flow.
2. IBKR issues delegated access artifacts (access/refresh tokens or equivalent).
3. Nestfolio stores only the delegated artifacts required for automation.
4. Tokens are exchanged for short‑lived runtime credentials when execution is needed.

All authorization artifacts are scoped to `tenant_id`.

---

## 42.2 Storage & Isolation

- Delegated tokens stored in a managed secrets vault.
- Secrets are partitioned by `tenant_id`.
- Access controlled via IAM ABAC policies:
  - Principal `tenant_id` must match Secret `tenant_id`.

No shared credentials across tenants.

---

## 42.3 Runtime Access Pattern

- Execution Agent requests short‑lived broker session using delegated artifact.
- Temporary credentials injected at runtime only.
- Credentials never persisted in logs, events, or Context Bundles.

Agents other than the Execution Agent cannot access broker secrets.

---

## 42.4 Rotation & Revocation

- Token refresh handled automatically where supported.
- User may revoke authorization at any time.
- Revocation emits `BrokerAuthorizationRevoked` event and pauses execution.
- Reauthorization required before resuming autonomous actions.

---

## 42.5 Break‑Glass Controls

- Emergency disable per tenant without accessing secrets.
- Global broker integration pause supported via circuit breaker.

---

## 44. Cost Control Strategy for AI Inference (Adaptive Scaling)

Nestfolio adopts an **Adaptive Intelligence Scaling** strategy to control inference costs during volatility and growth.

---

## 44.1 Budgeting

Budgets exist at two levels:
- **Global Budget**: overall platform inference ceiling
- **Tenant Budget**: per-tenant rate and spend limits

Budget events:
- `TenantBudgetApproaching`
- `TenantBudgetExceeded`
- `GlobalBudgetApproaching`
- `GlobalBudgetExceeded`

---

## 44.2 Reasoning Tiers

Agents can operate in tiers:

- **Tier 0 (Minimal)**: rule-based checks + deterministic projections only
- **Tier 1 (Standard)**: normal agent reasoning using full Context Bundle
- **Tier 2 (Deep)**: expanded analysis, richer market context, scenario evaluation

Tier selection is dynamic based on:
- operating mode (Conservative/Balanced/Aggressive)
- budget health
- volatility conditions
- incident state (circuit breakers)

---

## 44.3 Model Tier Switching

- Use smaller/cheaper models for Tier 0–1 reasoning where possible.
- Use larger models for Tier 2 only when justified.
- Explainability generation can be downgraded to deterministic factor-based output under load.

---

## 44.4 Throttling & Debounce Under Volatility

To prevent cost spikes:
- Debounce market-driven triggers
- Merge duplicate trigger events within time windows
- Enforce per-tenant invocation rate limits

---

## 44.5 Degraded Mode Behaviors

When budgets are exceeded:
- Pause non-critical analysis
- Continue reconciliation and safety checks
- Provide minimal user explanations
- Escalate critical events only

All degradations are event-logged for audit.

---

## 46. Human‑in‑the‑Loop Operational Roles (Full Fintech Ops)

Nestfolio defines a **Full Fintech Operational Role Model** for MVP to ensure safe oversight of autonomous systems.

---

## 46.1 Operational Roles

### Platform Operator
Responsibilities:
- Monitor system health dashboards
- Pause/resume execution globally or per tenant
- Trigger reconciliation workflows
- Respond to infrastructure or agent incidents

Scope:
- System-level visibility
- No access to broker credentials

---

### Compliance Reviewer
Responsibilities:
- Review audit trails and Decision Packets
- Approve or block escalated decisions
- Sign off incident resolution
- Validate mandate and guardrail adherence

Scope:
- Read access to tenant decision history
- Approval authority for compliance escalations

---

### Customer Support (Tenant‑Scoped)
Responsibilities:
- Assist users with account questions
- View portfolio projections and explanations
- Trigger safe workflows (e.g., resend notifications)

Constraints:
- Read-only access
- Strict tenant scoping enforced via ABAC
- No execution or mandate modification authority

---

### AI Governance Reviewer
Responsibilities:
- Approve model promotion
- Review shadow-mode divergence reports
- Authorize rollback when required

Scope:
- Access to AI governance dashboards
- No direct portfolio execution authority

---

## 46.2 Authorization Model

- Roles mapped to IAM identities.
- Access controlled using ABAC with role and `tenant_id` attributes.
- All privileged actions require authenticated identity.

---

## 46.3 Internal Action Auditing

All internal actions emit immutable audit events:
- `OperatorActionPerformed`
- `ComplianceApprovalGranted`
- `ModelPromotionApproved`
- `ExecutionPaused`

Audit events include actor identity and timestamp.

---

## 48. Incident Response & Recovery Model (Autonomous Safety + Human Oversight)

Nestfolio adopts an **Autonomous Containment with Human Oversight** incident response philosophy.

Goal:
- Contain financial or operational risk immediately
- Stabilize system automatically
- Enable human investigation and controlled recovery

---

## 48.1 Incident Lifecycle

1. Detection (observability signal or rule trigger)
2. Classification (incident class assignment)
3. Automatic containment
4. Stabilization workflows
5. Human review
6. Controlled recovery
7. Post‑incident audit and learning

All phases emit immutable incident events.

---

## 48.2 Automatic Containment Actions

Depending on incident class, system may automatically:
- Pause execution globally or per tenant
- Activate reconciliation lock
- Tighten guardrails
- Disable affected agents
- Freeze model promotion pipeline

Containment actions are reversible only after review.

---

## 48.3 Stabilization Workflows

Examples:
- Broker outage → switch to monitoring-only mode
- Reconciliation failure → snapshot import + projection rebuild
- Model anomaly → revert to previous approved model
- Streaming failure → reconnect + catch-up reconciliation

---

## 48.4 Human Oversight & Recovery

Platform Operator or Compliance Reviewer must:
- Review incident diagnostics
- Approve execution resumption
- Confirm guardrail restoration

Recovery emits `ExecutionResumed` or equivalent events.

---

## 48.5 Incident Severity Levels

| Level | Example | Automatic Action |
|---|---|---|
| SEV‑1 | Market data disruption | Agent retry |
| SEV‑2 | Broker streaming loss | Execution pause |
| SEV‑3 | Portfolio drift mismatch | Reconciliation lock |
| SEV‑4 | Model anomaly | Model rollback |
| SEV‑5 | Systemic risk | Global execution freeze |

---

## 50. Production Readiness & Launch Controls (Controlled Flight Phases)

Nestfolio adopts a **Controlled Flight Phase** launch strategy inspired by safety‑critical system deployment models.

Goal:
- Gradually increase autonomy and capital exposure
- Validate system behavior under real conditions
- Maintain reversible risk at every phase

---

## 50.1 Flight Phases

### Phase 0 — Internal Simulation
- Historical replay testing
- Shadow decision evaluation
- No real capital exposure

Entry Criteria:
- Model stability confirmed
- Guardrail adherence validated

---

### Phase 1 — Sandbox Capital
- Test portfolios with controlled capital
- Execution enabled with strict limits
- Aggressive monitoring enabled

Constraints:
- Conservative mode only
- Tight turnover limits
- Automatic execution pauses on anomalies

---

### Phase 2 — Limited User Beta
- Small cohort of real users
- Hybrid autonomy enabled
- Enhanced human oversight

Controls:
- Per‑tenant capital limits
- Mandatory pre‑notice notifications
- Increased reconciliation cadence

---

### Phase 3 — Controlled Production
- Broader user onboarding
- Balanced mode default
- Standard monitoring

Restrictions:
- Gradual increase of exposure caps
- Continuous shadow model comparison

---

### Phase 4 — Full Production
- Full operating modes available
- Normal guardrails active
- Governance and monitoring remain mandatory

---

## 50.2 Autonomy Unlock Criteria

Advancement between phases requires:
- Incident rates below thresholds
- Stable reconciliation metrics
- Model agreement scores within limits
- Compliance approval

---

## 50.3 Capital Exposure Limits

Exposure caps enforced per phase:
- Per tenant
- Global AUM
- Strategy category

Caps configurable and enforced by Compliance Agent.

---

## 50.4 Kill‑Switch Governance

Immediate suspension possible via:
- Platform Operator
- Compliance Reviewer
- Automated SEV‑5 containment

Kill‑switch emits global execution freeze events.

---

## 52. Data Retention & Deletion Policy (Layered Retention)

Nestfolio adopts a **Layered Retention Model** to balance GDPR rights with financial audit requirements.

---

## 52.1 Data Classification

Data is separated into distinct domains:

- **PII Layer**: user identity, contact information, authentication artifacts
- **Operational Layer**: preferences, onboarding responses, UI interactions
- **Financial & Audit Layer**: decisions, trades, reconciliation, compliance events

---

## 52.2 Retention Principles

- Personal data must be deletable upon verified user request.
- Financial and audit records must remain retained for regulatory obligations.
- Historical decisions remain reproducible without retaining direct identity linkage.

---

## 52.3 Anonymization Strategy

Upon deletion request:

1. PII records removed from Identity Store.
2. Tenant linkage replaced with irreversible pseudonymous identifier.
3. Event Store retains financial history without personal attribution.
4. Audit trail remains valid but anonymized.

This enables audit replay while honoring GDPR erasure requirements.

---

## 52.4 Deletion Workflow

Deletion emits events:
- `UserDeletionRequested`
- `PIIRemoved`
- `TenantAnonymized`

Execution authority and broker connectivity are revoked immediately.

---

## 52.5 Retention Periods (Draft)

| Data Type | Retention |
|---|---|
| PII | Until deletion request |
| Operational Data | 5 years |
| Financial & Audit Events | 10+ years (regulatory) |

Retention durations configurable per jurisdiction.

---

## 53. Next Iteration Targets
- Define Regulatory compliance mapping (EU/Italy scope)
- Define Business Continuity & Disaster Recovery model
- Define Operational Runbooks & Playbooks
- Define External Audit & Certification readiness
- Define Long‑Term Platform Evolution roadmap

