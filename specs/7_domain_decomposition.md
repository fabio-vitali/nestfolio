# Nestfolio — Volume 7: Domain Decomposition

> Applies the decomposition methodology from spec 6 (Implementation Architecture Summary) to the Nestfolio system described in spec 2 (System Architecture).

---

## 1. Bounded Contexts Overview

| # | Domain | Responsibilities | Key Entities |
|---|--------|-----------------|--------------|
| 1 | `identity` | User authentication (Cognito, JWT, federation), user profiles, goals, risk profiles, mandates, onboarding, operating mode selection, deposit initiation, withdrawal requests, account closure, GDPR deletion | User, Session, TenantClaim, UserProfile, Goal, RiskProfile, Mandate, OnboardingAnswer, OperatingMode, DepositIntent, WithdrawalRequest, DeletionRequest |
| 2 | `advisory` | Decision lifecycle orchestration, 6 specialized AI agents (User & Goals, Risk, Market & Research, Portfolio Construction, Rebalance Planner, Recommendation & Explainability), Decision Packet composition, user confirmation flow. All agents implemented via Amazon AgentCore — async agents in `advisory-ctrl`, conversational agents in `advisory-bff` or `identity-bff`. | ContextBundle, AgentInvocation, ReasoningFactors, Recommendation, Explanation, MarketSignal, DecisionPacket, Workflow, TradePlan, FeatureSnapshot |
| 3 | `compliance` | Mandate validation, guardrail enforcement, suitability checks, audit trail, escalation, Level 1→2 promotion | ComplianceCheck, GuardrailPolicy, AuditArtifact, Escalation |
| 4 | `execution` | IBKR integration (orders + snapshots + streaming), order lifecycle, broker session management, credential isolation, deposit detection, withdrawal execution | Order, BrokerSession, ExecutionOutcome, IBKRSnapshot, StreamConnection, Deposit, Withdrawal |
| 5 | `portfolio` | Portfolio projections, positions, cash balances, reconciliation, drift detection, safe recovery | Portfolio, Position, CashBalance, Reconciliation, DriftRecord |
| 6 | `notification` | User communications, notification policy resolution, channel delivery (in-app, email, push), message lifecycle | Notification, NotificationPolicy, Channel, MessageTemplate |
| 7 | `operations` | Monitoring, dashboards, AI health indicators, incident detection & classification, automated containment, incident lifecycle, model registry, promotion pipeline (offline → shadow → limited → production), rollback, shadow comparison, cost governance, event infrastructure telemetry | Incident, Alert, HealthIndicator, Dashboard, ContainmentAction, ModelVersion, PromotionRequest, ShadowRun, EvaluationResult |

---

## 1.1 Agent Roster (Amazon AgentCore)

All 6 specialized intelligence agents from spec 2 §8 are implemented via **Amazon AgentCore**. Each agent runs in either a BFF service (conversational, user-facing) or a controller service (async, process-driven). Some agents have dual hosting.

| # | Agent | Responsibilities | Async Host (controller) | Conversational Host (BFF) |
|---|-------|-----------------|------------------------|--------------------------|
| 1 | **User & Goals Agent** | Goal interpretation, timeline extraction, constraint identification | `advisory-ctrl` — invoked during decision lifecycle when goals change | `identity-bff` — conversational onboarding, goal refinement dialogue |
| 2 | **Risk Agent** | Risk profiling, risk band computation, guardrails evaluation | `advisory-ctrl` — invoked during decision lifecycle for risk assessment | `identity-bff` — conversational risk questionnaire evaluation during onboarding |
| 3 | **Market & Research Agent** | Market signals, regime classification, watchlists | `advisory-ctrl` — invoked during decision lifecycle for market context | — |
| 4 | **Portfolio Construction Agent** | Target allocation, instrument selection | `advisory-ctrl` — invoked during decision lifecycle | — |
| 5 | **Rebalance Planner Agent** | Trade plan generation, cost/impact estimation | `advisory-ctrl` — invoked during decision lifecycle | — |
| 6 | **Recommendation & Explainability Agent** | Plain-language outputs, UX narratives, "why" explanations | `advisory-ctrl` — generates explanations during decision lifecycle | `advisory-bff` — conversational "why" queries, on-demand enhanced explanations |

### Hosting Rule

- **BFF agent** = user is in the loop (conversational interaction, request/response). Implemented as AgentCore agents within the BFF Lambda.
- **Controller agent** = no user in the loop (async orchestration, event-driven). Implemented as AgentCore agents invoked by the Step Functions state machine.
- Agents with **dual hosting** share the same AgentCore agent definition but are instantiated in different runtime contexts. The BFF instance receives user input as context; the controller instance receives event payloads as context.

### Knowledge Access Pattern (RAG-First)

AgentCore agents access domain knowledge through **Retrieval-Augmented Generation (RAG)** backed by **Amazon Bedrock Knowledge Bases** — not through synchronous calls to external systems.

**How it works:**

Each service that hosts AgentCore agents maintains its own Bedrock Knowledge Base (vector store, graph store, or both). The KB is continuously populated by the same domain events the service already subscribes to via EventBridge. When an agent needs context at inference time, it queries the service-local KB through RAG rather than reaching out to other services or external data sources.

**Per-service Knowledge Bases:**

| Service | KB Fed By | Typical Content |
|---------|-----------|-----------------|
| `identity-bff` | Identity events (goals, risk profiles, onboarding answers, mandates) | User intent history, goal context, risk preference patterns |
| `advisory-ctrl` | Advisory + cross-domain trigger events (drift, order outcomes, goal changes, market signals) | Decision history, market context, portfolio states, reasoning precedents |
| `advisory-bff` | Recommendation and explanation events | Explanation corpus, recommendation history, user interaction patterns |

**Why RAG over synchronous access:**

- **Decoupled at runtime** — Agents carry no runtime dependency on other services. A downstream service being unavailable does not block agent reasoning.
- **Low latency** — Pre-indexed local knowledge is orders of magnitude faster than cross-service API calls during inference.
- **Domain isolation** — Each service's KB contains only the knowledge relevant to its bounded context, enforcing the same boundaries the event architecture does.
- **Reproducible reasoning** — KB content derives from immutable domain events. Given the same event history, the same knowledge base state is reconstructable, supporting audit and replay.
- **Cost-efficient** — Event-driven batch ingestion into KBs amortizes indexing cost across many agent invocations, whereas synchronous access incurs per-invocation overhead.

**MCP servers as the exception:**

