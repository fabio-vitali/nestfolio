> **Status: RECOVERY IN PROGRESS — content is the verbatim 2026-03-24 baseline (commit `fa15bbfd~1`). Phase C of the implementation plan expands this to current 33-service code. Until expansion lands, treat this file as historical context, not as a current reference.**

# Service Inventory

Complete listing of all Nestfolio services organized by domain, including responsibilities, event contracts, state ownership, and hosted AI agents. For definitions of service roles (BFF, CTRL, ADPT, Event Hub), see [Event-Driven Architecture](../03-event-driven-architecture.md).

> [Back to Index](../../README.md) | [Section Overview](./README.md)

---

## Inventory Summary

| # | Service | Domain | Type | Actor Served | Has Microfrontend |
|---|---|---|---|---|---|
| 1 | `investor-hub` | Investor | Event Hub | -- | No |
| 2 | `investor-web` | Investor | Web | Investor (auth) | Yes |
| 3 | `investor-bff` | Investor | BFF | Investor | Yes |
| 4 | `investor-ctrl` | Investor | CTRL | -- | No |
| 5 | `advisory-hub` | Advisory | Event Hub | -- | No |
| 6 | `advisory-ctrl` | Advisory | CTRL | -- | No |
| 7 | `compliance-ctrl` | Advisory | CTRL | -- | No |
| 8 | `operations-ctrl` | Advisory | CTRL | -- | No |
| 9 | `advisory-bff` | Advisory | BFF | Investor + Operator + Reviewer | Yes |
| 10 | `execution-hub` | Execution | Event Hub | -- | No |
| 11 | `execution-ctrl` | Execution | CTRL | -- | No |
| 12 | `execution-adpt` | Execution | ADPT | -- | No |
| 13 | `portfolio-bff` | Execution | BFF | Investor | Yes |
| 14 | `portfolio-ctrl` | Execution | CTRL | -- | No |

**Total: 14 services** (3 Event Hubs, 3 BFFs, 6 CTRLs, 1 ADPT, 1 Web) + 2 frontend host applications.

| Domain | Services | Count |
|---|---|---|
| Investor | investor-hub, investor-web, investor-bff, investor-ctrl | 4 |
| Advisory | advisory-hub, advisory-ctrl, compliance-ctrl, operations-ctrl, advisory-bff | 5 |
| Execution | execution-hub, execution-ctrl, execution-adpt, portfolio-bff, portfolio-ctrl | 5 |

---

## Investor Domain

### investor-hub

**Type**: Event Hub

Owns the Investor domain EventBridge bus, cross-domain forwarding rules, and event archive. Merges the event infrastructure of the former identity-hub, investor-hub, and notification-hub.

**Cross-domain forwarding rules (outbound)**:

| Target | Events |
|---|---|
| advisory-hub | `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED`, `ACCOUNT_MODE_SET` |
| execution-hub | `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED`, `ACCOUNT_MODE_SET`, `GO_LIVE_REQUESTED` |

---

### investor-web

**Type**: Web

Cognito User Pool (Google/Facebook federation), CloudFront distribution, Route53 hosted zone. Lambda triggers on PostAuthentication/PostConfirmation publish auth events. Serves the landing/marketing page and auth UI.

No BFF needed -- auth features are served by Cognito hosted UI and the landing page is static.

**External dependency**: Amazon Cognito (embedded, not a separate ADPT).

**Events published**: `USER_REGISTERED`, `USER_AUTHENTICATED`, `USER_SESSION_EXPIRED`, `USER_DELETION_REQUESTED`, `PII_REMOVED`, `TENANT_ANONYMIZED`

**Microfrontends**: Landing/marketing page, sign-up/sign-in (Cognito hosted UI).

---

### investor-bff

**Type**: BFF
**Actor**: Investor

Owns the InvestorProfile aggregate (event-sourced: goals, risk profile, mandate, operating mode, account_mode, onboarding answers, deposit intents, withdrawal requests) and the NotificationInbox projection (materialized from `investor-ctrl` events). Absorbs the former notification-bff inbox features.

**Feature set**: Onboarding conversation, profile/goal/risk/mandate management, operating mode selection, account mode selection (SIMULATION/LIVE), simulation-to-live transition flow, deposit initiation, withdrawal requests, account closure, notification inbox, unread count, mark-as-read, real-time notification push, notification preferences.

