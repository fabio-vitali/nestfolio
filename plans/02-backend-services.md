# 02 -- Backend Services: All 14 Services, Event Flows, Implementation Order

Detailed implementation plan for all 14 Nestfolio backend services. Covers service inventory, phased build order for a solo developer, per-service implementation details, cross-domain event flows, CQRS/event sourcing patterns, multi-tenancy, and phased scope.

> **Audience**: Solo developer building with AI assistance
> **Tech Stack**: Nx v20+, Node.js 22 LTS, TypeScript 5.x, pnpm, AWS CDK v2
> **Scope**: Phase 1 (Foundation) through Phase 5 (Observability). See [00-master-plan.md](./00-master-plan.md) for phase definitions.

---

## 1. Service Inventory Summary

| # | Service | Domain | Type | Responsibilities | Phase | Initial Vertical Slice |
|---|---|---|---|---|---|---|
| 1 | `investor-hub` | Investor | Hub | EventBridge bus, archive, forwarding to Advisory + Execution | 1 | FULL |
| 2 | `investor-web` | Investor | Web | Cognito User Pool, CloudFront, static assets, auth Lambda triggers | 1 | FULL |
| 3 | `investor-bff` | Investor | BFF | InvestorProfile aggregate (goals, risk, mandate, mode), onboarding, notifications inbox, deposit/withdrawal | 1 | FULL |
| 4 | `investor-ctrl` | Investor | CTRL | Notification pipeline (Step Functions): classify, resolve policy, template, route, deliver | 2 | One complete notification pipeline flow (classify -> resolve -> template -> deliver in-app) |
| 5 | `advisory-hub` | Advisory | Hub | EventBridge bus, archive, forwarding to Investor + Execution | 1 | FULL |
| 6 | `advisory-ctrl` | Advisory | CTRL | Decision lifecycle (LangGraph.js): 6-agent orchestration, Decision Packet, compliance handoff, user confirmation | 3 | FULL |
| 7 | `compliance-ctrl` | Advisory | CTRL | Compliance check pipeline (Step Functions): mandate validation, guardrails, suitability, approve/block | 3 | FULL |
| 8 | `operations-ctrl` | Advisory | CTRL | 3 workflows: incident lifecycle, model promotion, cost governance | 5 | One complete operations workflow (incident lifecycle: detect -> classify -> contain -> resolve) |
| 9 | `advisory-bff` | Advisory | BFF | Recommendations, explanations, "why" views, compliance dashboard, ops dashboard | 4 | Full recommendation projection + "Why?" view |
| 10 | `execution-hub` | Execution | Hub | EventBridge bus, archive, forwarding to Investor + Advisory | 1 | FULL |
| 11 | `execution-ctrl` | Execution | CTRL | Order lifecycle (Step Functions): safety checks, market hours, submit/stage, monitor fills | 2 | One complete order lifecycle (receive approved decision -> safety checks -> submit -> monitor fill callback) |
| 12 | `execution-adpt` | Execution | ADPT | Phase 2: simulation engine (virtual ledger, virtual cash, simulated fills). Later: IBKR anti-corruption layer (orders, snapshots, sessions, deposits, withdrawals) | 2+ | FULL |
| 13 | `portfolio-bff` | Execution | BFF | Portfolio dashboard, positions, performance, real-time subscriptions | 4 | Full dashboard projection (positions, cash, performance from event stream) |
| 14 | `portfolio-ctrl` | Execution | CTRL | Reconciliation pipeline (Step Functions): compare, detect drift, lock, correct, release | 2 | One complete reconciliation pipeline (compare intent vs settlement -> detect drift -> lock -> correct -> release) |

**Domain breakdown**: Investor (4), Advisory (5), Execution (5)

---

## 2. Implementation Order -- Solo Developer Phased Build

### Guiding Principles

1. **Vertical slices first** -- deliver end-to-end user flows as early as possible, even if components are stubbed
2. **Hub infrastructure before domain services** -- buses must exist before any event publishing
3. **BFF before CTRL** -- the command side (user-facing mutations) must publish events before controllers can consume them
4. **Simulation before live** -- Phase 2 builds the simulation engine (virtual ledger, virtual cash, simulated fills) that doubles as the user-facing Simulation Mode; later phases add the real IBKR adapter
5. **Defer operations tooling** -- `operations-ctrl` and internal dashboards can wait until the core flow works

### Phase 1-2: Foundation + Core Domain

**Goal**: Complete decision lifecycle flow (goal change -> advisory -> compliance -> execution -> portfolio update) with the simulation engine (virtual ledger, virtual cash, simulated fills at market prices).

#### Wave 0: Foundation (Phase 1, covered in 01-foundation.md)

All shared libraries (`cdk-constructs`, `lambda-utils`, `domain-core`) and the 3 hub stacks.

#### Wave 1: Investor Identity + Profile

| Service | What to Build | Stub? |
|---|---|---|
| `investor-web` | Cognito User Pool, PostAuth Lambda trigger publishing `USER_REGISTERED` | No |
| `investor-bff` | InvestorProfile aggregate, onboarding mutations (goal, risk, mandate, mode), AppSync schema | No |

**Delivers**: User can register, complete onboarding, set goals and risk profile. Events flow to investor-hub.

#### Wave 2: Advisory Core

| Service | What to Build | Stub? |
|---|---|---|
| `advisory-ctrl` | LangGraph StateGraph orchestration in a single Lambda, consume investor intent events, invoke agents (initially stubbed with hardcoded responses), produce `DECISION_PACKET_CREATED` | Agents stubbed |
| `compliance-ctrl` | Step Functions compliance check, consume `DECISION_PACKET_CREATED`, produce `DECISION_APPROVED`/`DECISION_BLOCKED` | Simplified rules |

**Delivers**: Investor intent changes trigger advisory flow. Decision Packets are created and compliance-checked. The AI agents use hardcoded/template responses initially -- the AI agent plan (03-ai-agent-system.md) covers replacing stubs with real LLM calls.

#### Wave 3: Execution Core

| Service | What to Build | Stub? |
|---|---|---|
| `execution-ctrl` | Step Functions order lifecycle, consume `DECISION_APPROVED`, produce `ORDER_SUBMITTED` | No |
| `execution-adpt` | **Simulation engine** -- consumes `ORDER_SUBMITTED`, maintains virtual position ledger and virtual cash balance, produces simulated fills at real market prices (`ORDER_FILLED`, `PORTFOLIO_SNAPSHOT_IMPORTED`). This is the same engine that powers user-facing Simulation Mode, not a throwaway mock. | Simulated broker |
| `portfolio-bff` | Portfolio projection, consume fills and snapshots, AppSync schema for dashboard | No |
| `portfolio-ctrl` | Reconciliation pipeline (simplified), drift detection | Simplified |

**Delivers**: End-to-end flow works. Approved decisions become orders, the simulation engine fills them against virtual positions and cash, and portfolio projections update accordingly. The dashboard shows simulated portfolio state.

#### Wave 4: Notifications + Advisory UI

| Service | What to Build | Stub? |
|---|---|---|
| `investor-ctrl` | Notification pipeline Step Functions, consume cross-domain events, produce `NOTIFICATION_CREATED` | No |
| `advisory-bff` | Recommendation/explanation projections, "why" view, confirmation flow, AppSync schema | No |

**Delivers**: Users receive notifications for decision outcomes and order fills. Advisory BFF serves recommendations and explanations.

#### Services Deferred Beyond Phase 2

| Service | Reason | Deferred Until |
|---|---|---|
| `operations-ctrl` | Operational tooling -- not needed for core flow validation | Phase 5 (Observability) |
| `execution-adpt` (real IBKR) | No IBKR integration in Phase 2 | Post-Phase 5; simulation engine handles all broker interactions via virtual ledger, virtual cash, and simulated fills |

### Phase 3-5: AI Agent System, Frontend, Observability

**Goal**: Add the AgentCore Runtime, frontend applications, real IBKR paper trading adapter, and operations monitoring.

#### Wave 5: Real Broker Integration