Synchronous external data access via MCP (Model Context Protocol) servers is permitted only when data freshness requirements cannot tolerate the propagation lag of the event → KB ingestion pipeline (typically seconds to low minutes). The primary candidate is real-time market data in the Market & Research Agent. Even in these cases, the MCP server is a complementary data source — the agent's primary context still comes from its service's KB via RAG.

### Decision Lifecycle Invocation Sequence

Within `advisory-ctrl`'s Step Functions state machine, agents are invoked in order:

```
1. User & Goals Agent    → GOAL_INTERPRETATION_PRODUCED
2. Risk Agent            → RISK_EVALUATION_PRODUCED
3. Market & Research     → MARKET_SIGNAL_DETECTED
4. Portfolio Construction → PORTFOLIO_CONSTRUCTION_PROPOSED
5. Rebalance Planner     → REBALANCE_PLAN_PRODUCED
6. Recommendation &      → RECOMMENDATION_PROPOSED + EXPLANATION_GENERATED
   Explainability
```

Steps 1–2 may be skipped if the trigger is not goal/risk related and cached interpretations are current. Each step emits `AGENT_INVOCATION_STARTED` / `AGENT_INVOCATION_COMPLETED` events.

---

## 2. Domain Events

Every event follows the `BusEvent` structure:

```typescript
BusEvent {
  id:        string   // crypto.randomUUID()
  type:      string   // SCREAMING_SNAKE_CASE
  timestamp: string   // ISO 8601
  subject:   object   // event-specific payload
  context:   object   // { tenantId, userId, correlationId? }
}
```

### 2.1 Identity Domain

| Event | Subject Payload |
|-------|----------------|
| `USER_REGISTERED` | `{ userId, email, federationProvider? }` |
| `USER_AUTHENTICATED` | `{ userId, sessionId }` |
| `USER_SESSION_EXPIRED` | `{ userId, sessionId }` |
| `ONBOARDING_ANSWER_RECORDED` | `{ userId, questionId, answer }` |
| `ONBOARDING_COMPLETED` | `{ userId, profileComplete: true }` |
| `GOAL_SET` | `{ userId, goalId, goalType, targetAmount, horizon }` |
| `GOAL_UPDATED` | `{ userId, goalId, changes }` |
| `RISK_PROFILE_SET` | `{ userId, riskProfileId, riskLevel }` |
| `RISK_PROFILE_UPDATED` | `{ userId, riskProfileId, changes }` |
| `MANDATE_GRANTED` | `{ userId, mandateId, scope, limits }` |
| `MANDATE_UPDATED` | `{ userId, mandateId, changes }` |
| `MANDATE_REVOKED` | `{ userId, mandateId, reason }` |
| `OPERATING_MODE_SELECTED` | `{ userId, mode: 'conservative' \| 'balanced' \| 'aggressive' }` |
| `OPERATING_MODE_CHANGED` | `{ userId, previousMode, newMode }` |
| `DEPOSIT_INITIATED` | `{ userId, amount, currency, method }` |
| `WITHDRAWAL_REQUESTED` | `{ userId, amount, currency }` |
| `ACCOUNT_CLOSURE_REQUESTED` | `{ userId, reason? }` |
| `ACCOUNT_CLOSED` | `{ userId, closedAt }` |
| `USER_DELETION_REQUESTED` | `{ userId }` |

### 2.2 Advisory Domain

| Event | Subject Payload |
|-------|----------------|
| `AGENT_INVOCATION_STARTED` | `{ invocationId, agentType, decisionId?, contextBundleHash }` |
| `AGENT_INVOCATION_COMPLETED` | `{ invocationId, agentType, resultEventIds }` |
| `AGENT_EXECUTION_FAILED` | `{ invocationId, agentType, errorName, errorMessage }` |
| `GOAL_INTERPRETATION_PRODUCED` | `{ userId, goalId, interpretation }` |
| `RISK_EVALUATION_PRODUCED` | `{ userId, riskAssessment, riskBand }` |
| `MARKET_SIGNAL_DETECTED` | `{ signalId, signalType, instruments, severity }` |
| `PORTFOLIO_CONSTRUCTION_PROPOSED` | `{ decisionId, targetAllocation, instrumentSelection }` |
| `REBALANCE_PLAN_PRODUCED` | `{ decisionId, tradePlan, costEstimate, taxImpact }` |
| `RECOMMENDATION_PROPOSED` | `{ decisionId, userId, recommendationId, authorityLevel, actions }` |
| `EXPLANATION_GENERATED` | `{ decisionId, explanationId, reasoningFactors, narrative }` |
| `DECISION_PACKET_CREATED` | `{ decisionId, userId, trigger, proposedActions, tradePlan, requiredAuthorityLevel }` |
| `DECISION_PACKET_ENRICHED` | `{ decisionId, riskChecks, costChecks, explainabilityFactors }` |
| `USER_CONFIRMATION_REQUESTED` | `{ decisionId, userId, confirmationType, summary }` |
| `USER_CONFIRMED` | `{ decisionId, userId }` |
| `USER_REJECTED` | `{ decisionId, userId, reason? }` |
| `USER_VIEWED_EXPLANATION` | `{ userId, decisionId, explanationId }` |

### 2.3 Compliance Domain

| Event | Subject Payload |
|-------|----------------|
| `DECISION_APPROVED` | `{ decisionId, complianceCheckId, approvedAt }` |
| `DECISION_BLOCKED` | `{ decisionId, complianceCheckId, reasons }` |
| `GUARDRAIL_VIOLATION_DETECTED` | `{ decisionId?, userId, violationType, details }` |
| `ESCALATION_TRIGGERED` | `{ decisionId, fromLevel, toLevel, reason }` |
| `COMPLIANCE_APPROVAL_GRANTED` | `{ decisionId, reviewerId, notes }` |
| `AUDIT_ARTIFACT_CREATED` | `{ artifactId, decisionId, artifactType }` |
| `SUITABILITY_CHECK_PASSED` | `{ userId, mandateId, checkResult }` |
| `SUITABILITY_CHECK_FAILED` | `{ userId, mandateId, failureReasons }` |

### 2.4 Execution Domain