**API**: AppSync GraphQL -- onboarding mutations, profile queries, goal CRUD, mandate management, setAccountMode mutation, requestGoLive mutation, account mode query, deposit/withdrawal, closure, notification inbox queries, mark-as-read mutations, real-time notification subscriptions.

**AI agents**: Conversational AgentCore instances of **User & Goals Agent** (onboarding goal dialogue, goal refinement) and **Risk Agent** (risk questionnaire evaluation).

**Knowledge Base**: Bedrock KB (vector + graph) fed by investor domain events -- user intent history, goal context, risk preference patterns.

**Events published**: `ONBOARDING_ANSWER_RECORDED`, `ONBOARDING_COMPLETED`, `GOAL_SET`, `GOAL_UPDATED`, `RISK_PROFILE_SET`, `RISK_PROFILE_UPDATED`, `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED`, `OPERATING_MODE_SELECTED`, `OPERATING_MODE_CHANGED`, `ACCOUNT_MODE_SET`, `GO_LIVE_REQUESTED`, `GO_LIVE_COMPLETED`, `DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED`, `ACCOUNT_CLOSED`, `BROKER_AUTHORIZATION_REVOKED`, `NOTIFICATION_READ`

**Events consumed (intra-domain)**: `USER_REGISTERED` (from investor-web), `NOTIFICATION_CREATED` (from investor-ctrl)

**Events consumed (cross-domain from execution-hub)**: `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`

**Microfrontends**: Onboarding Conversation, Settings & Profile, Deposit Flow, Withdrawal Flow, Account Closure & Deletion, How Nestfolio Works (partial), Activity & Notifications, Dashboard -- Recent Activity (partial).

---

### investor-ctrl

**Type**: CTRL

Notification pipeline via Step Functions -- impact classification, policy resolution, template selection, channel routing, delivery. Implements 5 severity tiers (Informational, Advisory, Impactful, Confirmable, Critical) and 3 timing modes (Post-Fact, Pre-Intent, Hybrid).

**State**: DynamoDB table (Notification records, NotificationPolicy, user channel preferences).

**Events published**: `NOTIFICATION_CREATED`, `NOTIFICATION_SENT`, `NOTIFICATION_DELIVERED`, `MONTHLY_REPORT_GENERATED`

**Events consumed (intra-domain)**: `DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED`, `GO_LIVE_COMPLETED` (from investor-bff)

**Events consumed (cross-domain from advisory-hub)**: `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED`

**Events consumed (cross-domain from execution-hub)**: `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_STAGED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `CORPORATE_ACTION_APPLIED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED`, `VIRTUAL_DEPOSIT_CREDITED`, `VIRTUAL_WITHDRAWAL_DEBITED`

Simulation-specific notification templates are included for virtual deposit confirmation and go-live completion events. Template selection uses the account mode context from the triggering event to render simulation-appropriate copy.

---

## Advisory Domain

### advisory-hub

**Type**: Event Hub

Owns the Advisory domain EventBridge bus, cross-domain forwarding rules, and event archive. Merges the event infrastructure of the former advisory-hub, compliance-hub, and operations-hub.

**Cross-domain forwarding rules (outbound)**:

| Target | Events |
|---|---|
| investor-hub | `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED` |
| execution-hub | `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET` |

---

### advisory-ctrl

**Type**: CTRL

Decision lifecycle orchestration via Step Functions state machine -- trigger detection, context assembly, 6-agent invocation sequence, Decision Packet composition, compliance handoff, user confirmation, execution handoff. Pattern: Orchestration + SAGA with compensating actions on compliance block or user rejection.

**AI agents**: Async AgentCore instances of all 6 agents: User & Goals, Risk, Market & Research, Portfolio Construction, Rebalance Planner, Recommendation & Explainability.

**Decision lifecycle invocation sequence**:

| Step | Agent | Output Event |
|---|---|---|
| 1 | User & Goals Agent | `GOAL_INTERPRETATION_PRODUCED` |
| 2 | Risk Agent | `RISK_EVALUATION_PRODUCED` |
| 3 | Market & Research Agent | `MARKET_SIGNAL_DETECTED` |
| 4 | Portfolio Construction Agent | `PORTFOLIO_CONSTRUCTION_PROPOSED` |
| 5 | Rebalance Planner Agent | `REBALANCE_PLAN_PRODUCED` |
| 6 | Recommendation & Explainability Agent | `RECOMMENDATION_PROPOSED`, `EXPLANATION_GENERATED` |

Steps 1-2 may be skipped if the trigger is not goal/risk related and cached interpretations are current.

**Knowledge Base**: Bedrock KB fed by cross-domain trigger events -- decision history, market context, portfolio states, reasoning precedents. Market & Research Agent may additionally use an MCP server for real-time market data.

**State**: DynamoDB table (AgentInvocation records, reasoning outputs, DecisionPacket, Workflow state).

**Events published**: `AGENT_INVOCATION_STARTED`, `AGENT_INVOCATION_COMPLETED`, `AGENT_EXECUTION_FAILED`, `GOAL_INTERPRETATION_PRODUCED`, `RISK_EVALUATION_PRODUCED`, `MARKET_SIGNAL_DETECTED`, `PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`, `RECOMMENDATION_PROPOSED`, `EXPLANATION_GENERATED`, `DECISION_PACKET_CREATED`, `DECISION_PACKET_ENRICHED`, `USER_CONFIRMATION_REQUESTED`, `USER_CONFIRMED`, `USER_REJECTED`

**Events consumed (intra-domain)**: `DECISION_APPROVED`, `DECISION_BLOCKED` (from compliance-ctrl)

**Events consumed (cross-domain from investor-hub)**: `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`

**Events consumed (cross-domain from execution-hub)**: `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `PORTFOLIO_DRIFT_DETECTED`