| Service | What to Build |
|---|---|
| `execution-adpt` (real) | IBKR REST API integration, streaming feeds, webhook handlers, session management, Secrets Manager credentials |
| `portfolio-ctrl` (enhanced) | Full reconciliation: post-execution, hourly, daily, startup schedules |

#### Wave 6: Operations (Phase 5)

| Service | What to Build |
|---|---|
| `operations-ctrl` | 3 Step Functions workflows: incident lifecycle, model promotion, cost governance |
| `advisory-bff` (enhanced) | Operations dashboard panels, incident history, model registry |

---

## 3. Per-Service Implementation Details

### 3.1 investor-hub

**Type**: Event Hub | **CDK Constructs**: None (pure infrastructure)

No State, Ingress, Egress, or Facade. This is a CDK-only stack containing the EventBridge bus, archive, and forwarding rules.

**CDK Resources**:
- EventBridge bus: `investor-hub`
- EventBridge archive: `investor-archive` (365-day retention)
- 2 forwarding rules (routes 1-2 from cross-domain matrix)

**Lambda handlers**: None

---

### 3.2 investor-web

**Type**: Web | **CDK Constructs**: Facade (CloudFront), partially custom

**CDK Resources**:
- Cognito User Pool with Google/Facebook federation
- Cognito custom attribute: `tenant_id` (immutable)
- Lambda triggers: PostAuthentication, PostConfirmation
- CloudFront distribution + S3 origin (static assets)
- Route53 hosted zone

**DynamoDB**: None (Cognito manages user data)

**Lambda Handlers**:

| Handler | Trigger | Responsibility |
|---|---|---|
| `post-confirmation` | Cognito PostConfirmation | Publish `USER_REGISTERED` with generated `tenant_id` |
| `post-authentication` | Cognito PostAuthentication | Publish `USER_AUTHENTICATED`, refresh session metadata |

**Events Published**: `USER_REGISTERED`, `USER_AUTHENTICATED`, `USER_SESSION_EXPIRED`, `USER_DELETION_REQUESTED`, `PII_REMOVED`, `TENANT_ANONYMIZED`

**Events Consumed**: None

---

### 3.3 investor-bff

**Type**: BFF | **CDK Constructs**: State, Ingress, Egress, Facade

This is the most feature-rich BFF -- it owns the InvestorProfile aggregate (event-sourced) and the notification inbox projection.

**DynamoDB Table Design**:

| Entity | PK | SK | Notes |
|---|---|---|---|
| InvestorProfile | `InvestorProfile#{tid}#{uid}` | `InvestorProfile` | Main aggregate |
| EditEvent | `InvestorProfile#{tid}#{uid}` | `EditEvent#{ts}#{uuid}` | Mutation history |
| Goal | `InvestorProfile#{tid}#{uid}` | `Goal#{goalId}` | Related entity |
| RiskProfile | `InvestorProfile#{tid}#{uid}` | `RiskProfile` | Singleton per profile |
| Mandate | `InvestorProfile#{tid}#{uid}` | `Mandate` | Singleton per profile |
| OperatingMode | `InvestorProfile#{tid}#{uid}` | `OperatingMode` | Singleton per profile |
| Notification | `InvestorProfile#{tid}#{uid}` | `Notification#{nid}` | Inbox projection |

**GSIs**: Standard `tenantId-index` + `typename-timestamp-index`

**Lambda Handlers**:

| Handler | Trigger | Responsibility |
|---|---|---|
| `event-listener` | SQS (from Ingress) | Process `USER_REGISTERED`, `NOTIFICATION_CREATED`, cross-domain deposit/withdrawal events |
| `event-publisher` | DynamoDB Streams (from Egress) | Publish `GOAL_UPDATED`, `MANDATE_GRANTED`, etc. to investor-hub |
| `graphql-resolver` | AppSync | CRUD operations: onboarding, profile, goals, mandate, deposit, withdrawal, notifications |

**Event Pipes (event-listener)**:
- `user-registered.pipe.ts` -- Create InvestorProfile skeleton
- `notification-created.pipe.ts` -- Materialize notification into inbox
- `deposit-detected.pipe.ts` -- Update deposit status
- `withdrawal-completed.pipe.ts` -- Update withdrawal status

**AppSync Schema Highlights**:

```graphql
type Query {
  getProfile: InvestorProfile!
  getGoals: [Goal!]!
  getNotifications(limit: Int, cursor: String): NotificationConnection!
  getUnreadCount: Int!
}

type Mutation {
  recordOnboardingAnswer(input: OnboardingAnswerInput!): OnboardingStep!
  setGoal(input: GoalInput!): Goal!
  updateGoal(goalId: ID!, input: GoalInput!): Goal!
  setRiskProfile(input: RiskProfileInput!): RiskProfile!
  grantMandate(input: MandateInput!): Mandate!
  updateMandate(input: MandateInput!): Mandate!
  revokeMandate: Mandate!
  selectOperatingMode(mode: OperatingMode!): OperatingModeResult!
  initiateDeposit(input: DepositInput!): DepositIntent!
  requestWithdrawal(input: WithdrawalInput!): WithdrawalRequest!
  requestAccountClosure: ClosureRequest!
  markNotificationRead(notificationId: ID!): Notification!
}

type Subscription {
  onNotification: Notification!
}
```

**Events Published**: `ONBOARDING_ANSWER_RECORDED`, `ONBOARDING_COMPLETED`, `GOAL_SET`, `GOAL_UPDATED`, `RISK_PROFILE_SET`, `RISK_PROFILE_UPDATED`, `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED`, `OPERATING_MODE_SELECTED`, `OPERATING_MODE_CHANGED`, `DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED`, `ACCOUNT_CLOSED`, `NOTIFICATION_READ`

**Events Consumed**:
- Intra-domain: `USER_REGISTERED` (investor-web), `NOTIFICATION_CREATED` (investor-ctrl)
- Cross-domain: `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED` (execution-hub)

**AI Agents** (covered in 03-ai-agent-system.md): User & Goals Agent (onboarding), Risk Agent (risk questionnaire). Initially stubbed with template responses; replaced with real AgentCore Runtime calls in Phase 3.

---

### 3.4 investor-ctrl

**Type**: CTRL | **CDK Constructs**: State, Ingress, Egress (no Facade)

Notification pipeline orchestrated by Step Functions.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| Notification | `Notification#{tid}#{nid}` | `Notification` |
| DeliveryAttempt | `Notification#{tid}#{nid}` | `DeliveryAttempt#{ts}` |
| NotificationPolicy | `NotificationPolicy#{tid}#{uid}` | `NotificationPolicy` |
| ChannelPreference | `NotificationPolicy#{tid}#{uid}` | `Channel#{channelType}` |

**Step Functions Workflow: Notification Pipeline**

```
StartState
  -> ClassifyImpact (Lambda: determine severity tier 1-5)
  -> ResolvePolicy (Lambda: load user notification preferences)
  -> SelectTemplate (Lambda: choose template, locale)
  -> RouteChannels (Parallel branches per channel: push, email, in-app)
    -> DeliverPush (Lambda: SNS/FCM)
    -> DeliverEmail (Lambda: SES)
    -> DeliverInApp (Lambda: write to investor-bff inbox)
  -> RecordOutcome (Lambda: write delivery status)
  -> PublishEvent (Lambda: emit NOTIFICATION_CREATED / NOTIFICATION_SENT)
```

**Lambda Handlers**:

| Handler | Trigger | Responsibility |
|---|---|---|
| `event-listener` | SQS (from Ingress) | Receive trigger events, start Step Functions execution |
| `event-publisher` | DynamoDB Streams | Publish `NOTIFICATION_CREATED`, `NOTIFICATION_SENT` |
| `classify-impact` | Step Functions | Map event type to severity tier |
| `resolve-policy` | Step Functions | Load user preferences from DynamoDB |
| `select-template` | Step Functions | Template lookup by event type + locale |
| `deliver-push` | Step Functions | SNS/FCM delivery |
| `deliver-email` | Step Functions | SES delivery |
| `deliver-inapp` | Step Functions | Write notification to investor-bff projection |
| `record-outcome` | Step Functions | Persist delivery status |