| Event | Subject Payload |
|-------|----------------|
| `ORDER_SUBMITTED` | `{ orderId, decisionId, orderKey, instrument, side, quantity, limitParams? }` |
| `ORDER_ACCEPTED` | `{ orderId, brokerOrderId }` |
| `ORDER_PARTIALLY_FILLED` | `{ orderId, brokerOrderId, filledQuantity, remainingQuantity, fillPrice }` |
| `ORDER_FILLED` | `{ orderId, brokerOrderId, filledQuantity, avgPrice }` |
| `ORDER_REJECTED` | `{ orderId, brokerOrderId?, rejectReason }` |
| `ORDER_CANCELLED` | `{ orderId, brokerOrderId?, cancelReason }` |
| `ORDER_STAGED` | `{ orderId, decisionId, reason: 'market_closed' }` |
| `BROKER_SESSION_ESTABLISHED` | `{ sessionId, accountId }` |
| `BROKER_SESSION_LOST` | `{ sessionId, accountId, reason }` |
| `BROKER_AUTHORIZATION_REVOKED` | `{ userId, accountId }` |
| `PORTFOLIO_SNAPSHOT_IMPORTED` | `{ userId, portfolioId, snapshotTimestamp, positions, cashBalances }` |
| `STREAM_CONNECTED` | `{ streamId, accountId, feedTypes }` |
| `STREAM_DISCONNECTED` | `{ streamId, accountId, reason }` |
| `EXECUTION_PAUSED` | `{ scope: 'global' \| 'tenant' \| 'instrument', reason }` |
| `EXECUTION_RESUMED` | `{ scope, resumedBy }` |
| `DEPOSIT_DETECTED` | `{ userId, portfolioId, amount, currency, detectedAt }` |
| `WITHDRAWAL_SUBMITTED` | `{ userId, orderId, amount, currency }` |
| `WITHDRAWAL_COMPLETED` | `{ userId, amount, currency, completedAt }` |
| `WITHDRAWAL_REJECTED` | `{ userId, amount, reason }` |

### 2.5 Portfolio Domain

| Event | Subject Payload |
|-------|----------------|
| `PORTFOLIO_CREATED` | `{ portfolioId, userId, initialState }` |
| `PORTFOLIO_UPDATED` | `{ portfolioId, changes }` |
| `POSITION_UPDATED` | `{ portfolioId, instrument, quantity, marketValue }` |
| `CASH_BALANCE_UPDATED` | `{ portfolioId, currency, balance }` |
| `CORPORATE_ACTION_APPLIED` | `{ portfolioId, actionType, instrument, details }` |
| `PORTFOLIO_DRIFT_DETECTED` | `{ portfolioId, driftType, expected, actual, magnitude }` |
| `RECONCILIATION_REQUIRED` | `{ portfolioId, trigger, discrepancies }` |
| `RECONCILIATION_STARTED` | `{ reconciliationId, portfolioId }` |
| `RECONCILIATION_COMPLETED` | `{ reconciliationId, portfolioId, adjustments }` |
| `RECONCILIATION_FAILED` | `{ reconciliationId, portfolioId, reason }` |
| `RECONCILIATION_LOCK_ACQUIRED` | `{ portfolioId, instruments }` |
| `RECONCILIATION_LOCK_RELEASED` | `{ portfolioId, instruments }` |
| `PROJECTION_REBUILT` | `{ portfolioId, projectionType, version }` |

### 2.6 Notification Domain

| Event | Subject Payload |
|-------|----------------|
| `NOTIFICATION_CREATED` | `{ notificationId, userId, severity, templateId }` |
| `NOTIFICATION_SENT` | `{ notificationId, userId, channel, sentAt }` |
| `NOTIFICATION_DELIVERED` | `{ notificationId, channel, deliveredAt }` |
| `NOTIFICATION_READ` | `{ notificationId, userId, readAt }` |
| `MONTHLY_REPORT_GENERATED` | `{ userId, reportId, period }` |

### 2.7 Operations Domain

| Event | Subject Payload |
|-------|----------------|
| `INCIDENT_DETECTED` | `{ incidentId, class, severity, source, description }` |
| `INCIDENT_CONTAINED` | `{ incidentId, containmentActions }` |
| `INCIDENT_ESCALATED` | `{ incidentId, fromSeverity, toSeverity }` |
| `INCIDENT_RESOLVED` | `{ incidentId, resolvedBy, resolution }` |
| `CIRCUIT_BREAKER_TRIGGERED` | `{ breakerId, scope, trigger, thresholdValue }` |
| `CIRCUIT_BREAKER_RESET` | `{ breakerId, scope, resetBy }` |
| `HEALTH_CHECK_COMPLETED` | `{ checkType, status, metrics }` |
| `OPERATOR_ACTION_PERFORMED` | `{ operatorId, action, scope, reason }` |
| `MODEL_REGISTERED` | `{ modelId, version, trainingDataRef, evaluationResults }` |
| `SHADOW_RUN_STARTED` | `{ modelId, version, cohortId }` |
| `SHADOW_RUN_COMPLETED` | `{ modelId, version, comparisonMetrics }` |
| `MODEL_PROMOTION_REQUESTED` | `{ modelId, version, requestedBy }` |
| `MODEL_PROMOTION_APPROVED` | `{ modelId, version, approvedBy }` |
| `MODEL_PROMOTED` | `{ modelId, version, promotedAt, previousVersion }` |
| `MODEL_ROLLBACK_TRIGGERED` | `{ modelId, fromVersion, toVersion, reason }` |
| `TENANT_BUDGET_APPROACHING` | `{ tenantId, currentSpend, budgetLimit }` |
| `TENANT_BUDGET_EXCEEDED` | `{ tenantId, currentSpend, budgetLimit }` |
| `REASONING_TIER_CHANGED` | `{ tenantId?, fromTier, toTier, reason }` |
| `EVENT_DELIVERY_FAILED` | `{ eventId, eventType, targetService, failureReason }` |
| `EVENT_REPLAYED` | `{ replayId, eventRange, destination }` |
| `SCHEMA_REGISTERED` | `{ schemaName, version }` |

---

## 3. Microservices

### 3.1 Identity Domain