---

### compliance-ctrl

**Type**: CTRL (separate deployable unit per regulatory requirements)

Compliance check pipeline via Step Functions -- mandate validation, guardrail evaluation, suitability check, authority level determination, approve/block.

**State**: DynamoDB table (ComplianceCheck, GuardrailPolicy, AuditArtifact). Guardrail policies are materialized from investor domain events.

**Events published**: `DECISION_APPROVED`, `DECISION_BLOCKED`, `GUARDRAIL_VIOLATION_DETECTED`, `ESCALATION_TRIGGERED`, `COMPLIANCE_APPROVAL_GRANTED`, `AUDIT_ARTIFACT_CREATED`, `SUITABILITY_CHECK_PASSED`, `SUITABILITY_CHECK_FAILED`

**Events consumed (intra-domain)**: `DECISION_PACKET_CREATED`, `DECISION_PACKET_ENRICHED` (from advisory-ctrl)

**Events consumed (cross-domain from investor-hub)**: `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED`, `OPERATING_MODE_CHANGED`

---

### operations-ctrl

**Type**: CTRL

Three independent Step Functions workflows:

1. **Incident lifecycle**: Detection, classification (SEV-1 through SEV-5), automatic containment, stabilization, escalation, human review gate, controlled recovery.
2. **Model promotion pipeline**: Offline evaluation, shadow mode, limited rollout, approval gate, production promotion.
3. **Cost governance**: Budget monitoring, reasoning tier adjustment, throttling.

**State**: DynamoDB table (Incident, Alert, ContainmentAction, ModelVersion, PromotionRequest, ShadowRun, EvaluationResult), S3 bucket (model artifacts, evaluation datasets).

**Events published**:
- Incident: `INCIDENT_DETECTED`, `INCIDENT_CONTAINED`, `INCIDENT_ESCALATED`, `INCIDENT_RESOLVED`
- Circuit breaker: `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`
- Health: `HEALTH_CHECK_COMPLETED`
- Model lifecycle: `MODEL_REGISTERED`, `SHADOW_RUN_STARTED`, `SHADOW_RUN_COMPLETED`, `MODEL_PROMOTION_REQUESTED`, `MODEL_PROMOTION_APPROVED`, `MODEL_PROMOTED`, `MODEL_ROLLBACK_TRIGGERED`
- Cost: `TENANT_BUDGET_APPROACHING`, `TENANT_BUDGET_EXCEEDED`, `REASONING_TIER_CHANGED`
- Operator: `OPERATOR_ACTION_PERFORMED`
- Telemetry: `EVENT_DELIVERY_FAILED`, `EVENT_REPLAYED`