**Events Published**: `NOTIFICATION_CREATED`, `NOTIFICATION_SENT`, `NOTIFICATION_DELIVERED`, `MONTHLY_REPORT_GENERATED`

**Events Consumed**:
- Intra-domain: `DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`, `ACCOUNT_CLOSURE_REQUESTED`
- Cross-domain (advisory-hub): `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED`
- Cross-domain (execution-hub): `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_STAGED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `CORPORATE_ACTION_APPLIED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED`

---

### 3.5 advisory-hub

**Type**: Event Hub | **CDK Constructs**: None (pure infrastructure)

Identical pattern to investor-hub.

**CDK Resources**:
- EventBridge bus: `advisory-hub`
- EventBridge archive: `advisory-archive` (365-day retention)
- 2 forwarding rules (routes 3-4)

**Forwarding Rules**:

| Target | Events |
|---|---|
| investor-hub | `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ESCALATION_TRIGGERED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`, `INCIDENT_DETECTED`, `INCIDENT_RESOLVED` |
| execution-hub | `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET` |

---

### 3.6 advisory-ctrl

**Type**: CTRL | **CDK Constructs**: State, Ingress, Egress (no Facade)

The most complex service -- orchestrates the 6-agent decision lifecycle. The event-listener Lambda receives trigger events (investor intent or execution events), composes the required context (investor profile, portfolio state, market data), and invokes the **AgentCore Runtime endpoint**. The AgentCore Runtime is a containerized LangGraph agent (see [03-ai-agent-system.md](./03-ai-agent-system.md) for full CDK details) that runs the complete decision lifecycle and returns a Decision Packet. The event-listener Lambda then persists the Decision Packet to DynamoDB and publishes `DECISION_PACKET_CREATED`. Compliance is **not** part of this service; after the Decision Packet is created, the compliance check happens in `compliance-ctrl` (a separate service). Compliance callback handlers remain as separate Lambda handlers within advisory-ctrl.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| DecisionPacket | `DecisionPacket#{tid}#{dpid}` | `DecisionPacket` |
| AgentInvocation | `DecisionPacket#{tid}#{dpid}` | `AgentInvocation#{step}#{agentName}` |
| ReasoningOutput | `DecisionPacket#{tid}#{dpid}` | `ReasoningOutput#{agentName}` |
| WorkflowState | `Workflow#{tid}#{wfid}` | `WorkflowState` |
| EditEvent | `DecisionPacket#{tid}#{dpid}` | `EditEvent#{ts}#{uuid}` |

**Decision Lifecycle Flow**

The event-listener Lambda composes context and delegates the decision lifecycle to the AgentCore Runtime (containerized LangGraph agent). See [03-ai-agent-system.md](./03-ai-agent-system.md) for full AgentCore CDK and runtime details.

```
event-listener receives trigger (investor intent or execution event)
  -> Compose context: gather investor profile, portfolio state, market data
  -> Invoke AgentCore Runtime endpoint with context payload
  -> AgentCore Runtime runs LangGraph StateGraph:
     1. InvokeUserGoalsAgent (interpret goals -- may skip if cached)
     2. InvokeRiskAgent (evaluate risk -- may skip if cached)
     3. InvokeMarketResearchAgent (detect market signals)
     4. InvokePortfolioConstructionAgent (propose target allocation)
     5. InvokeRebalancePlannerAgent (generate trade plan)
     6. InvokeRecommendationAgent (synthesize recommendation + explanation)
     7. ComposeDecisionPacket (assemble all outputs)
  -> AgentCore Runtime returns Decision Packet to event-listener
  -> event-listener persists Decision Packet to DynamoDB
  -> DynamoDB Stream triggers egress -> publishes DECISION_PACKET_CREATED
  -> compliance-ctrl (separate service) consumes DECISION_PACKET_CREATED, runs compliance check
  -> Compliance callback handlers (separate Lambdas): receive DECISION_APPROVED / DECISION_BLOCKED from compliance-ctrl
    -> [DECISION_APPROVED]
      -> CheckAuthorityLevel
        -> [L1] PublishToExecution
        -> [L2] RequestUserConfirmation -> WaitForUserResponse (async event)
          -> [USER_CONFIRMED] PublishToExecution
          -> [USER_REJECTED] ArchiveDecision
    -> [DECISION_BLOCKED]
      -> CompensateDecision (SAGA: rollback, archive)
```

**Lambda Handlers**:

| Handler | Trigger | Responsibility |
|---|---|---|
| `event-listener` | SQS | Receive trigger events, compose context, invoke AgentCore Runtime endpoint, persist Decision Packet |
| `event-publisher` | DynamoDB Streams | Publish advisory domain events |
| `handle-compliance-callback` | SQS | Process DECISION_APPROVED / DECISION_BLOCKED from compliance-ctrl (separate service), route to execution or archive |
| `handle-user-response` | SQS | Process USER_CONFIRMED / USER_REJECTED |

**Events Published**: `AGENT_INVOCATION_STARTED`, `AGENT_INVOCATION_COMPLETED`, `AGENT_EXECUTION_FAILED`, `GOAL_INTERPRETATION_PRODUCED`, `RISK_EVALUATION_PRODUCED`, `MARKET_SIGNAL_DETECTED`, `PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`, `RECOMMENDATION_PROPOSED`, `EXPLANATION_GENERATED`, `DECISION_PACKET_CREATED`, `DECISION_PACKET_ENRICHED`, `USER_CONFIRMATION_REQUESTED`, `USER_CONFIRMED`, `USER_REJECTED`

**Events Consumed**:
- Intra-domain: `DECISION_APPROVED`, `DECISION_BLOCKED` (compliance-ctrl)
- Cross-domain (investor-hub): `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`
- Cross-domain (execution-hub): `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `PORTFOLIO_DRIFT_DETECTED`

---

### 3.7 compliance-ctrl

**Type**: CTRL | **CDK Constructs**: State, Ingress, Egress (no Facade)

Separate deployable unit per regulatory requirements. Own IAM role, own DynamoDB table.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| ComplianceCheck | `ComplianceCheck#{tid}#{ccid}` | `ComplianceCheck` |
| GuardrailPolicy | `GuardrailPolicy#{tid}#{uid}` | `GuardrailPolicy` |
| MandateSnapshot | `GuardrailPolicy#{tid}#{uid}` | `MandateSnapshot` |
| AuditArtifact | `ComplianceCheck#{tid}#{ccid}` | `AuditArtifact#{aaid}` |

**Step Functions Workflow: Compliance Check**

```
StartState (triggered by DECISION_PACKET_CREATED)
  -> LoadMandateAndGuardrails (Lambda)
  -> ValidateMandate (Lambda: check decision within mandate scope)
  -> EvaluateGuardrails (Lambda: risk band, max trade size, turnover, concentration)
  -> CheckSuitability (Lambda: risk profile vs proposed actions)
  -> DetermineAuthorityLevel (Lambda: L1 autonomous or L2 confirmation)
  -> Choice
    -> [All Pass] PublishDecisionApproved
    -> [Violation] PublishDecisionBlocked + CreateAuditArtifact
```

**Events Published**: `DECISION_APPROVED`, `DECISION_BLOCKED`, `GUARDRAIL_VIOLATION_DETECTED`, `ESCALATION_TRIGGERED`, `COMPLIANCE_APPROVAL_GRANTED`, `AUDIT_ARTIFACT_CREATED`, `SUITABILITY_CHECK_PASSED`, `SUITABILITY_CHECK_FAILED`

**Events Consumed**:
- Intra-domain: `DECISION_PACKET_CREATED`, `DECISION_PACKET_ENRICHED`
- Cross-domain (investor-hub): `MANDATE_GRANTED`, `MANDATE_UPDATED`, `MANDATE_REVOKED`, `OPERATING_MODE_CHANGED`

---

### 3.8 operations-ctrl (Phase 5)

**Type**: CTRL | **CDK Constructs**: State, Ingress, Egress (no Facade)