| Service | Suffix | Role | Owns |
|---------|--------|------|------|
| `identity-web` | `-web` | Web / Identity Frontend | **State**: Cognito User Pool (Google/Facebook federation). **Facade**: CloudFront distribution with path-based routing to BFF endpoints, Route53 hosted zone. **Egress**: Lambda triggers on PostAuthentication/PostConfirmation → publish USER_REGISTERED, USER_AUTHENTICATED. |
| `identity-bff` | `-bff` | Backend-for-Frontend | **State**: DynamoDB table (UserProfile, Goal, RiskProfile, Mandate, OnboardingAnswer, OperatingMode, DepositIntent, WithdrawalRequest, DeletionRequest). **Facade**: AppSync GraphQL API (onboarding mutations, profile queries, goal CRUD, mandate management, deposit initiation, withdrawal requests, account closure, GDPR deletion requests, broker authorization revocation). **Agents**: Hosts conversational AgentCore instances of **User & Goals Agent** (onboarding goal dialogue, goal refinement) and **Risk Agent** (risk questionnaire evaluation). **Knowledge Base**: Bedrock KB (vector + graph) fed by identity domain events — user intent history, goal context, risk preference patterns. Agents query this KB via RAG at inference time. **Ingress**: Subscribes to internal USER_REGISTERED to create initial UserProfile. Subscribes to DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED from execution to update request statuses. **Egress**: Publishes all identity entity state changes as domain events (including DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, USER_DELETION_REQUESTED). |

### 3.2 Advisory Domain

| Service | Suffix | Role | Owns |
|---------|--------|------|------|
| `advisory-ctrl` | `-ctrl` | Controller | **State**: DynamoDB table (AgentInvocation records, reasoning outputs, DecisionPacket, Workflow state). **Agents**: Hosts async AgentCore instances of all 6 specialized agents (User & Goals, Risk, Market & Research, Portfolio Construction, Rebalance Planner, Recommendation & Explainability). **Knowledge Base**: Bedrock KB (vector + graph) fed by all subscribed cross-domain events — decision history, market context, portfolio states, reasoning precedents. Primary knowledge source for all 6 agents via RAG. Market & Research Agent may additionally use an MCP server for real-time market data when event propagation lag is insufficient. **Ingress**: Subscribes to triggers — GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED from identity; PORTFOLIO_DRIFT_DETECTED from portfolio; ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED from execution; DECISION_APPROVED, DECISION_BLOCKED from compliance. **Egress**: Publishes DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, USER_CONFIRMATION_REQUESTED, USER_CONFIRMED, USER_REJECTED, RECOMMENDATION_PROPOSED, EXPLANATION_GENERATED, agent lifecycle events (AGENT_INVOCATION_STARTED, AGENT_INVOCATION_COMPLETED, AGENT_EXECUTION_FAILED). Step Functions state machine orchestrates the full decision lifecycle (trigger detection → context assembly → agent invocation sequence [User & Goals → Risk → Market & Research → Portfolio Construction → Rebalance Planner → Recommendation & Explainability] → Decision Packet composition → compliance handoff → user confirmation → execution handoff). Steps 1–2 may be skipped when cached interpretations are current (see §1.1). |
| `advisory-bff` | `-bff` | Backend-for-Frontend | **State**: DynamoDB table (Recommendation projections, Explanation projections). **Facade**: AppSync GraphQL API (recommendation queries, explanation queries, "why" narrative subscriptions). **Agents**: Hosts conversational AgentCore instance of **Recommendation & Explainability Agent** for on-demand "why" queries and enhanced explanation generation. **Knowledge Base**: Bedrock KB fed by recommendation and explanation events — explanation corpus, recommendation history, user interaction patterns. Agent queries this KB via RAG to generate contextual "why" responses. **Ingress**: Subscribes to RECOMMENDATION_PROPOSED, EXPLANATION_GENERATED from advisory-ctrl. **Egress**: Publishes USER_VIEWED_EXPLANATION when user accesses explanations. |

### 3.3 Compliance Domain

| Service | Suffix | Role | Owns |
|---------|--------|------|------|
| `compliance-ctrl` | `-ctrl` | Controller | **State**: DynamoDB table (ComplianceCheck, GuardrailPolicy, AuditArtifact). **Ingress**: Subscribes to DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED from advisory. Also subscribes to MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_CHANGED from identity to keep guardrail policy projections current. **Egress**: Publishes DECISION_APPROVED, DECISION_BLOCKED, GUARDRAIL_VIOLATION_DETECTED, ESCALATION_TRIGGERED. Step Functions implements compliance check workflow (mandate validation → guardrail evaluation → suitability check → authority level determination → approve/block). |
| `compliance-bff` | `-bff` | Backend-for-Frontend | **State**: DynamoDB table (Compliance projection, audit views). **Facade**: AppSync GraphQL API (audit trail queries, compliance dashboard, approval history). **Ingress**: Subscribes to all compliance-ctrl events to build projections. |

### 3.4 Execution Domain

| Service | Suffix | Role | Owns |
|---------|--------|------|------|
| `execution-ctrl` | `-ctrl` | Controller | **State**: DynamoDB table (Order records, order lifecycle state). **Ingress**: Subscribes to DECISION_APPROVED from compliance, USER_CONFIRMED from advisory. Subscribes to ACCOUNT_CLOSURE_REQUESTED from identity to halt all execution. Also subscribes to RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED from portfolio and CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET from operations. **Egress**: Publishes ORDER_SUBMITTED, ORDER_STAGED, EXECUTION_PAUSED, EXECUTION_RESUMED. Step Functions manages order lifecycle (pre-submission safety checks → market hours validation → submit or stage → monitor fills → cool-down enforcement). |
| `execution-adpt` | `-adpt` | Adapter | **State**: DynamoDB table (BrokerSession, StreamConnection, API response cache, Deposit, Withdrawal). **Ingress**: Subscribes to ORDER_SUBMITTED from execution-ctrl for order placement. Subscribes to WITHDRAWAL_REQUESTED from identity for withdrawal execution. Subscribes to scheduled events for periodic snapshot imports. **Egress**: Publishes ORDER_ACCEPTED, ORDER_PARTIALLY_FILLED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_SNAPSHOT_IMPORTED, BROKER_SESSION_ESTABLISHED, BROKER_SESSION_LOST, STREAM_CONNECTED, STREAM_DISCONNECTED, BROKER_AUTHORIZATION_REVOKED, DEPOSIT_DETECTED, WITHDRAWAL_SUBMITTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED. **Facade**: API Gateway REST API for IBKR webhook callbacks. Handles all IBKR communication: order submission, position/account snapshots, streaming feeds, session management, credential isolation (Secrets Manager), deposit detection (via snapshot diff), withdrawal execution. |

### 3.5 Portfolio Domain