**Events consumed (intra-domain)**: `AGENT_EXECUTION_FAILED`, `DECISION_PACKET_CREATED` (from advisory-ctrl, for shadow comparison); `GUARDRAIL_VIOLATION_DETECTED`, `SUITABILITY_CHECK_FAILED` (from compliance-ctrl); `MODEL_PROMOTION_REQUESTED` (own)

**Events consumed (cross-domain from execution-hub)**: `BROKER_SESSION_LOST`, `STREAM_DISCONNECTED`, `ORDER_REJECTED`, `PORTFOLIO_DRIFT_DETECTED`, `RECONCILIATION_FAILED`

---

### advisory-bff

**Type**: BFF
**Actor**: Investor + Platform Operator + Compliance Reviewer + AI Governance Reviewer (ABAC-gated)

Absorbs the former compliance-bff and operations-bff. Serves four actor types via ABAC-gated API. Investor sees recommendations, explanations, and read-only safety rules; internal actors see their respective dashboards.

**Feature set**: Recommendations, explanations, "Why" views, user confirmation flow, safety rules view, audit trail, compliance dashboard, operations dashboard, AI governance dashboard, incident history, model registry, shadow divergence reports, cost dashboards, flight phase status.

**Aggregate**: Recommendation/Explanation projections + Compliance/Audit projections + Operations dashboard projections.

**API**: AppSync GraphQL -- recommendation queries, explanation queries, "why" narrative subscriptions, decision confirmation/rejection mutations, safety rules queries, audit trail queries, ops dashboard queries, model registry queries, incident history queries.

**AI agent**: Conversational AgentCore instance of **Recommendation & Explainability Agent** for on-demand "why" queries.

**Knowledge Base**: Bedrock KB fed by recommendation and explanation events.

**Events published**: `USER_VIEWED_EXPLANATION`

**Events consumed (intra-domain)**: `RECOMMENDATION_PROPOSED`, `EXPLANATION_GENERATED`, `USER_CONFIRMATION_REQUESTED` (from advisory-ctrl); all compliance-ctrl events (compliance/audit projections); all operations-ctrl events (ops dashboard projections)

**Microfrontends**: Decision Detail / "Why" View, Confirmation Dialog, Dashboard -- Status Banner + Action Required (partial), Settings -- Your Safety Rules (embedded), How Nestfolio Works -- safety rules + compliance summary (partial), Operations Dashboard (all panels, operator-facing).

---

## Execution Domain

### execution-hub

**Type**: Event Hub

Owns the Execution domain EventBridge bus, cross-domain forwarding rules, and event archive. Merges the event infrastructure of the former execution-hub and portfolio-hub.

**Cross-domain forwarding rules (outbound)**:

| Target | Events |
|---|---|
| investor-hub | `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_STAGED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `CORPORATE_ACTION_APPLIED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED`, `VIRTUAL_DEPOSIT_CREDITED`, `VIRTUAL_WITHDRAWAL_DEBITED`, `PORTFOLIO_RESET_COMPLETED` |
| advisory-hub | `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `PORTFOLIO_DRIFT_DETECTED`, `BROKER_SESSION_LOST`, `STREAM_DISCONNECTED`, `RECONCILIATION_FAILED` |

---

### execution-ctrl

**Type**: CTRL

Order lifecycle orchestration via Step Functions -- pre-submission safety checks, market hours validation, submit or stage, monitor fills, cool-down enforcement. Enforces single-writer principle: only this service can generate order submission commands.

**State**: DynamoDB table (Order records, order lifecycle state).

**Events published**: `ORDER_SUBMITTED`, `ORDER_STAGED`, `EXECUTION_PAUSED`, `EXECUTION_RESUMED`

**Events consumed (intra-domain)**: `RECONCILIATION_LOCK_ACQUIRED`, `RECONCILIATION_LOCK_RELEASED` (from portfolio-ctrl)

**Events consumed (cross-domain from advisory-hub)**: `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`

**Events consumed (cross-domain from investor-hub)**: `ACCOUNT_CLOSURE_REQUESTED` -- triggers cancellation of all pending/staged orders and blocks new submissions. The account enters a terminal wind-down state. `ACCOUNT_MODE_SET` -- adjusts order routing behavior; in SIMULATION mode, submitted orders are directed to the simulation engine within `execution-adpt` rather than IBKR.