Three independent Step Functions workflows sharing one DynamoDB table.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| Incident | `Incident#{tid}#{iid}` | `Incident` |
| ContainmentAction | `Incident#{tid}#{iid}` | `ContainmentAction#{caid}` |
| Alert | `Alert#{tid}#{aid}` | `Alert` |
| ModelVersion | `ModelVersion#{mvid}` | `ModelVersion` |
| PromotionRequest | `ModelVersion#{mvid}` | `PromotionRequest#{prid}` |
| ShadowRun | `ShadowRun#{srid}` | `ShadowRun` |
| EvaluationResult | `ShadowRun#{srid}` | `EvaluationResult#{erid}` |
| CostBudget | `CostBudget#{tid}` | `CostBudget` |

**Workflow 1: Incident Lifecycle**

```
DetectIncident -> ClassifySeverity(SEV-1..SEV-5)
  -> AutoContain (circuit breaker, execution pause)
  -> Stabilize (retry/recover)
  -> HumanReviewGate (wait for operator via advisory-bff)
  -> Resolve -> PublishIncidentResolved
```

**Workflow 2: Model Promotion**

```
RegisterModel -> OfflineEvaluation -> ShadowMode
  -> CompareResults -> ApprovalGate
  -> Promote / Rollback
```

**Workflow 3: Cost Governance**

```
MonitorBudget -> ThresholdCheck
  -> AdjustReasoningTier / Throttle
  -> Notify
```

**Events Published**: Incident events, circuit breaker events, health checks, model lifecycle events, cost governance events, operator actions, telemetry

**Events Consumed**:
- Intra-domain: `AGENT_EXECUTION_FAILED`, `DECISION_PACKET_CREATED` (shadow), `GUARDRAIL_VIOLATION_DETECTED`, `SUITABILITY_CHECK_FAILED`
- Cross-domain (execution-hub): `BROKER_SESSION_LOST`, `STREAM_DISCONNECTED`, `ORDER_REJECTED`, `PORTFOLIO_DRIFT_DETECTED`, `RECONCILIATION_FAILED`

---

### 3.9 advisory-bff

**Type**: BFF | **CDK Constructs**: State, Ingress, Egress, Facade

Multi-actor BFF serving Investor (recommendations/explanations), Platform Operator, Compliance Reviewer, and AI Governance Reviewer. ABAC-gated per actor type.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| Recommendation | `Recommendation#{tid}#{rid}` | `Recommendation` |
| Explanation | `Recommendation#{tid}#{rid}` | `Explanation` |
| ComplianceRecord | `ComplianceRecord#{tid}#{crid}` | `ComplianceRecord` |
| AuditEntry | `AuditEntry#{tid}#{aeid}` | `AuditEntry` |
| OpsSnapshot | `OpsSnapshot#{date}` | `OpsSnapshot` |
| IncidentSummary | `IncidentSummary#{iid}` | `IncidentSummary` |

**AppSync Schema Highlights**:

```graphql
type Query {
  # Investor-facing
  getRecommendation(id: ID!): Recommendation
  listRecommendations(limit: Int, cursor: String): RecommendationConnection!
  getExplanation(recommendationId: ID!): Explanation
  getSafetyRules: SafetyRules!

  # Operator-facing (ABAC-gated)
  getIncident(id: ID!): Incident
  listIncidents(filter: IncidentFilter): IncidentConnection!
  getSystemHealth: SystemHealth!
  listModelVersions: [ModelVersion!]!

  # Compliance-facing (ABAC-gated)
  getAuditTrail(decisionId: ID!): [AuditEntry!]!
  getComplianceDashboard: ComplianceDashboard!
}

type Mutation {
  confirmDecision(decisionId: ID!): ConfirmationResult!
  rejectDecision(decisionId: ID!, reason: String): ConfirmationResult!
}

type Subscription {
  onRecommendation: Recommendation!
  onExplanationUpdate(recommendationId: ID!): Explanation!
}
```

**Events Published**: `USER_VIEWED_EXPLANATION`

**Events Consumed**: All advisory-ctrl events (recommendations), all compliance-ctrl events (audit), all operations-ctrl events (ops dashboard)

---

### 3.10 execution-hub

**Type**: Event Hub | **CDK Constructs**: None (pure infrastructure)

**CDK Resources**:
- EventBridge bus: `execution-hub`
- EventBridge archive: `execution-archive` (365-day retention)
- 2 forwarding rules (routes 5-6)

**Forwarding Rules**:

| Target | Events |
|---|---|
| investor-hub | `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_STAGED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`, `CORPORATE_ACTION_APPLIED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED` |
| advisory-hub | `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`, `PORTFOLIO_DRIFT_DETECTED`, `BROKER_SESSION_LOST`, `STREAM_DISCONNECTED`, `RECONCILIATION_FAILED` |

---

### 3.11 execution-ctrl

**Type**: CTRL | **CDK Constructs**: State, Ingress, Egress (no Facade)

Single-writer principle: only this service can generate order submission commands.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| Order | `Order#{tid}#{oid}` | `Order` |
| EditEvent | `Order#{tid}#{oid}` | `EditEvent#{ts}#{uuid}` |
| StagedOrder | `StagedOrder#{tid}#{oid}` | `StagedOrder` |
| CoolDown | `CoolDown#{tid}#{instrument}` | `CoolDown` |

**Step Functions Workflow: Order Lifecycle**

```
StartState (triggered by DECISION_APPROVED + USER_CONFIRMED)
  -> PreSubmissionSafetyChecks (Lambda)
    -> CheckReconciliationLock
    -> CheckConflictingStagedOrders
    -> CheckTurnoverLimits
    -> CheckCoolDown
  -> ValidateMarketHours (Lambda)
  -> Choice
    -> [Market Open] SubmitOrder -> PublishOrderSubmitted
    -> [Market Closed] StageOrder -> PublishOrderStaged
       -> WaitForMarketOpen -> RevalidateCompliance -> SubmitOrder
  -> MonitorFills (wait for execution-adpt callback)
  -> EnforceCoolDown (Lambda: set per-instrument cool-down)
```

**Lambda Handlers**:

| Handler | Trigger | Responsibility |
|---|---|---|
| `event-listener` | SQS | Receive approved decisions and circuit breaker events |
| `event-publisher` | DynamoDB Streams | Publish `ORDER_SUBMITTED`, `ORDER_STAGED` |
| `safety-checks` | Step Functions | Pre-submission validation |
| `market-hours` | Step Functions | Check if market is open for target exchange |
| `submit-order` | Step Functions | Create order record, publish submission command |
| `stage-order` | Step Functions | Persist staged order for later submission |
| `handle-fill-callback` | Step Functions (callback) | Process fill/reject from execution-adpt |

**Events Published**: `ORDER_SUBMITTED`, `ORDER_STAGED`, `EXECUTION_PAUSED`, `EXECUTION_RESUMED`

**Events Consumed**:
- Intra-domain: `RECONCILIATION_LOCK_ACQUIRED`, `RECONCILIATION_LOCK_RELEASED` (portfolio-ctrl)
- Cross-domain (advisory-hub): `DECISION_APPROVED`, `USER_CONFIRMED`, `CIRCUIT_BREAKER_TRIGGERED`, `CIRCUIT_BREAKER_RESET`
- Cross-domain (investor-hub): `ACCOUNT_CLOSURE_REQUESTED`

---

### 3.12 execution-adpt

**Type**: ADPT | **CDK Constructs**: State, Ingress, Facade (REST API for webhooks)

Anti-corruption layer for Interactive Brokers. **Phase 2 implements the simulation engine** — a virtual position ledger, virtual cash balance, and simulated fill engine that processes orders at real market prices. This is not a throwaway mock: it is the same engine that powers the user-facing Simulation Mode, where investors experience the platform with virtual money before committing real funds. Later phases add the real IBKR sandbox adapter alongside the simulation engine.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| BrokerSession | `BrokerSession#{tid}#{bsid}` | `BrokerSession` |
| StreamConnection | `BrokerSession#{tid}#{bsid}` | `StreamConnection#{scid}` |
| ApiResponseCache | `ApiCache#{tid}#{endpoint}` | `ApiCache` |
| Deposit | `Deposit#{tid}#{did}` | `Deposit` |
| Withdrawal | `Withdrawal#{tid}#{wid}` | `Withdrawal` |