| Service | Suffix | Role | Owns |
|---------|--------|------|------|
| `portfolio-bff` | `-bff` | Backend-for-Frontend | **State**: DynamoDB table (Portfolio projection, Position, CashBalance, performance metrics). **Facade**: AppSync GraphQL API (portfolio dashboard queries, holdings queries, performance charts, real-time position subscriptions). **Ingress**: Subscribes to execution events (ORDER_FILLED, ORDER_PARTIALLY_FILLED, PORTFOLIO_SNAPSHOT_IMPORTED, CORPORATE_ACTION_APPLIED) to update position projections. Also subscribes to own reconciliation events to update projection state. **Egress**: Publishes PORTFOLIO_CREATED, PORTFOLIO_UPDATED, POSITION_UPDATED, CASH_BALANCE_UPDATED. |
| `portfolio-ctrl` | `-ctrl` | Controller | **State**: DynamoDB table (Reconciliation records, DriftRecord). **Ingress**: Subscribes to PORTFOLIO_SNAPSHOT_IMPORTED and ORDER_FILLED from execution domain to trigger post-execution reconciliation. Subscribes to scheduled events (hourly, daily full reconciliation). **Egress**: Publishes PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_REQUIRED, RECONCILIATION_STARTED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED, PROJECTION_REBUILT. Step Functions implements reconciliation workflow (compare intent vs settlement → detect drift → acquire lock → pause affected execution → import snapshot → correct projections → revalidate compliance → release lock → resume). |

### 3.6 Notification Domain

| Service | Suffix | Role | Owns |
|---------|--------|------|------|
| `notification-ctrl` | `-ctrl` | Controller | **State**: DynamoDB table (Notification records, NotificationPolicy, user channel preferences). **Ingress**: Subscribes to DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED from identity; DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED from advisory; DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED from compliance; ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_STAGED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED from execution; CORPORATE_ACTION_APPLIED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED from portfolio; CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED from operations. **Egress**: Publishes NOTIFICATION_CREATED, NOTIFICATION_SENT, NOTIFICATION_DELIVERED. Step Functions implements notification workflow (impact classification → policy resolution → template selection → channel routing → delivery). |
| `notification-bff` | `-bff` | Backend-for-Frontend | **State**: DynamoDB table (Notification projection for user inbox). **Facade**: AppSync GraphQL API (notification list queries, unread count, real-time notification subscriptions, mark-as-read mutations). **Ingress**: Subscribes to NOTIFICATION_CREATED, NOTIFICATION_SENT from notification-ctrl. **Egress**: Publishes NOTIFICATION_READ. |

### 3.7 Operations Domain

| Service | Suffix | Role | Owns |
|---------|--------|------|------|
| `operations-ctrl` | `-ctrl` | Controller | **State**: DynamoDB table (Incident records, Alert history, ContainmentAction records, ModelVersion, PromotionRequest, ShadowRun, EvaluationResult), S3 bucket (model artifacts, evaluation datasets). **Ingress**: Subscribes broadly — AGENT_EXECUTION_FAILED, DECISION_PACKET_CREATED from advisory; GUARDRAIL_VIOLATION_DETECTED, SUITABILITY_CHECK_FAILED from compliance; BROKER_SESSION_LOST, STREAM_DISCONNECTED, ORDER_REJECTED from execution; PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED from portfolio. Also subscribes to internal MODEL_PROMOTION_REQUESTED for approval workflows, and DECISION_PACKET_CREATED for shadow model comparison. **Egress**: Publishes incident lifecycle events, circuit breaker events, model lifecycle events, cost governance events, event infrastructure telemetry. Step Functions implements incident lifecycle (detection → classification → automatic containment → stabilization → escalation → human review gate → controlled recovery) and model promotion pipeline (offline evaluation → shadow mode → limited rollout → approval gate → production promotion) and cost governance workflows. |
| `operations-bff` | `-bff` | Backend-for-Frontend | **State**: DynamoDB table (Dashboard projections, HealthIndicator snapshots, Model registry projections, shadow comparison projections). **Facade**: AppSync GraphQL API (operations dashboard, compliance dashboard, AI governance dashboard, incident history, model registry queries, promotion pipeline status, shadow divergence reports, cost dashboards). **Ingress**: Subscribes to all operations-ctrl events to build dashboard projections. |

### Service Count Summary

| Domain | Services | Count |
|--------|----------|-------|
| identity | identity-web, identity-bff | 2 |
| advisory | advisory-ctrl, advisory-bff | 2 |
| compliance | compliance-ctrl, compliance-bff | 2 |
| execution | execution-ctrl, execution-adpt | 2 |
| portfolio | portfolio-bff, portfolio-ctrl | 2 |
| notification | notification-ctrl, notification-bff | 2 |
| operations | operations-ctrl, operations-bff | 2 |
| **Total** | | **14** |

---

## 4. Cross-Domain Event Flows

### 4.1 Decision Lifecycle (Trigger → Advisory → Compliance → Execution → Portfolio)

```
┌─────────────┐  PORTFOLIO_DRIFT_DETECTED   ┌──────────────┐
│  portfolio   │ ──────────────────────────► │   advisory    │
│  -ctrl       │                             │   -ctrl       │
└─────────────┘  ORDER_FILLED / REJECTED     │               │
┌─────────────┐ ───────────────────────────► │  Orchestrator │
│  execution   │                             │  Step Fn      │
│  -ctrl/-adpt │  GOAL_UPDATED               │               │
└─────────────┘  OPERATING_MODE_CHANGED      │  1. Context   │
┌─────────────┐ ───────────────────────────► │     assembly  │
│  identity    │                             │  2. AgentCore │
│  -bff        │                             │     (6 agents)│
└─────────────┘                              │  3. Packet    │
                                             │     composition│
                                             └───────┬───────┘
                                                     │
                                   DECISION_PACKET_   │
                                   CREATED            │
                                                     ▼
                                             ┌──────────────┐
                                             │  compliance   │
                                             │   -ctrl       │
                                             │               │
                                             │  Validates    │
                                             └───────┬───────┘
                                                     │
                                   DECISION_APPROVED  │  (or DECISION_BLOCKED)
                                                     ▼
                                             ┌──────────────┐
                                             │  advisory     │
                                             │   -ctrl       │
                                             │               │
                                             │  If Level 2:  │
                                             │  user confirm │
                                             └───────┬───────┘
                                                     │
                                   USER_CONFIRMED     │  (or USER_REJECTED)
                                                     ▼
                                             ┌──────────────┐
                                             │  execution    │
                                             │   -ctrl       │
                                             │               │
                                             │  Safety       │
                                             │  checks       │
                                             └───────┬───────┘
                                                     │
                                   ORDER_SUBMITTED    │
                                                     ▼
                                             ┌──────────────┐
                                             │  execution    │
                                             │   -adpt       │
                                             │               │
                                             │  IBKR API     │
                                             └───────┬───────┘
                                                     │
                                   ORDER_FILLED /     │
                                   PORTFOLIO_SNAPSHOT_ │
                                   IMPORTED           │
                                                     ▼
                                             ┌──────────────┐
                                             │  portfolio    │
                                             │   -bff        │
                                             │               │
                                             │  Updates      │
                                             │  projections  │
                                             └──────────────┘
```