---

### execution-adpt

**Type**: ADPT
**External system**: Interactive Brokers (IBKR) / Simulation Engine

Anti-corruption layer translating IBKR protocols (REST API, webhooks, streaming feeds) into domain events. Handles order submission, position/account snapshots (periodic + streaming), session management, credential isolation (Secrets Manager), deposit detection (via snapshot cash diff), and withdrawal execution.

When the tenant's account mode is SIMULATION, the internal simulation engine handles all broker-facing operations instead of IBKR. The simulation engine maintains a virtual position ledger and virtual cash balance, produces simulated fills at real market prices (sourced from the same market data feed used by the Market & Research Agent), and emits identical domain events as the IBKR path so that downstream services (advisory, portfolio, notifications) operate without branching. Virtual deposits and withdrawals are credited/debited immediately against the virtual cash balance. Portfolio snapshots are generated from the virtual ledger on the same periodic schedule as IBKR snapshots.

**Facade**: API Gateway REST API for IBKR webhook callbacks.

**State**: DynamoDB table (BrokerSession, StreamConnection, API response cache, Deposit, Withdrawal, VirtualPortfolioLedger, VirtualCashBalance).

**Events published**: `ORDER_ACCEPTED`, `ORDER_PARTIALLY_FILLED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `PORTFOLIO_SNAPSHOT_IMPORTED`, `BROKER_SESSION_ESTABLISHED`, `BROKER_SESSION_LOST`, `STREAM_CONNECTED`, `STREAM_DISCONNECTED`, `BROKER_AUTHORIZATION_REVOKED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_SUBMITTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `VIRTUAL_DEPOSIT_CREDITED`, `VIRTUAL_WITHDRAWAL_DEBITED`, `PORTFOLIO_RESET_COMPLETED`

**Events consumed (intra-domain)**: `ORDER_SUBMITTED` (from execution-ctrl)

**Events consumed (cross-domain from investor-hub)**: `WITHDRAWAL_REQUESTED`; `ACCOUNT_MODE_SET` -- switches between IBKR and simulation engine routing; `GO_LIVE_REQUESTED` -- provisions a real IBKR account, clears the virtual ledger, and emits `PORTFOLIO_RESET_COMPLETED`; scheduled events for periodic snapshot imports

---

### portfolio-bff

**Type**: BFF
**Actor**: Investor

Portfolio dashboard, holdings, performance charts, real-time position subscriptions, goal progress. In SIMULATION mode, displays a simulation mode indicator, virtual capital balance, and a "Go Live" call-to-action.

**Aggregate**: Portfolio projection (positions, cash balances, performance metrics, account mode).

**API**: AppSync GraphQL with real-time subscriptions.

**State**: DynamoDB table.

**Events published**: `PORTFOLIO_CREATED`, `PORTFOLIO_UPDATED`, `POSITION_UPDATED`, `CASH_BALANCE_UPDATED` -- projection-change events for real-time UI subscriptions (AppSync) only. No other service subscribes to them.