**Facade**: API Gateway REST API for IBKR webhook callbacks (deferred, post-Phase 5).

**Lambda Handlers**:

| Handler | Trigger | Responsibility |
|---|---|---|
| `event-listener` | SQS | Consume `ORDER_SUBMITTED`, `WITHDRAWAL_REQUESTED` |
| `event-publisher` | DynamoDB Streams | Publish fills, snapshots, session events |
| `webhook-handler` | API Gateway | Receive IBKR webhook callbacks (deferred, post-Phase 5) |
| `snapshot-importer` | EventBridge Scheduler | Periodic IBKR snapshot imports |
| `session-manager` | EventBridge Scheduler | Heartbeat, reconnection |

**Phase 2 — Simulation Engine**: The `event-listener` handler runs the simulation engine, which maintains a virtual position ledger and virtual cash balance per investor:
- `ORDER_SUBMITTED` -> validate against virtual cash/positions -> wait 2-5 seconds (simulated market latency) -> write `ORDER_FILLED` with fill data at real market prices, update virtual ledger and virtual cash balance
- `WITHDRAWAL_REQUESTED` -> validate against virtual cash balance -> wait 1 second -> write `WITHDRAWAL_COMPLETED`, debit virtual cash
- Scheduled snapshot importer generates `PORTFOLIO_SNAPSHOT_IMPORTED` from the virtual ledger state

This engine is production infrastructure: it ships as the user-facing Simulation Mode feature, where new investors can experience the full platform with virtual money.

**Later Phase — Real Broker**: Add IBKR REST API calls, streaming WebSocket connections, and OAuth credential management as a second adapter implementation. The simulation engine remains active for Simulation Mode users; the IBKR adapter handles live/paper trading users. Both adapters share the same event contract.

**Events Published**: `ORDER_ACCEPTED`, `ORDER_PARTIALLY_FILLED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `PORTFOLIO_SNAPSHOT_IMPORTED`, `BROKER_SESSION_ESTABLISHED`, `BROKER_SESSION_LOST`, `STREAM_CONNECTED`, `STREAM_DISCONNECTED`, `DEPOSIT_DETECTED`, `WITHDRAWAL_SUBMITTED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_REJECTED`

**Events Consumed**:
- Intra-domain: `ORDER_SUBMITTED` (execution-ctrl)
- Cross-domain (investor-hub): `WITHDRAWAL_REQUESTED`

---

### 3.13 portfolio-bff

**Type**: BFF | **CDK Constructs**: State, Ingress, Egress, Facade

Portfolio dashboard serving the Investor actor.

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| Portfolio | `Portfolio#{tid}#{pid}` | `Portfolio` |
| Position | `Portfolio#{tid}#{pid}` | `Position#{instrument}` |
| CashBalance | `Portfolio#{tid}#{pid}` | `CashBalance#{currency}` |
| PerformanceMetric | `Portfolio#{tid}#{pid}` | `Performance#{period}` |
| EditEvent | `Portfolio#{tid}#{pid}` | `EditEvent#{ts}#{uuid}` |

**AppSync Schema Highlights**:

```graphql
type Query {
  getPortfolio: Portfolio!
  getPositions: [Position!]!
  getCashBalance: CashBalance!
  getPerformance(period: Period!): PerformanceMetrics!
  getGoalProgress: GoalProgress!
}

type Subscription {
  onPortfolioUpdate: Portfolio!
  onPositionUpdate: Position!
}
```

**Lambda Handlers**:

| Handler | Trigger | Responsibility |
|---|---|---|
| `event-listener` | SQS | Process fills, snapshots, reconciliation events |
| `event-publisher` | DynamoDB Streams | Publish portfolio/position update events (for AppSync subscriptions) |
| `graphql-resolver` | AppSync | Portfolio queries, position lists, performance metrics |

**Event Pipes**:
- `order-filled.pipe.ts` -- Update position quantity (intent truth)
- `portfolio-snapshot-imported.pipe.ts` -- Reconcile positions from broker truth
- `corporate-action-applied.pipe.ts` -- Apply splits, dividends

**Events Published**: `PORTFOLIO_CREATED`, `PORTFOLIO_UPDATED`, `POSITION_UPDATED`, `CASH_BALANCE_UPDATED` (for real-time UI subscriptions only)

**Events Consumed**:
- Intra-domain: `ORDER_FILLED`, `ORDER_PARTIALLY_FILLED`, `PORTFOLIO_SNAPSHOT_IMPORTED` (execution-adpt), `CORPORATE_ACTION_APPLIED`, reconciliation events (portfolio-ctrl)

---

### 3.14 portfolio-ctrl

**Type**: CTRL | **CDK Constructs**: State, Ingress, Egress (no Facade)

Reconciliation pipeline -- the tightest coupling with execution-ctrl (SAGA pattern within the Execution domain).

**DynamoDB Table Design**:

| Entity | PK | SK |
|---|---|---|
| Reconciliation | `Reconciliation#{tid}#{rid}` | `Reconciliation` |
| DriftRecord | `Reconciliation#{tid}#{rid}` | `DriftRecord#{instrument}` |
| ReconciliationLock | `ReconciliationLock#{tid}` | `ReconciliationLock` |

**Step Functions Workflow: Reconciliation**

```
StartState (triggered by PORTFOLIO_SNAPSHOT_IMPORTED or ORDER_FILLED or scheduled)
  -> CompareIntentVsSettlement (Lambda)
  -> Choice
    -> [No Drift] RecordSuccess -> PublishReconciliationCompleted
    -> [Drift Detected]
      -> PublishDriftDetected
      -> AcquireLock (Lambda: write ReconciliationLock, publish RECONCILIATION_LOCK_ACQUIRED)
      -> WaitForExecutionPause (callback: wait for EXECUTION_PAUSED from execution-ctrl)
      -> ImportSnapshot (Lambda: fetch latest broker snapshot)
      -> CorrectProjections (Lambda: update portfolio-bff projections via events)
      -> RevalidateCompliance (Lambda: notify compliance-ctrl if needed)
      -> ReleaseLock (Lambda: publish RECONCILIATION_LOCK_RELEASED)
      -> PublishReconciliationCompleted
  -> [Failure at any step]
    -> PublishReconciliationFailed
    -> ReleaseLock (compensating action)
```

**Reconciliation schedules**:
- Post-execution: triggered by `ORDER_FILLED`
- Hourly: EventBridge Scheduler rule
- Daily full: EventBridge Scheduler rule
- Startup: triggered on service cold start / redeployment

**Events Published**: `PORTFOLIO_DRIFT_DETECTED`, `RECONCILIATION_REQUIRED`, `RECONCILIATION_STARTED`, `RECONCILIATION_COMPLETED`, `RECONCILIATION_FAILED`, `RECONCILIATION_LOCK_ACQUIRED`, `RECONCILIATION_LOCK_RELEASED`, `PROJECTION_REBUILT`, `CORPORATE_ACTION_APPLIED`

**Events Consumed**:
- Intra-domain: `PORTFOLIO_SNAPSHOT_IMPORTED`, `ORDER_FILLED` (execution-adpt), scheduled events

---

## 4. Simulation Engine Specification (CF-1)

This section provides a concrete specification for the Phase 2 simulation engine that lives inside `execution-adpt`. The simulation engine is not a throwaway mock -- it ships as the user-facing Simulation Mode feature and remains active alongside the real IBKR adapter in later phases.

### 4.1 Market Data

**Source**: Static JSON files stored in S3, containing real ETF prices scraped once from public sources.

- **Bucket**: `nestfolio-{stage}-market-data`
- **Key pattern**: `market-data/{date}/etf-prices.json`
- **Format**: JSON array of `{ symbol, date, open, high, low, close, volume }` records
- **Coverage**: ~50 ETFs covering major asset classes (US equity, international equity, bonds, REITs, commodities)
- **Refresh strategy**: Prices are scraped once and stored statically. No live feed in Phase 2. The simulation engine reads the latest available file at fill time.
- **Fallback**: If no price file is found for today, use the most recent available date (files are sorted by key prefix).

