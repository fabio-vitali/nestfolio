# Service Decomposition

Defines Nestfolio's bounded contexts, domain boundaries, data ownership, and the relationships between domains. This section maps the system's business capabilities to a concrete service architecture using the patterns defined in the [Event-Driven Architecture](../03-event-driven-architecture.md) specification.

> [Back to Index](../README.md)

## Documents in This Section

| Document | Description |
|---|---|
| [Service Inventory](./service-inventory.md) | Complete listing of all services organized by domain, with responsibilities and event contracts |
| [Event Flows](./event-flows.md) | Inter-domain event routing, cross-domain subscription matrix, and primary flow descriptions |

---

## Domain Model

Nestfolio's business capabilities are organized into three bounded contexts. Each domain is an isolated sub-system with its own event bus, infrastructure, and deployment pipeline.

| # | Domain | Business Capability | Core Vocabulary |
|---|---|---|---|
| 1 | **Investor** | Authentication, tenant lifecycle, PII, onboarding, goals, risk profiles, mandates, operating modes, account modes (SIMULATION/LIVE), deposit/withdrawal intent, broker authorization, notification policy and delivery, GDPR deletion | user, tenant, JWT, PII, goal, risk profile, mandate, operating mode, account mode, onboarding, consent, notification, severity tier, timing mode, channel |
| 2 | **Advisory** | AI-driven decision lifecycle, compliance validation, guardrail enforcement, audit trail, incident management, AI model governance, cost governance | decision packet, recommendation, explanation, rebalance, compliance check, guardrail, escalation, audit artifact, incident, circuit breaker, model registry, shadow run, promotion |
| 3 | **Execution** | Broker integration, order lifecycle, broker session management, portfolio projections, positions, reconciliation, drift detection, performance metrics | order, fill, broker session, streaming, portfolio, position, cash balance, drift, reconciliation, settlement truth, intent truth, snapshot |

---

## Domain Grouping Rationale

The three-domain model groups sub-capabilities that share the same primary actor, tight event loops, or common lifecycle triggers. Each grouping is justified below.

### Investor Domain (Identity + Investor Profile + Notifications)

- **Identity and Investor Profile** share the same primary actor (the Investor) and the same lifecycle trigger (user registration creates an investor profile). Identity's vocabulary (JWT, PII, federation) is infrastructure-level authentication with no independent business features beyond Cognito hosted UI. The data ownership boundary between credentials and preferences is enforced by service separation within the domain (`investor-web` owns auth, `investor-bff` owns preferences), not by domain separation.
- **Notifications** have a distinct policy model (5 severity tiers, 3 timing modes) but no distinct actor — they serve the same Investor. The notification lifecycle is purely reactive to events from other domains. The notification pipeline (`investor-ctrl`) retains its own Step Functions workflow, DynamoDB state, and event subscriptions. The notification inbox lives in `investor-bff`, which also owns the Settings screen where notification preferences are managed.

### Advisory Domain (AI Advisory + Compliance + Operations)

- **Compliance** exists to validate advisory decisions. The `DECISION_PACKET_CREATED` to `DECISION_APPROVED/BLOCKED` exchange is the single highest-traffic inter-service flow. Both share the decision lifecycle vocabulary. `compliance-ctrl` remains a separate deployable unit with its own state, ingress, and egress per regulatory requirements. Compliance events route through `advisory-hub`, avoiding a separate hub and an extra forwarding hop.
- **Operations** monitors advisory (agent failures, shadow comparisons) and compliance (guardrail violations, suitability failures). These constitute 60% of `operations-ctrl`'s inbound event subscriptions. Grouping them in the same domain eliminates four cross-domain forwarding rules. `operations-ctrl` retains its three independent Step Functions workflows.

### Execution Domain (Order Lifecycle + Portfolio)

- Portfolio's core input is execution events (`ORDER_FILLED`, `PORTFOLIO_SNAPSHOT_IMPORTED`). The Dual Truth Model reconciliation loop — `portfolio-ctrl` detects drift, pauses `execution-ctrl`, corrects projections, resumes `execution-ctrl` — is the tightest coupling between any two sub-capabilities. Housing both in the execution domain enables intra-domain coordination through the same EventBridge bus, avoiding latency-sensitive cross-domain forwarding.