**Events consumed (intra-domain)**: `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `PORTFOLIO_SNAPSHOT_IMPORTED` (from execution-adpt); `CORPORATE_ACTION_APPLIED`, reconciliation events (from portfolio-ctrl)

**Events consumed (cross-domain from investor-hub)**: `ACCOUNT_MODE_SET` -- toggles simulation mode indicator and virtual capital display in the portfolio UI

**Microfrontends**: Dashboard -- Portfolio Value (partial), Portfolio Detail.

---

### portfolio-ctrl

**Type**: CTRL

Reconciliation pipeline via Step Functions -- compare intent vs settlement, detect drift, acquire lock, pause affected execution, import snapshot, correct projections, revalidate compliance, release lock, resume. Also handles post-execution reconciliation, scheduled reconciliation (hourly, daily), and startup reconciliation. In SIMULATION mode, reconciliation compares the intent projection against the virtual portfolio ledger maintained by `execution-adpt` rather than an external broker snapshot.

**State**: DynamoDB table (Reconciliation records, DriftRecord).

**Events published**: `PORTFOLIO_DRIFT_DETECTED`, `RECONCILIATION_REQUIRED`, `RECONCILIATION_STARTED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED`, `RECONCILIATION_LOCK_ACQUIRED`, `RECONCILIATION_LOCK_RELEASED`, `PROJECTION_REBUILT`, `CORPORATE_ACTION_APPLIED`

**Events consumed (intra-domain)**: `PORTFOLIO_SNAPSHOT_IMPORTED`, `ORDER_FILLED` (from execution-adpt); scheduled events

---

## Orchestration Workflows

| Service | Workflow | Pattern | Triggers |
|---|---|---|---|
| `advisory-ctrl` | Decision Lifecycle | Orchestration + SAGA | Goal/risk/mode changes (Investor), drift/order outcomes/deposits (Execution) |
| `compliance-ctrl` | Compliance Check | Orchestration | `DECISION_PACKET_CREATED` (intra-domain) |
| `execution-ctrl` | Order Lifecycle | Orchestration | `DECISION_APPROVED` + `USER_CONFIRMED` (cross-domain from Advisory) |
| `portfolio-ctrl` | Reconciliation | Orchestration + SAGA | `PORTFOLIO_SNAPSHOT_IMPORTED`, `ORDER_FILLED` (intra-domain), scheduled |
| `investor-ctrl` | Notification Pipeline | Orchestration | Cross-domain events from Advisory and Execution; intra-domain events from investor-bff |
| `operations-ctrl` | Incident Lifecycle | Orchestration | Failure/anomaly events from Execution (cross-domain) and Advisory (intra-domain) |
| `operations-ctrl` | Model Promotion | Orchestration | `MODEL_PROMOTION_REQUESTED` (intra-domain) |
| `operations-ctrl` | Cost Governance | Orchestration | Budget threshold events, invocation rate signals |

---

## AI Agent Hosting Map

All 6 agents are implemented via Amazon AgentCore. BFF agents are conversational (user-in-the-loop); CTRL agents are async (event-driven, no user-in-the-loop).

| Agent | Async Host (CTRL) | Conversational Host (BFF) |
|---|---|---|
| User & Goals | `advisory-ctrl` -- decision lifecycle | `investor-bff` -- onboarding, goal refinement |
| Risk | `advisory-ctrl` -- decision lifecycle | `investor-bff` -- risk questionnaire |
| Market & Research | `advisory-ctrl` -- decision lifecycle | -- |
| Portfolio Construction | `advisory-ctrl` -- decision lifecycle | -- |
| Rebalance Planner | `advisory-ctrl` -- decision lifecycle | -- |
| Recommendation & Explainability | `advisory-ctrl` -- explanation generation | `advisory-bff` -- on-demand "why" queries |

**Knowledge Bases (RAG-first)**:

| Service | Fed By | Content |
|---|---|---|
| `investor-bff` | Investor domain events | User intent history, goal context, risk preference patterns |
| `advisory-ctrl` | Cross-domain trigger events | Decision history, market context, portfolio states, reasoning precedents |
| `advisory-bff` | Recommendation and explanation events | Explanation corpus, recommendation history, user interaction patterns |

---

## External System Integrations

| External System | Service | Integration Pattern |
|---|---|---|
| **Interactive Brokers (IBKR)** | `execution-adpt` | REST API (orders, snapshots), streaming feeds (positions, order status), webhook callbacks, OAuth. Credential isolation via Secrets Manager |
| **Simulation Engine** | `execution-adpt` | Internal module within `execution-adpt`. Virtual position ledger, virtual cash balance, simulated fills at real market prices. No external dependency -- all state is managed in DynamoDB |
| **Amazon Cognito** | `investor-web` | User Pool with Google/Facebook federation, JWT with `tenant_id` claim, Lambda triggers |
| **Amazon AgentCore** | `advisory-ctrl`, `advisory-bff`, `investor-bff` | AI agent hosting (6 specialized agents). Platform service |
| **Amazon Bedrock KB** | `investor-bff`, `advisory-ctrl`, `advisory-bff` | RAG-based knowledge access, per-service KB fed by domain events |
| **MCP Server** | `advisory-ctrl` | Real-time market data for Market & Research Agent |
| **Email/Push (SES, SNS/FCM)** | `investor-ctrl` | Notification delivery channels |