### 4.2 Fill Algorithm

Market orders fill at the last known close price with zero slippage:

1. Look up the target instrument in the latest `etf-prices.json` file
2. Fill price = `close` field for that symbol
3. Fill quantity = full order quantity (no partial fills in Phase 2)
4. Simulated latency: 2-5 second delay (random) before writing the fill to mimic market conditions
5. No bid/ask spread modeling, no market impact, no order book simulation

Limit orders are not supported in Phase 2 -- all orders are treated as market orders.

### 4.3 Virtual Ledger DynamoDB Schema

The virtual ledger tracks positions and cash balances per investor. It shares the `execution-adpt` DynamoDB table using distinct PK/SK patterns.

| Entity | PK | SK | Attributes |
|---|---|---|---|
| VirtualCashBalance | `VirtualLedger#{tid}#{uid}` | `CashBalance#{currency}` | `balance` (number), `currency` (string, default "USD"), `updatedAt` (ISO timestamp) |
| VirtualPosition | `VirtualLedger#{tid}#{uid}` | `Position#{symbol}` | `symbol` (string), `quantity` (number), `avgCostBasis` (number), `lastFillPrice` (number), `lastFillAt` (ISO timestamp), `updatedAt` (ISO timestamp) |
| VirtualTrade | `VirtualLedger#{tid}#{uid}` | `Trade#{ts}#{tradeId}` | `tradeId` (ULID), `orderId` (string), `symbol` (string), `side` ("BUY" or "SELL"), `quantity` (number), `fillPrice` (number), `totalValue` (number), `cashBefore` (number), `cashAfter` (number), `filledAt` (ISO timestamp) |
| VirtualSnapshot | `VirtualLedger#{tid}#{uid}` | `Snapshot#{date}` | `date` (ISO date), `positions` (map of symbol -> quantity + value), `totalValue` (number), `cashBalance` (number), `generatedAt` (ISO timestamp) |

**GSI**: `tenantId-index` (same pattern as all other tables) for listing all virtual ledger entries per tenant.

**Access patterns**:
- Get cash balance: `PK = VirtualLedger#{tid}#{uid}, SK = CashBalance#USD`
- Get position: `PK = VirtualLedger#{tid}#{uid}, SK = Position#{symbol}`
- List all positions: `PK = VirtualLedger#{tid}#{uid}, SK begins_with Position#`
- List trade history: `PK = VirtualLedger#{tid}#{uid}, SK begins_with Trade#` (naturally sorted by timestamp)
- Get latest snapshot: `PK = VirtualLedger#{tid}#{uid}, SK begins_with Snapshot#` (scan reverse, limit 1)

### 4.4 Virtual Trade Execution Flow

Step-by-step flow when `execution-adpt` receives an `ORDER_SUBMITTED` event in simulation mode:

```
1. event-listener receives ORDER_SUBMITTED from SQS
2. Extract orderId, tenantId, userId, symbol, side (BUY/SELL), quantity
3. Load virtual cash balance (DynamoDB GetItem: VirtualLedger#{tid}#{uid} / CashBalance#USD)
4. Load current position for symbol (DynamoDB GetItem: VirtualLedger#{tid}#{uid} / Position#{symbol})
5. Fetch fill price from S3 market data (latest etf-prices.json, lookup by symbol -> close)
6. Calculate total trade value = quantity * fillPrice
7. Validate:
   - BUY: check cashBalance >= totalValue
   - SELL: check position.quantity >= quantity
   - If validation fails -> write ORDER_REJECTED event, exit
8. Wait 2-5 seconds (simulated market latency via setTimeout)
9. DynamoDB TransactWriteItems (atomic):
   a. Update VirtualCashBalance: adjust balance (-totalValue for BUY, +totalValue for SELL)
   b. Update VirtualPosition: adjust quantity, update avgCostBasis (for BUY), update lastFillPrice
   c. Put VirtualTrade record (immutable trade history)
10. DynamoDB Stream triggers event-publisher -> publishes ORDER_FILLED with fill details
11. Scheduled snapshot-importer (EventBridge Scheduler, every 15 minutes):
    - Read all positions for the investor
    - Calculate current market value using latest prices
    - Write VirtualSnapshot record
    - DynamoDB Stream triggers event-publisher -> publishes PORTFOLIO_SNAPSHOT_IMPORTED
```

### 4.5 Reconciliation in Phase 2

Reconciliation is trivial in Phase 2 because the virtual ledger is the sole source of truth. There is no external broker system to reconcile against.

- **Intent truth** = virtual ledger positions (written atomically at fill time)
- **Settlement truth** = virtual ledger positions (same source)
- **Drift**: structurally impossible -- every fill atomically updates both the trade record and the position
- `portfolio-ctrl` reconciliation pipeline still runs but always produces `RECONCILIATION_COMPLETED` with zero drift
- This validates the reconciliation infrastructure and event flow, even though Phase 2 cannot produce real drift scenarios

---

## 5. Vertical Slice Pattern (Initial Service Implementations)

Services that are not FULL in their initial phase implement **one complete vertical slice** -- one representative flow done properly end-to-end, rather than a shallow pass across all features.

### 5.1 Purpose

The goal is to deploy the complete Nestfolio service topology -- all 14 services exist, all EventBridge buses route events, all cross-domain flows are exercisable -- with each service implementing at least one real, production-quality flow. This validates the architecture with meaningful behavior rather than no-op stubs.

### 5.2 Vertical Slice Definitions

Each service's initial vertical slice represents one complete, production-quality flow:

| Service | Vertical Slice | What's Deferred |
|---|---|---|
| `investor-ctrl` | One complete notification pipeline flow: classify impact -> resolve policy -> select template -> deliver in-app -> record outcome | Email/push delivery channels, retry logic, batch notifications |
| `execution-ctrl` | One complete order lifecycle: receive `DECISION_APPROVED` -> safety checks -> submit order -> monitor fill callback | Market hours validation, staged orders, cool-down enforcement |
| `portfolio-ctrl` | One complete reconciliation pipeline: compare intent vs settlement -> detect drift -> lock -> correct -> release | Scheduled reconciliation (hourly/daily/startup), startup reconciliation |
| `operations-ctrl` | One complete operations workflow: incident lifecycle (detect -> classify severity -> auto-contain -> stabilize -> resolve) | Model promotion workflow, cost governance workflow |
| `advisory-bff` | Full recommendation projection + "Why?" view: materialize recommendations from advisory-ctrl events, serve explanation queries | Ops dashboard panels, compliance dashboard, incident history |
| `portfolio-bff` | Full dashboard projection: positions, cash balance, performance metrics from event stream | Real-time streaming subscriptions, goal progress tracking |

### 5.3 Vertical Slice Implementation Pattern

Each vertical slice follows the same principle: implement the full depth of one flow rather than the breadth of all flows.

**CDK stack**: Creates full production infrastructure (DynamoDB table, SQS queues, Lambda functions, IAM roles, EventBridge rules) -- identical to what the fully-featured service will use.

**Lambda handlers**: Implement the primary flow with real business logic. Secondary flows log and return early with a TODO marker.

**Example (execution-ctrl vertical slice)**:

```typescript
// safety-checks.ts -- vertical slice: one complete order lifecycle
export async function runSafetyChecks(order: OrderInput): Promise<SafetyResult> {
  // Vertical slice: implement reconciliation lock check (real logic)
  const lockResult = await checkReconciliationLock(order.tenantId);
  if (lockResult.locked) {
    return { approved: false, reason: 'Reconciliation in progress' };
  }

  // Deferred: conflicting staged orders, turnover limits, cool-down
  // These will be implemented when the full order lifecycle is built out
  return { approved: true, reason: 'Pre-submission checks passed' };
}
```

### 5.4 Why This Approach