---

## Data Ownership Boundaries

Each domain is the authoritative source for its data. Other domains hold copies or references obtained through events.

| Domain | Authoritative Data | Consumed Projections |
|---|---|---|
| **Investor** | User credentials, tenant claims, PII, investor preferences (goals, risk profiles, mandates, operating modes, account modes), onboarding state, notification records, delivery policies, channel preferences | Deposit/withdrawal status updates (from Execution), decision outcomes (from Advisory) |
| **Advisory** | Decision Packets, agent reasoning outputs, compliance decisions, guardrail policies, audit artifacts, incidents, model versions, containment actions, cost budgets | Investor intent changes (from Investor), order outcomes and drift signals (from Execution) |
| **Execution** | Orders, execution outcomes, broker sessions, portfolio projections, positions, reconciliation state, drift records, cash balances, virtual portfolio ledger (simulation accounts) | Approved decisions (from Advisory), withdrawal/closure requests (from Investor) |

---

## Regulatory Separation

The system enforces strict separation between advice generation, decision authorization, and trade execution as required by regulatory compliance:

| Requirement | Implementation |
|---|---|
| `advisory-ctrl` separate deployable | Own Step Functions, own DynamoDB table, own IAM role. Deployed independently within the advisory domain |
| `compliance-ctrl` separate deployable | Own Step Functions, own DynamoDB table, own IAM role. Lives in the advisory domain but deploys as its own CDK stack with independent ingress and egress |
| `execution-ctrl` separate deployable | Own Step Functions, own DynamoDB table, own IAM role. In execution domain with independent deployment |
| No direct invocation between the three | Communication is exclusively event-driven via domain hubs. No synchronous calls, no shared state |
| Audit boundary | `compliance-ctrl` owns its own audit artifacts table. Advisory cannot write to compliance state. The IAM boundary is per-service, not per-domain |

---

## Actors

| Actor | Type | Description | Primary Domains |
|---|---|---|---|
| **Investor** | External | Novice-to-intermediate investor. Primary launch market: Italy | Investor, Advisory (recommendations, safety rules), Execution (portfolio) |
| **Platform Operator** | Internal | Monitors system health, pauses/resumes execution, triggers reconciliation, responds to incidents | Advisory (operations dashboards) |
| **Compliance Reviewer** | Internal | Reviews audit trails and Decision Packets, approves/blocks escalated decisions | Advisory (compliance dashboards) |
| **AI Governance Reviewer** | Internal | Approves model promotion, reviews shadow-mode divergence, authorizes rollback | Advisory (AI governance dashboards) |
| **Customer Support** | Internal | Read-only, tenant-scoped access via ABAC | Investor (read), Advisory (read), Execution (read) |

---

## Key Design Decisions

1. **3 bounded contexts.** The three-domain model groups contexts that share the same primary actor, tight event loops, or common lifecycle triggers. A finer-grained decomposition would create excessive inter-domain coupling (25+ forwarding routes, tight SAGA loops). Domain-internal service boundaries preserve the architectural guarantees of sub-capability isolation.

2. **Regulatory compliance via service separation, not domain separation.** `advisory-ctrl`, `compliance-ctrl`, and `execution-ctrl` are separate deployable units with independent state, IAM roles, and Step Functions. No single service can both generate advice AND authorize it AND execute it.

3. **3 Event Hubs.** Cross-domain forwarding is limited to 6 directional routes, keeping inter-domain coupling minimal.

4. **No inter-domain ADPTs.** Event Hub forwarding rules plus typed event contracts in shared libraries serve as the anti-corruption boundary. With 3 hubs and only 6 directional routes, dedicated adapter services would add deployment overhead without proportional value. If semantic translation complexity grows, lightweight inter-domain adapter Lambdas should be introduced per affected route.

5. **Reconciliation is intra-domain.** The `portfolio-ctrl` to `execution-ctrl` SAGA (lock, pause, correct, resume) is the tightest coupling between any two sub-capabilities. Both coordinate through the same EventBridge bus within the Execution domain.