**Sequence:**
1. Trigger event detected (drift, order outcome, goal change, mode change)
2. `advisory-ctrl` assembles context, invokes AgentCore agents (User & Goals → Risk → Market & Research → Portfolio Construction → Rebalance Planner → Recommendation & Explainability), composes Decision Packet → `DECISION_PACKET_CREATED`
3. `compliance-ctrl` validates mandate, guardrails, suitability → `DECISION_APPROVED`
4. If Level 2 required: `advisory-ctrl` emits `USER_CONFIRMATION_REQUESTED` → waits for `USER_CONFIRMED`
5. `execution-ctrl` performs safety checks, submits order → `ORDER_SUBMITTED`
6. `execution-adpt` places order with IBKR → `ORDER_FILLED`
7. `portfolio-bff` updates position projections, `portfolio-ctrl` triggers reconciliation

### 4.2 Reconciliation Flow

```
┌──────────────┐  PORTFOLIO_SNAPSHOT_IMPORTED   ┌──────────────┐
│  execution    │ ─────────────────────────────► │  portfolio    │
│  -adpt        │  (periodic + post-execution)   │  -ctrl        │
└──────────────┘                                 └───────┬───────┘
                                                         │
                                       Compare intent    │
                                       vs settlement     │
                                                         ▼
                                                 ┌──────────────┐
                                                 │  Drift?       │
                                                 └───┬──────┬───┘
                                              No     │      │ Yes
                                                     │      │
                                           (done)    ▼      ▼
                                             RECONCILIATION_  PORTFOLIO_DRIFT_
                                             COMPLETED        DETECTED
                                                              │
                                                              ▼
                                                     RECONCILIATION_LOCK_ACQUIRED
                                                              │
                                                              ▼
                                                     EXECUTION_PAUSED
                                                     (execution-ctrl subscribes)
                                                              │
                                                              ▼
                                                     Import fresh snapshot
                                                     Correct projections
                                                              │
                                                              ▼
                                                     RECONCILIATION_COMPLETED
                                                              │
                                                              ▼
                                                     RECONCILIATION_LOCK_RELEASED
                                                              │
                                                              ▼
                                                     EXECUTION_RESUMED
```

**Sequence:**
1. `execution-adpt` imports IBKR snapshot → `PORTFOLIO_SNAPSHOT_IMPORTED`
2. `portfolio-ctrl` compares expected projection against settlement snapshot
3. If drift: `PORTFOLIO_DRIFT_DETECTED` → `RECONCILIATION_LOCK_ACQUIRED`
4. `execution-ctrl` subscribes to lock events → pauses affected instruments
5. `portfolio-ctrl` imports corrected snapshot, rebuilds projections
6. `RECONCILIATION_COMPLETED` → `RECONCILIATION_LOCK_RELEASED`
7. `execution-ctrl` resumes → `EXECUTION_RESUMED`
8. If low confidence: `ESCALATION_TRIGGERED` → human review via compliance

### 4.3 Incident Response Flow

```
┌──────────────┐  AGENT_EXECUTION_FAILED        ┌──────────────┐
│  advisory     │  BROKER_SESSION_LOST           │  operations   │
│  execution    │  STREAM_DISCONNECTED           │  -ctrl        │
│  portfolio    │  RECONCILIATION_FAILED         │               │
│  compliance   │  GUARDRAIL_VIOLATION_DETECTED  │  Detection &  │
│               │ ─────────────────────────────► │  Classification│
└──────────────┘                                 └───────┬───────┘
                                                         │
                                           INCIDENT_     │
                                           DETECTED      │
                                                         ▼
                                                 ┌──────────────┐
                                                 │  Automatic    │
                                                 │  Containment  │
                                                 └───────┬───────┘
                                                         │
                                   CIRCUIT_BREAKER_      │  EXECUTION_PAUSED
                                   TRIGGERED             │  (cross-domain)
                                   INCIDENT_CONTAINED    │
                                                         ▼
                                                 ┌──────────────┐
                                                 │  Stabilization│
                                                 │  Workflow     │
                                                 └───────┬───────┘
                                                         │
                                   INCIDENT_ESCALATED    │  (if needed)
                                                         ▼
                                                 ┌──────────────┐
                                                 │  Human Review │
                                                 │  (via ops-bff)│
                                                 └───────┬───────┘
                                                         │
                                   OPERATOR_ACTION_      │
                                   PERFORMED             │
                                   INCIDENT_RESOLVED     │
                                                         ▼
                                                 ┌──────────────┐
                                                 │  Recovery     │
                                                 │  CIRCUIT_     │
                                                 │  BREAKER_RESET│
                                                 │  EXECUTION_   │
                                                 │  RESUMED      │
                                                 └──────────────┘
```

**Sequence:**
1. Multiple domains publish failure/anomaly events
2. `operations-ctrl` detects and classifies incident (SEV-1 through SEV-5)
3. Automatic containment: circuit breakers, execution pause, agent disable
4. Stabilization workflows: reconnect streams, snapshot import, model revert
5. Human oversight via `operations-bff` dashboards
6. Operator approves recovery → `INCIDENT_RESOLVED`, `CIRCUIT_BREAKER_RESET`

### 4.4 User Onboarding Flow

```
┌──────────────┐  USER_REGISTERED (internal)  ┌──────────────┐
│  identity     │ ──────────────────────────► │  identity     │
│  -web         │                             │  -bff         │
│               │                             │               │
│  Cognito      │                             │  Creates      │
│  federation   │                             │  UserProfile  │
└──────────────┘                              └───────┬───────┘
                                                      │
                                    User answers      │
                                    onboarding Qs     │
                                    via GraphQL       │
                                                      ▼
                                              ONBOARDING_ANSWER_RECORDED (×N)
                                              GOAL_SET
                                              RISK_PROFILE_SET
                                              OPERATING_MODE_SELECTED
                                              MANDATE_GRANTED
                                              ONBOARDING_COMPLETED
                                                      │
                                ┌──────────────────────┼──────────────────────┐
                                ▼                      ▼                      ▼
                        ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
                        │  compliance   │       │  advisory     │       │  notification │
                        │  -ctrl        │       │  -ctrl        │       │  -ctrl        │
                        │               │       │               │       │               │
                        │  Stores       │       │  Triggers     │       │  Sends        │
                        │  guardrail    │       │  initial      │       │  welcome      │
                        │  policy       │       │  portfolio    │       │  message      │
                        └──────────────┘       │  assessment   │       └──────────────┘
                                               └──────────────┘
```