1. **Architecture validation**: All 14 services deployed, all 6 cross-domain event routes exercisable, all infrastructure validated in a real AWS environment
2. **Production-quality foundations**: Each slice implements real business logic that ships to production -- no throwaway code
3. **Depth over breadth**: One properly implemented flow catches more design issues than many shallow stubs
4. **Incremental expansion**: Services expand from one vertical slice to full feature coverage, with no infrastructure changes required (only Lambda handler code additions)

---

## 6. Cross-Domain Event Flow Details

### Route 1: Investor -> Advisory

**Purpose**: Investor intent changes trigger advisory decision lifecycle and compliance guardrail materialization.

| Event | Producing Service | Consuming Service(s) | What Happens |
|---|---|---|---|
| `GOAL_UPDATED` | investor-bff | advisory-ctrl | Triggers decision lifecycle if material change |
| `RISK_PROFILE_UPDATED` | investor-bff | advisory-ctrl | Triggers risk re-evaluation |
| `OPERATING_MODE_CHANGED` | investor-bff | advisory-ctrl, compliance-ctrl | Triggers guardrail policy refresh + potential rebalance |
| `MANDATE_GRANTED` | investor-bff | compliance-ctrl | Creates guardrail policy snapshot |
| `MANDATE_UPDATED` | investor-bff | compliance-ctrl | Updates guardrail policy |
| `MANDATE_REVOKED` | investor-bff | compliance-ctrl | Deactivates guardrail policy, blocks decisions |

### Route 2: Investor -> Execution

**Purpose**: Financial operations that require broker action.

| Event | Producing Service | Consuming Service(s) | What Happens |
|---|---|---|---|
| `WITHDRAWAL_REQUESTED` | investor-bff | execution-adpt | Initiates IBKR withdrawal, reserves cash |
| `ACCOUNT_CLOSURE_REQUESTED` | investor-bff | execution-ctrl | Cancels all pending orders, blocks new submissions |

### Route 3: Advisory -> Investor

**Purpose**: Decision outcomes and operational incidents trigger notifications.

| Event | Producing Service | Consuming Service(s) | What Happens |
|---|---|---|---|
| `DECISION_PACKET_CREATED` | advisory-ctrl | investor-ctrl | Notification: "We're reviewing your portfolio" |
| `USER_CONFIRMATION_REQUESTED` | advisory-ctrl | investor-ctrl | Critical notification: "Action required" |
| `EXPLANATION_GENERATED` | advisory-ctrl | investor-ctrl | Notification: explanation available |
| `DECISION_APPROVED` | compliance-ctrl | investor-ctrl | Notification: "Trade approved" |
| `DECISION_BLOCKED` | compliance-ctrl | investor-ctrl | Notification: "Action blocked by safety rules" |
| `ESCALATION_TRIGGERED` | compliance-ctrl | investor-ctrl | Critical notification |
| `CIRCUIT_BREAKER_TRIGGERED` | operations-ctrl | investor-ctrl | Critical: "Trading paused" |
| `CIRCUIT_BREAKER_RESET` | operations-ctrl | investor-ctrl | "Trading resumed" |
| `INCIDENT_DETECTED` | operations-ctrl | investor-ctrl | May notify depending on severity |
| `INCIDENT_RESOLVED` | operations-ctrl | investor-ctrl | "Issue resolved" |

### Route 4: Advisory -> Execution

**Purpose**: Approved decisions flow to order lifecycle; circuit breakers control execution.

| Event | Producing Service | Consuming Service(s) | What Happens |
|---|---|---|---|
| `DECISION_APPROVED` | compliance-ctrl | execution-ctrl | Starts order lifecycle workflow |
| `USER_CONFIRMED` | advisory-ctrl | execution-ctrl | L2 confirmation received, proceed with execution |
| `CIRCUIT_BREAKER_TRIGGERED` | operations-ctrl | execution-ctrl | Pause all execution immediately |
| `CIRCUIT_BREAKER_RESET` | operations-ctrl | execution-ctrl | Resume execution |

### Route 5: Execution -> Investor

**Purpose**: Trade outcomes and financial status updates trigger notifications and update request state.

| Event | Producing Service | Consuming Service(s) | What Happens |
|---|---|---|---|
| `ORDER_FILLED` | execution-adpt | investor-ctrl, investor-bff | Notification + update activity |
| `ORDER_PARTIALLY_FILLED` | execution-adpt | investor-ctrl | Notification |
| `ORDER_REJECTED` | execution-adpt | investor-ctrl | Notification: "Order could not be executed" |
| `ORDER_CANCELLED` | execution-adpt | investor-ctrl | Notification |
| `ORDER_STAGED` | execution-ctrl | investor-ctrl | Notification: "Order scheduled for next market open" |
| `DEPOSIT_DETECTED` | execution-adpt | investor-ctrl, investor-bff | Notification + update deposit status |
| `WITHDRAWAL_COMPLETED` | execution-adpt | investor-ctrl, investor-bff | Notification + update withdrawal status |
| `WITHDRAWAL_REJECTED` | execution-adpt | investor-ctrl, investor-bff | Notification + update |
| `CORPORATE_ACTION_APPLIED` | portfolio-ctrl | investor-ctrl | Notification |
| `RECONCILIATION_COMPLETED` | portfolio-ctrl | investor-ctrl | May notify if material change |
| `RECONCILIATION_FAILED` | portfolio-ctrl | investor-ctrl | Alert if manual intervention needed |

### Route 6: Execution -> Advisory

**Purpose**: Order outcomes and portfolio drift trigger new decisions; broker failures trigger incidents.

| Event | Producing Service | Consuming Service(s) | What Happens |
|---|---|---|---|
| `ORDER_FILLED` | execution-adpt | advisory-ctrl | May trigger post-execution assessment |
| `ORDER_REJECTED` | execution-adpt | advisory-ctrl, operations-ctrl | advisory-ctrl reconsiders; operations-ctrl monitors pattern |
| `ORDER_CANCELLED` | execution-adpt | advisory-ctrl | Advisory may re-evaluate |
| `DEPOSIT_DETECTED` | execution-adpt | advisory-ctrl | Triggers investment assessment for new cash |
| `PORTFOLIO_DRIFT_DETECTED` | portfolio-ctrl | advisory-ctrl, operations-ctrl | Triggers rebalance evaluation |
| `BROKER_SESSION_LOST` | execution-adpt | operations-ctrl | Incident detection |
| `STREAM_DISCONNECTED` | execution-adpt | operations-ctrl | Incident detection |
| `RECONCILIATION_FAILED` | portfolio-ctrl | operations-ctrl | Incident detection |

---

## 7. CQRS and Event Sourcing Patterns

### 7.1 BFF Context -- Command Side (EditEvents)

BFF services that own mutable aggregates (investor-bff, portfolio-bff, advisory-bff) use the EditEvent pattern.

**Write Flow**:

```
1. AppSync resolver receives mutation
2. Lambda creates JSON Patch operations (RFC 6902) using Mutative
3. DynamoDB transaction writes:
   a. Update main entity record (updatedAt timestamp)
   b. Put new EditEvent record (patches, userId, timestamp)
4. DynamoDB Stream triggers egress Lambda
5. Egress Lambda publishes domain event to EventBridge
```

**EditEvent Record Structure**:

```typescript
{
  pk: 'InvestorProfile#tenant123#user456',
  sk: 'EditEvent#2026-03-03T10:30:00Z#abc-def-ghi',
  __typename: 'EditEvent',
  userId: 'user456',
  patches: '[{"op":"replace","path":"/goals/0/amount","value":50000}]',
  timestamp: '2026-03-03T10:30:00Z',
  ttl: 1743724200  // Optional: cleanup after 1 year
}
```

**State Reconstruction**: Query all EditEvents for an aggregate (SK begins_with `EditEvent#`), sort by SK (natural timestamp ordering), apply patches sequentially to rebuild state at any point in time.

### 7.2 CTRL Context -- Event Collection and Materialization

Controller services collect domain events from multiple sources, re-partition them, and materialize higher-level state.

**Example: advisory-ctrl materializing a DecisionPacket**