**Sequence:**
1. User registers via `identity-web` (Cognito) → `USER_REGISTERED`
2. `identity-bff` creates initial UserProfile, serves onboarding conversation via GraphQL
3. Onboarding answers recorded → goal set → risk profile set → mode selected → mandate granted
4. `ONBOARDING_COMPLETED` triggers downstream:
   - `compliance-ctrl` stores guardrail policy for this user's mode
   - `advisory-ctrl` may trigger initial portfolio assessment workflow
   - `notification-ctrl` sends welcome notification

### 4.5 Deposit & Withdrawal Flow

```
┌──────────────┐  DEPOSIT_INITIATED             ┌──────────────┐
│  identity     │  (user requests deposit         │  notification │
│  -bff         │   via UI — bank transfer        │  -ctrl        │
│               │   instructions shown)           │               │
│               │ ──────────────────────────────► │  Sends        │
│               │                                 │  "Deposit     │
└──────────────┘                                  │   pending"    │
                                                  └──────────────┘
┌──────────────┐  PORTFOLIO_SNAPSHOT_IMPORTED     ┌──────────────┐
│  execution    │  (periodic IBKR sync detects    │  execution    │
│  -adpt        │   new cash)                     │  -adpt        │
│               │ ─── cash diff detected ───────► │               │
│               │                                 │  DEPOSIT_     │
│               │                                 │  DETECTED     │
└──────────────┘                                  └───────┬───────┘
                                                          │
                          ┌───────────────────────────────┤
                          ▼                               ▼
                  ┌──────────────┐               ┌──────────────┐
                  │  advisory     │               │  notification │
                  │  -ctrl        │               │  -ctrl        │
                  │               │               │               │
                  │  Triggers     │               │  Sends        │
                  │  investment   │               │  "Deposit     │
                  │  assessment   │               │   received"   │
                  └──────────────┘               └──────────────┘

--- Withdrawal ---

┌──────────────┐  WITHDRAWAL_REQUESTED           ┌──────────────┐
│  identity     │ ──────────────────────────────► │  execution    │
│  -bff         │                                 │  -adpt        │
│  (user        │                                 │               │
│   requests)   │                                 │  Submits to   │
└──────────────┘                                  │  IBKR         │
                                                  └───────┬───────┘
                                                          │
                                   WITHDRAWAL_COMPLETED    │  (or WITHDRAWAL_REJECTED)
                                                          ▼
                                                  ┌──────────────┐
                                                  │  identity     │
                                                  │  -bff         │
                                                  │  (updates     │
                                                  │   request     │
                                                  │   status)     │
                                                  └──────────────┘
```

**Deposit Sequence:**
1. User initiates deposit via `identity-bff` → receives bank transfer instructions → `DEPOSIT_INITIATED`
2. `notification-ctrl` sends "Deposit pending" notification
3. `execution-adpt` detects new cash via periodic IBKR snapshot diff → `DEPOSIT_DETECTED`
4. `advisory-ctrl` triggers portfolio assessment (how to invest new funds)
5. `notification-ctrl` sends "Deposit received" notification
6. Normal decision lifecycle proceeds for investment of new cash

**Withdrawal Sequence:**
1. User requests withdrawal via `identity-bff` → `WITHDRAWAL_REQUESTED` (Level 3: user-exclusive action)
2. `execution-adpt` submits withdrawal to IBKR → `WITHDRAWAL_SUBMITTED`
3. IBKR processes → `WITHDRAWAL_COMPLETED` or `WITHDRAWAL_REJECTED`
4. `identity-bff` updates request status; `notification-ctrl` notifies user

### 4.6 Account Closure & Deletion Flow

```
┌──────────────┐  ACCOUNT_CLOSURE_REQUESTED      ┌──────────────┐
│  identity     │ ──────────────────────────────► │  execution    │
│  -bff         │                                 │  -ctrl        │
│               │                                 │               │
│  User         │                                 │  Halts all    │
│  confirms     │                                 │  execution    │
└──────────────┘                                  └──────────────┘
       │
       ├──────────────────────────────────────────►  notification-ctrl
       │                                             (sends closure
       │                                              confirmation)
       ▼
  MANDATE_REVOKED
  BROKER_AUTHORIZATION_REVOKED
  ACCOUNT_CLOSED
```

**Sequence:**
1. User requests account closure via `identity-bff` → `ACCOUNT_CLOSURE_REQUESTED`
2. `execution-ctrl` halts all pending orders and staged executions
3. `identity-bff` revokes mandate → `MANDATE_REVOKED`
4. Broker authorization revoked → `BROKER_AUTHORIZATION_REVOKED`
5. `notification-ctrl` sends closure confirmation
6. `ACCOUNT_CLOSED` emitted. Portfolio remains visible read-only; holdings stay in IBKR.
7. If GDPR deletion requested: `USER_DELETION_REQUESTED` → PII removed, audit data anonymized per retention policy

---

## 5. Monorepo Layout

```
/
├── services/
│   ├── identity/
│   │   ├── identity-web/                        # Cognito, CloudFront, Route53
│   │   └── identity-bff/                        # User profiles, goals, mandates, onboarding
│   │
│   ├── advisory/
│   │   ├── advisory-ctrl/                       # Decision lifecycle + agent invocation orchestration
│   │   └── advisory-bff/                        # Recommendations & explanations UI
│   │
│   ├── compliance/
│   │   ├── compliance-ctrl/                     # Guardrail validation workflows
│   │   └── compliance-bff/                      # Audit trail & compliance dashboard
│   │
│   ├── execution/
│   │   ├── execution-ctrl/                      # Order lifecycle orchestration
│   │   └── execution-adpt/                      # IBKR adapter (orders, snapshots, streaming)
│   │
│   ├── portfolio/
│   │   ├── portfolio-bff/                       # Portfolio dashboard & projections
│   │   └── portfolio-ctrl/                      # Reconciliation workflows
│   │
│   ├── notification/
│   │   ├── notification-ctrl/                   # Message routing & delivery
│   │   └── notification-bff/                    # User notification inbox
│   │
│   └── operations/
│       ├── operations-ctrl/                     # Incident lifecycle, model promotion, cost governance
│       └── operations-bff/                      # Ops dashboards, model registry, shadow reports
│
├── libs/
│   ├── domain-core/
│   │   ├── identity/
│   │   │   ├── events.ts                        # USER_REGISTERED, GOAL_SET, MANDATE_GRANTED, ...
│   │   │   └── models.ts                        # User, Session, UserProfile, Goal, RiskProfile, ...
│   │   ├── advisory/
│   │   │   ├── events.ts                        # DECISION_PACKET_CREATED, RECOMMENDATION_PROPOSED, ...
│   │   │   └── models.ts                        # ContextBundle, AgentInvocation, DecisionPacket, ...
│   │   ├── compliance/
│   │   │   ├── events.ts                        # DECISION_APPROVED, DECISION_BLOCKED, ...
│   │   │   └── models.ts                        # ComplianceCheck, GuardrailPolicy, ...
│   │   ├── execution/
│   │   │   ├── events.ts                        # ORDER_SUBMITTED, ORDER_FILLED, ...
│   │   │   └── models.ts                        # Order, BrokerSession, ...
│   │   ├── portfolio/
│   │   │   ├── events.ts                        # PORTFOLIO_DRIFT_DETECTED, ...
│   │   │   └── models.ts                        # Portfolio, Position, CashBalance, ...
│   │   ├── notification/
│   │   │   ├── events.ts                        # NOTIFICATION_CREATED, ...
│   │   │   └── models.ts                        # Notification, NotificationPolicy, ...
│   │   ├── operations/
│   │   │   ├── events.ts                        # INCIDENT_DETECTED, MODEL_PROMOTED, EVENT_DELIVERY_FAILED, ...
│   │   │   └── models.ts                        # Incident, Alert, ModelVersion, PromotionRequest, ...
│   │   └── shared/
│   │       └── types.ts                         # BusEvent, TenantContext, EditEvent, ...
│   │
│   ├── lambda-utils/
│   │   ├── bus.ts                               # EventBridge abstraction
│   │   ├── pipe.ts                              # Highland.js pipe interface
│   │   ├── unit-of-work.ts                      # Event context wrapper
│   │   ├── errors.ts                            # Error handling patterns
│   │   ├── repositories/
│   │   │   ├── table.repository.ts
│   │   │   ├── gql.repository.ts
│   │   │   └── bucket.repository.ts
│   │   └── core.ts                              # Core types & utilities
│   │
│   └── cdk-constructs/
│       ├── default-lambda-props.ts
│       ├── datadog-instrumentation.ts
│       ├── replicable-table.ts
│       ├── replicable-bucket.ts
│       └── event-hub.ts                         # EventBridge bus, routing rules, archive, schema registry, DLQ
```

---

## 6. Event Subscription Matrix

Rows = subscribing domain. Columns = producing domain. Cells = events consumed.

| Subscribing Domain | identity | advisory | compliance | execution | portfolio | notification | operations |
|---|---|---|---|---|---|---|---|
| **identity** | — | | | DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED | | | |
| **advisory** | GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED | — | DECISION_APPROVED, DECISION_BLOCKED | ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED | PORTFOLIO_DRIFT_DETECTED | | |
| **compliance** | MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_CHANGED | DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED | — | | | | |
| **execution** | WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED | USER_CONFIRMED | DECISION_APPROVED | — | RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED | | CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET |
| **portfolio** | | | | ORDER_FILLED, ORDER_PARTIALLY_FILLED, PORTFOLIO_SNAPSHOT_IMPORTED | — | | |
| **notification** | DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED | DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED | DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED | ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_STAGED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED | CORPORATE_ACTION_APPLIED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED | — | CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED |
| **operations** | | AGENT_EXECUTION_FAILED, DECISION_PACKET_CREATED | GUARDRAIL_VIOLATION_DETECTED, SUITABILITY_CHECK_FAILED | BROKER_SESSION_LOST, STREAM_DISCONNECTED, ORDER_REJECTED | PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED | | — |

---

## Verification Checklist

- [x] **Every entity from spec 2 mapped to exactly one domain**: User/Goals/Risk Profile → identity, Market/Research/Portfolio Construction/Rebalance Planner/Recommendation/Explainability/Orchestrator → advisory, Compliance Agent → compliance, Execution Agent → execution, Positions/Ledger/Reconciliation Agent → portfolio, Model Registry/Promotion → operations
- [x] **Every domain has at least one microservice**: Exactly 2 per domain (14 total)
- [x] **All events follow SCREAMING_SNAKE_CASE**: Confirmed across all 7 domains
- [x] **All events follow BusEvent structure**: id, type, timestamp, subject, context
- [x] **No shared databases**: Each service owns its own DynamoDB tables; cross-domain data only via events
- [x] **IBKR integration consolidated in execution domain**: `execution-adpt` handles all broker communication (orders, snapshots, streaming, sessions)
- [x] **Reconciliation consolidated in portfolio domain**: `portfolio-ctrl` manages all reconciliation workflows
- [x] **Each domain owns its projections**: Portfolio projections in portfolio-bff, compliance projections in compliance-bff, recommendation projections in advisory-bff, ops dashboards in operations-bff
- [x] **Platform infrastructure dissolved into shared CDK construct**: `libs/cdk-constructs/event-hub.ts` owns EventBridge bus, routing, archive, schema registry, DLQ
- [x] **Decision lifecycle consolidated in advisory domain**: Context assembly, agent invocation, and packet composition in a single Step Functions state machine — no cross-domain ping-pong
- [x] **All 6 spec 2 agents mapped**: User & Goals, Risk, Market & Research, Portfolio Construction, Rebalance Planner, Recommendation & Explainability — async in advisory-ctrl, conversational in identity-bff/advisory-bff. All via Amazon AgentCore.
- [x] **Agent hosting rule**: BFF = conversational (user in the loop), controller = async (event-driven). Dual-hosted agents share definition, differ in runtime context.
- [x] **RAG-first knowledge access**: All agent-hosting services maintain per-service Bedrock Knowledge Bases fed by domain events. Agents query local KBs via RAG at inference time. MCP servers used only as rare exceptions for real-time data freshness.