```
1. Trigger event arrives (GOAL_UPDATED from investor-hub)
2. event-listener composes context (investor profile, portfolio state, market data)
3. event-listener invokes AgentCore Runtime endpoint with context payload
4. AgentCore Runtime runs LangGraph StateGraph, returns Decision Packet
5. event-listener persists Decision Packet and agent invocation records to DynamoDB
6. DynamoDB Stream triggers egress -> publishes DECISION_PACKET_CREATED
```

### 7.3 DynamoDB Streams CDC -> EventBridge Publishing

The Egress construct handles CDC (Change Data Capture) from DynamoDB Streams to EventBridge. Key design decisions:

- **Filter at the stream level**: Only process `INSERT` events for main entity types (not EditEvents)
- **Determine event type from context**: `INSERT` = Created, `MODIFY` = Updated
- **Always include tenantId**: Extract from the DynamoDB record's PK segment
- **Idempotent publishing**: Use DynamoDB Stream sequence number as deduplication key

---

## 8. Multi-Tenancy Implementation

### 8.1 End-to-End Tenant Flow

```
JWT (Cognito)
  -> AppSync/API Gateway (extract tenant_id from JWT claims)
  -> Lambda handler (tenant_id in event context)
  -> DynamoDB (tenant_id embedded in PK: {Entity}#{tenantId}#{entityId})
  -> EventBridge (tenant_id in event.context.tenantId)
  -> Cross-domain forwarding (tenant_id preserved in event payload)
  -> Consuming service (tenant_id scoped queries)
  -> AppSync subscriptions (filtered by tenant_id)
```

### 8.2 Layer-by-Layer Isolation

| Layer | Mechanism | Implementation |
|---|---|---|
| **Cognito** | `tenant_id` custom attribute (immutable, set at registration) | PostConfirmation Lambda generates UUID tenant_id |
| **AppSync** | Lambda authorizer extracts `tenant_id` from JWT, adds to resolver context | Every resolver receives `context.identity.tenantId` |
| **Lambda** | UnitOfWork carries `TenantContext` extracted from event | `uow.event.context.tenantId` available in every pipe |
| **DynamoDB** | PK prefix: `{Entity}#{tenantId}#{entityId}` | Cross-tenant access structurally impossible |
| **DynamoDB GSI** | `tenantId-index` partitioned by tenant | Queries always scoped to single tenant |
| **EventBridge** | `context.tenantId` in every event detail | Rules can filter by tenant if needed |
| **S3** | Key prefix: `{tenantId}/...` | IAM policy can enforce prefix match |
| **Secrets Manager** | Secret name: `nestfolio/{stage}/ibkr/{tenantId}` | Per-tenant credential isolation |
| **Step Functions** | Execution input includes `tenantId` | All workflow steps pass tenant context |

### 8.3 Tenant-Scoped Query Pattern

```typescript
// Every repository method accepts tenantId as first parameter
async getProfile(tenantId: string, userId: string): Promise<InvestorProfile> {
  const result = await this.docClient.send(new QueryCommand({
    TableName: this.tableName,
    KeyConditionExpression: 'pk = :pk AND sk = :sk',
    ExpressionAttributeValues: {
      ':pk': `InvestorProfile#${tenantId}#${userId}`,
      ':sk': 'InvestorProfile',
    },
  }));
  return result.Items?.[0] as InvestorProfile;
}

// List all entities for a tenant
async listForTenant(tenantId: string, entityType: string): Promise<any[]> {
  const result = await this.docClient.send(new QueryCommand({
    TableName: this.tableName,
    IndexName: 'tenantId-index',
    KeyConditionExpression: 'tenantId = :tid AND __typename = :type',
    ExpressionAttributeValues: {
      ':tid': tenantId,
      ':type': entityType,
    },
  }));
  return result.Items ?? [];
}
```

---

## 9. Phased Scope Summary

### Phase 1: Foundation

**Goal**: Shared libraries, CDK constructs, 3 EventBridge hubs, Cognito auth.

### Phase 2: Core Domain

**Goal**: Validate the end-to-end decision lifecycle with simulated data. No real money, no real broker, no real users.

| What's Built | What's Stubbed/Deferred |
|---|---|
| All 3 EventBridge hubs with forwarding rules | Real IBKR integration (simulation engine instead) |
| investor-web (Cognito) | Google/Facebook federation (email/password only) |
| investor-bff (full) | AI agents (template responses until Phase 3) |
| investor-ctrl (one complete notification pipeline flow) | Email/push delivery (in-app only) |
| advisory-ctrl (decision lifecycle with stubbed agents) | Real AgentCore Runtime calls |
| compliance-ctrl (simplified rules) | Full guardrail library |
| execution-ctrl (one complete order lifecycle) | Market hours validation (always "open") |
| execution-adpt (simulation engine: virtual fills) | Real IBKR REST/streaming |
| portfolio-ctrl (one complete reconciliation pipeline) | Scheduled reconciliation, startup reconciliation |

**Phase 2 deliverables**:
- User registers, completes onboarding, sets goals
- System generates (stubbed) advisory recommendations
- Compliance checks approve/block decisions
- Simulation engine "executes" orders against virtual ledger
- Notifications flow for major events (in-app)

### Phase 3: AI Agent System

**Goal**: Replace stubbed agents with real AgentCore Runtime (containerized LangGraph). See [03-ai-agent-system.md](./03-ai-agent-system.md).

| What's Added | What's Enhanced |
|---|---|
| AgentCore Runtime (containerized LangGraph) | advisory-ctrl: real agent invocations via Runtime endpoint |
| Bedrock model tiering (Opus/Sonnet/Haiku) | Cost-optimized reasoning across agent types |
| Agent observability (traces, token usage) | operations-ctrl: cost governance foundations |

### Phase 4: Frontend

**Goal**: Build investor-facing and operator-facing frontend applications.

| What's Added | What's Enhanced |
|---|---|
| advisory-bff (full recommendation projection + "Why?" view) | Investor-facing recommendation and explanation UI |
| portfolio-bff (full dashboard projection) | Portfolio positions, cash, performance metrics |

### Phase 5: Observability

**Goal**: Operations monitoring, incident management, and full reconciliation schedules.

| What's Added | What's Enhanced |
|---|---|
| operations-ctrl (one complete operations workflow) | Incident detection, model governance, cost control |
| advisory-bff ops panels | Operations dashboard for internal actors |
| Scheduled reconciliation | portfolio-ctrl: hourly + daily + startup |
| Market hours enforcement | execution-ctrl: staging for off-hours orders |

**Deferred (beyond Phase 5)**:
- Real money (production IBKR)
- Real IBKR REST API integration
- Full regulatory compliance features
- Mobile app (PWA)
- Multi-region deployment
- Customer support tooling

### Service Phase Matrix

| Service | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Notes |
|---|---|---|---|---|---|---|
| investor-hub | Full | -- | -- | -- | -- | No changes after Phase 1 |
| investor-web | Full | -- | -- | -- | -- | Federation deferred |
| investor-bff | -- | Full | -- | -- | -- | |
| investor-ctrl | -- | Vertical slice | -- | -- | + Email/Push | One notification pipeline flow |
| advisory-hub | Full | -- | -- | -- | -- | No changes after Phase 1 |
| advisory-ctrl | -- | Stubbed agents | + AgentCore Runtime | -- | -- | Real agents in Phase 3 |
| compliance-ctrl | -- | Simplified | -- | -- | + Full guardrails | Expand rule library |
| operations-ctrl | -- | -- | -- | -- | Vertical slice | One operations workflow |
| advisory-bff | -- | -- | -- | Vertical slice | + Ops panels | Recommendation + "Why?" view |
| execution-hub | Full | -- | -- | -- | -- | No changes after Phase 1 |
| execution-ctrl | -- | Vertical slice | -- | -- | + Market hours | One order lifecycle |
| execution-adpt | -- | Simulation engine | -- | -- | -- | Real IBKR deferred |
| portfolio-bff | -- | -- | -- | Vertical slice | + Real-time | Full dashboard projection |
| portfolio-ctrl | -- | Vertical slice | -- | -- | + Scheduled | One reconciliation pipeline |
