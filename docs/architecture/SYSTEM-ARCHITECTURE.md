# Nestfolio — System Architecture

## 1. Purpose, Audience, How to Read

**Purpose.** This document is the canonical architectural reference for the Nestfolio system. It explains, for each domain and major subsystem, *why* the code is shaped the way it is — bounded contexts, agent topology, decision lifecycle, event taxonomy, idempotency, projections, AgentCore Memory contract, and the architectural evolution that produced the current shape.

**Audience.** Future Claude sessions and human engineers making non-trivial architectural changes. For per-service current state, read the service's `CLAUDE.md` card. For workflow-level traversal, read `flows/*.flow.yaml`. For visual topology, see `docs/architecture/c3/`. This document supersedes none of those — it sits beside them as the cross-cutting reference.

**How to read.** Sections 2–5 are foundational. §6–§17 cover the decision pipeline end-to-end. §18–§20 cover cross-cutting concerns (routing, KBs, frontend). §21 captures known open questions. §22–§24 are reference material.

**Companion document:** `docs/architecture/SERVICE-INVENTORY.md` (per-service inventory).

**Maintenance.** Updates land via spec → plan → implementation. See §24. Last whole-document review: **2026-04-30**.

---

## Table of Contents

1. [Purpose, Audience, How to Read](#1-purpose-audience-how-to-read)
2. [Product Summary](#2-product-summary)
3. [System Goals](#3-system-goals)
4. [High-Level System Domains](#4-high-level-system-domains)
5. [Core Architectural Principles](#5-core-architectural-principles)
6. [Decision Authority Model (L1 / L2)](#6-decision-authority-model-l1--l2)
7. [Agent Topology](#7-agent-topology)
   - 7.1 [Architectural Evolution — 6→4 advisory agent decomposition](#71-architectural-evolution--64-advisory-agent-decomposition)
8. [Compliance Boundary](#8-compliance-boundary)
9. [Event Sourcing & Event Taxonomy](#9-event-sourcing--event-taxonomy)
10. [Decision Packet](#10-decision-packet)
    - 10.1 [Architectural Evolution — Dual `DECISION_PACKET_CREATED` emitters](#101-architectural-evolution--dual-decision_packet_created-emitters)
11. [Idempotency & Safety Rules](#11-idempotency--safety-rules)
12. [Projections (Read Models)](#12-projections-read-models)
13. [Decision Lifecycle (End-to-End)](#13-decision-lifecycle-end-to-end)
14. [Operating Modes & Guardrails](#14-operating-modes--guardrails)
15. [Portfolio Truth & Reconciliation](#15-portfolio-truth--reconciliation)
16. [Circuit Breakers](#16-circuit-breakers)
17. [AgentCore Memory Contract](#17-agentcore-memory-contract)
    - 17.1 [Architectural Evolution — Current implementation diverges from contract](#171-architectural-evolution--current-implementation-diverges-from-contract)
18. [Cross-Domain Routing](#18-cross-domain-routing)
19. [Knowledge Bases](#19-knowledge-bases)
20. [Frontend Topology](#20-frontend-topology)
21. [Open Questions](#21-open-questions)
22. [Glossary](#22-glossary)
23. [Related Documents](#23-related-documents)
24. [Maintenance](#24-maintenance)

---

## 2. Product Summary

Nestfolio is an AI-augmented investment advisory platform. Each investor onboards through a conversational wizard that produces a **mandate** (goals, risk profile, constraints) and an **operating mode** (Conservative / Balanced / Aggressive). The system runs a recurring decision cycle that proposes portfolio adjustments, gates them through a deterministic compliance check, and — for low-authority decisions — executes them via a paper-broker (SIM) or live broker (LIVE) account. High-authority decisions require explicit user confirmation.

The product framing is documented in `specifications/01-product-vision.md`.

---

## 3. System Goals

1. **Trust** — every recommendation is auditable end-to-end via the immutable Decision Packet (§10).
2. **Safety** — the compliance gate (§8) enforces mandate + operating-mode guardrails before any execution.
3. **Auditability** — event-sourced state (§9), single-writer per stream, idempotent handlers (§11).
4. **Cost discipline** — Lambda profiles, ARM64 AgentCore Runtimes, per-tenant budget caps; the agent runtime pipeline supports Sonnet → Haiku reasoning-tier downgrade under cost pressure.
5. **Operational resilience** — circuit breakers (§16), reconciliation cadence (§15), at-most-once Step Functions task-token semantics.

---

## 4. High-Level System Domains

The system decomposes into **four bounded contexts**, each owning an EventBridge bus and a set of services. Inter-domain communication is exclusively via cross-domain adapters (`*-adpt`) using the pull model (§18).

| Domain | EventBridge Bus | Owned bounded context |
|---|---|---|
| **Investor** | `investor-bus` | Investor identity, profile, mandate, onboarding wizard, dashboard projections, cross-cutting notifications |
| **Advisory** | `advisory-bus` | Decision lifecycle (trigger → recommendation), AI agent execution, compliance gating, control plane (incidents, budgets, model lifecycle) |
| **Execution** | `execution-bus` | Order routing, broker abstraction (SIM + Alpaca), execution state machine, circuit-breaker enforcement |
| **Ledger** | `ledger-bus` | Position truth (intent vs settlement), reconciliation, corporate actions, drift detection |

Verified on 2026-04-30 by `ls services/` → `advisory  execution  investor  ledger`.

### 4.1 Architectural Evolution — 5→4 domains

The 2026-03-01 baseline named **five domains**: Investor, Advisory, Execution, Platform Infrastructure, and a not-yet-named persistence concern that later became Ledger. Current code:

- **Platform Infrastructure** responsibilities folded into shared libraries — observability into `libs/cdk-constructs/src/observability/`, IAM into per-service stacks. No standalone domain remains.
- **Ledger** emerged as a first-class domain when reconciliation became a core concern, per `docs/superpowers/specs/2026-03-26-real-money-operations-design.md`. The domain owns position truth and corporate-actions handling separately from execution intent.

---

## 5. Core Architectural Principles

1. **Event-only inter-domain communication.** Services never call each other via API; they communicate exclusively via EventBridge events. Cross-domain delivery routes through `*-adpt` adapters (§18). This is enforced as a project hard-rule (`CLAUDE.md` → "Hard Constraints"; user-memory `feedback_no_api_between_services.md`).

2. **Single-writer per DDB row.** Each stream of state has exactly one writer service; projections are read-only consumers. Race conditions are prevented at the source rather than reconciled downstream. See §11.

3. **6-construct CDK pattern.** Every service stack composes from a fixed catalogue of constructs, each consumer-instantiated and explicitly wired via props. Cite: `libs/cdk-constructs/src/core/` (`state.ts`, `ingress.ts`, `egress.ts`, `facade.ts`, `orchestration.ts`) and `libs/cdk-constructs/src/extensions/agent-runtime.ts`.

   | Construct | Purpose |
   |---|---|
   | `State` | DDB tables + GSIs + S3 buckets + KB vector buckets |
   | `Ingress` | EventBridge Rules + SQS queues + Lambda handlers (event-processor pipelines) |
   | `Egress` | DDB-stream → declarative event-typing → EventBridge emission |
   | `Facade` | AppSync GraphQL API + Cognito + IAM (BFFs) |
   | `Orchestration` | Step Functions state machines |
   | `AgentRuntime` (extension) | Bedrock AgentCore Runtime + ECR image + observability |

4. **Deterministic orchestration + governed agents.** The "thinking parts" are governed AI agents (LangGraph + Bedrock Claude); the "doing parts" are deterministic Step Functions state machines that fan out to agents and reduce their outputs. Compliance is rule-based (§8), not LLM-based.

5. **Dual-truth model.** Intent state (recommendations, orders) lives in Advisory + Execution. Settlement state (positions, cash) lives in Ledger. The two are reconciled continuously (§15).

---

## 6. Decision Authority Model (L1 / L2)

Decisions carry an **authority level** that determines whether the system can act autonomously or requires explicit user confirmation:

- **L1 (autonomous within mandate).** Small drift rebalances, scheduled DCAs (Dollar-Cost-Averaging contributions), routine compliance-pass adjustments. The system executes without user prompting; the user is notified after the fact.
- **L2 (requires confirmation).** Large allocation shifts beyond a per-mandate threshold, mode changes, withdrawals/deposits, account closure. The system stages the proposal; the user must confirm via the mobile/web client.

The L1/L2 split is encoded at decision-packet creation time and routed through `compliance-ctrl` (§8), which is the gate that converts an `RECOMMENDATION_PROPOSED` into either `RECOMMENDATION_APPROVED` (auto-execute), `RECOMMENDATION_AWAITING_CONFIRMATION` (L2 escalation), or `RECOMMENDATION_BLOCKED` (rule violation).

The classification rules and threshold parameters are declared per operating mode (§14). Reference flows: `flows/advisory-cycle.flow.yaml` (L1 path), `flows/withdrawal.flow.yaml` and `flows/account-closure.flow.yaml` (L2-by-construction).

---

## 7. Agent Topology

The system runs **6 production AI agents** organised in a layered topology.

### Orchestrator layer

`decision-workflow-ctrl` — Step Functions state machine that triggers the 4 advisory agents in parallel, persists results to AgentCore Memory, then assembles the Decision Packet. Cite: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`, `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`.

### Intelligence layer (4 agent-ctrl services, each hosting its own AgentCore Runtime)

| Service | Original 6-agent role(s) | Cluster | Default model |
|---|---|---|---|
| `investor-profile-ctrl` | User & Goals + Risk Assessment | Investor profile inference | Sonnet 4.6 (Haiku tier available) |
| `market-intelligence-ctrl` | Market & Research | Market signal extraction | Sonnet 4.6 |
| `portfolio-engine-ctrl` | Portfolio Construction + Rebalance Planner | Allocation + rebalance proposals | Sonnet 4.6 |
| `advisory-narrative-ctrl` | Recommendation & Explainability | Recommendation rationale + explainability | Sonnet 4.6 |

Each of these services has its own AgentRuntime construct (`libs/cdk-constructs/src/extensions/agent-runtime.ts`), ECR image (built by the AgentCore deploy pipeline — see `project_agentruntime_deploy.md` topic in user memory), and Bedrock AgentCore Memory resource scoped to the agent's namespace.

### Compliance layer

`compliance-ctrl` — rule-based gate, **not** an LLM agent; enforces mandate + operating-mode guardrails on the assembled Decision Packet (§8).

### Execution-adjacent agents

`onboarding-bff` — in-process LangGraph wizard hosted by the BFF, AG-UI streaming, 7-phase onboarding flow. Cite: `services/investor/onboarding-bff/agents/onboarding/agent.ts`, `services/investor/onboarding-bff/agents/onboarding/graph.ts`.

### Models

All agents target Bedrock Claude inference profiles via `libs/agent-orchestrator/`. Default: `us.anthropic.claude-sonnet-4-6`. Cost-pressure downgrade path (Sonnet → Haiku) is implemented via `libs/agent-orchestrator/src/tier-escalation.ts`.

### 7.1 Architectural Evolution — 6→4 advisory agent decomposition

**Pre-2026-03-18.** A single `advisory-ctrl` service hosted **all 6 agents** (User & Goals, Risk, Market & Research, Portfolio Construction, Rebalance Planner, Recommendation & Explainability) as one in-process LangGraph. The 6 prompt files for those agents are still on disk: `services/advisory/advisory-ctrl/src/agents/prompts/{user-goals,risk-assessment,market-research,portfolio-construction,rebalance-planner,explainability}.txt`. Step Functions sat in front of `advisory-ctrl` as a trigger, not as a per-agent fan-out.

**Post-2026-03-18** (per `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`). The 6 agents were clustered into 4 cohesive ctrl services, each hosting its own AgentRuntime:

- User & Goals + Risk → `investor-profile-ctrl`
- Market & Research → `market-intelligence-ctrl`
- Portfolio Construction + Rebalance Planner → `portfolio-engine-ctrl`
- Recommendation & Explainability → `advisory-narrative-ctrl`

A new orchestrator `decision-workflow-ctrl` was introduced (commit `a54006c9`, 2026-03-17) to fan out to the 4 ctrl services via Step Functions task tokens and assemble results from AgentCore Memory.

**Rationale for the split:**
- Memory locality: each agent owns its own Memory namespace and resource ARN.
- Independent deploy + scale per agent cluster.
- Per-cluster model-tier control (cost discipline).
- Distinct timeout / retry / observability profiles.

**Vestigial code.** `advisory-ctrl` retains the original decision-lifecycle code paths (the `agents/` subtree, the prompts, the 6-agent orchestration). The service still emits `DECISION_PACKET_CREATED` from its DDB stream (cite `services/advisory/advisory-ctrl/src/service.stack.ts:69`). This causes the dual-emitter situation documented in §10.1. **Spec 2 (advisory pipeline consolidation) retires the decision-lifecycle subsystem in `advisory-ctrl`**, leaving the service as the control plane (model lifecycle + incidents + budgets + reasoning-tier).

---

## 8. Compliance Boundary

`compliance-ctrl` is the **single gate** between agent-proposed recommendations and execution.

**Inputs.** `RECOMMENDATION_PROPOSED` event emitted at the end of the decision cycle.
**Outputs.** `RECOMMENDATION_APPROVED` (auto-execute), `RECOMMENDATION_AWAITING_CONFIRMATION` (L2 escalation), or `RECOMMENDATION_BLOCKED` (rule violation).

The rule engine is deterministic (no LLM). It evaluates:
- **Mandate guardrails** — risk-profile bounds, asset-class constraints, ESG filters declared at onboarding.
- **Operating-mode parameters** (§14) — max single-trade %, monthly turnover cap, drawdown limits, drift triggers, cool-down windows, ETF concentration caps, equity risk band.
- **L1/L2 classification** — converts to either auto-execute or user-confirmation routing.

Cite: `services/advisory/compliance-ctrl/src/`. Reference flows: `flows/advisory-cycle.flow.yaml` (the compliance step is the second-to-last node before execution).

---

## 9. Event Sourcing & Event Taxonomy

**Why event-sourced.** Decisions and trades require complete auditability — every state transition must be replayable. Event sourcing gives us (a) immutable audit trail by default, (b) projection rebuild from log, (c) cross-service decoupling via async events.

**Canonical envelope** (EventBridge `PutEvents` shape):
- `Source` — `${BUS_NAME}@${SERVICE_NAME}` for direct emitters; CDC pipeline emits with the producing service's source.
- `DetailType` — the branded event name (e.g. `DECISION_PACKET_CREATED`).
- `Detail` — JSON with `tenantId`, `subject`, `context`, payload-specific fields.

The branded `EventName` type lives at `libs/event-types/src/index.ts:2`. Event names are **free-form** strings — there is no closed suffix set (per user-memory `feedback_event_naming_freedom.md`). Names are typically `<DOMAIN>_<NOUN>_<VERB-PAST>` (e.g. `MANDATE_DEFINED`, `DECISION_PACKET_CREATED`) but the pattern is convention, not enforcement.

**Intra-domain vs cross-domain.** Intra-domain events flow directly on the owning bus. Cross-domain delivery goes through the receiving domain's `*-adpt` adapter (§18), which subscribes to upstream buses and republishes onto the consumer bus (sometimes with a rename to scope-strip the upstream prefix).

**Event categories** (organising the catalogue, not enforced typing):

| Category | Examples |
|---|---|
| User & Mandate | `INVESTOR_REGISTERED`, `MANDATE_DEFINED`, `OPERATING_MODE_CHANGED` |
| Portfolio State | `POSITION_OPENED`, `POSITION_CLOSED`, `PORTFOLIO_DRIFT_DETECTED` |
| Decision & Planning | `WORKFLOW_TRIGGER_CREATED`, `DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED`, `RECOMMENDATION_PROPOSED`, `RECOMMENDATION_APPROVED` |
| Execution | `ORDER_INTENT_CREATED`, `ORDER_FILLED`, `ORDER_FAILED` |
| Reporting & Explainability | `EXPLANATION_RECORDED`, `AGENT_TRACE_RECORDED` |
| Control Plane | `INCIDENT_OPENED`, `CIRCUIT_BREAKER_TRIPPED`, `MODEL_PROMOTED`, `TENANT_BUDGET_EXCEEDED` |

The Control Plane category was inherited from the originally-planned `operations-ctrl` service which was absorbed into `advisory-ctrl` (see SERVICE-INVENTORY.md `advisory-ctrl` entry).

---

## 10. Decision Packet

The **Decision Packet** is the canonical immutable record of every advisory decision. It is the audit-trail anchor — once created, fields are appended (via UPDATE events) but never mutated in place.

**Schema** (intent — actual fields are in `libs/event-types/src/index.ts` / per-service `domain/schemas.ts`):

| Field | Notes |
|---|---|
| `decisionId` | UUID, the row's PK component |
| `tenantId` | Multi-tenant isolation key |
| `triggerEvent` | What triggered this cycle (drift, schedule, deposit, mode change) |
| `recommendation` | Summary of what the system proposes |
| `proposedTrades` | List of trade intents (symbol, side, quantity, target weight) |
| `agentInvocations` | Per-agent trace metadata (model, latency, tools, errors) |
| `explanation` | Plain-language rationale, sourced from `advisory-narrative-ctrl` |
| `authorityLevel` | L1 / L2 |
| `status` | `DRAFT` → `PENDING` → `COMPLIANCE_REVIEW` → `APPROVED|BLOCKED|AWAITING_CONFIRMATION` → `CONFIRMED|REJECTED` → `EXECUTING` → `COMPLETED|FAILED` |
| `timestamps` | createdAt, updatedAt |

**Storage.** A `DecisionPacket` row in DDB. CDC propagates `DECISION_PACKET_CREATED` on INSERT and `DECISION_PACKET_UPDATED` on MODIFY. The advisory-bff projection (§12) consumes both and maintains the GraphQL read model.

**Schema reference.** `services/advisory/advisory-ctrl/src/domain/schemas.ts:5` defines `DecisionPacketCreatedSchema`.

### 10.1 Architectural Evolution — Dual `DECISION_PACKET_CREATED` emitters

**Pre-2026-03-18.** `advisory-ctrl` was the single Step Functions orchestrator; it owned the Decision Packet write and was the sole emitter of `DECISION_PACKET_CREATED`.

**Post-2026-03-18** (per `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`). `decision-workflow-ctrl` was introduced as the canonical orchestrator. It owns the AgentCore Memory resource, delegates the 4 agent invocations to ctrl services via SF task tokens, and runs the `AssemblePacket` step that persists the assembled Decision Packet. Per the design intent, `advisory-ctrl` was supposed to retire its decision-lifecycle code and become the **control plane** (model lifecycle, incidents, budgets, reasoning-tier — absorbing what `operations-ctrl` would have owned).

**Current state.** The retirement never landed. Both services still emit `DECISION_PACKET_CREATED`:

- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:70` — canonical, post-AssemblePacket. Comment in code reads: *"this INSERT emits DECISION_PACKET_CREATED on advisoryBus, which the …"*.
- `services/advisory/advisory-ctrl/src/service.stack.ts:69` — declarative CDC emission on `DecisionPacket` INSERT in advisory-ctrl's own DDB table; legacy code path from when advisory-ctrl was the single orchestrator.

**Symptom observed in 2026-04-30 8th-session Playwright run.** The dual emitter caused a race in advisory-bff's CQRS projection — `DECISION_PACKET_UPDATED` arrived before `CREATED`, producing a sparse row. Mitigated tactically by:

- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` reads agent outputs from upstream task results before creating the row + persists `explanation` (commit `429afa7a`).
- `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts` skips empty CREATE events; `services/advisory/advisory-bff/src/handlers/event-listener.ts` copies `explanation` from the UPDATE path with `attribute_exists(pk)` condition (commit `3dcad1eb`).

**Resolution path.** **Spec 2 (advisory pipeline consolidation)** retires `advisory-ctrl`'s decision-lifecycle subsystem entirely, leaving `decision-workflow-ctrl` as the sole emitter and removing the race at the source.

---

## 11. Idempotency & Safety Rules

Every handler must be safely retriable. The system enforces this via:

1. **Single-writer per DDB row.** Only one service writes any given row; projections read.
2. **Conditional writes.** `attribute_not_exists(pk)` for inserts (the `record()` intent in `libs/event-processor/`); `attribute_exists(pk)` for updates that must not create a sparse row (the post-2026-04-30 race-condition mitigation in advisory-bff).
3. **Idempotency keys on event-processor pipelines.** Event-processor pipelines use deterministic write-intent keys to dedupe replays (per user-memory `feedback_event_processor_pipelines.md`).
4. **SQS visibility-timeout + DLQ.** Failed handlers retry on visibility-timeout expiry; persistent failures land in a DLQ.
5. **SF task-token at-most-once.** Step Functions task tokens are consumed exactly once per task; double-`SendTaskSuccess` is rejected by the SF service.
6. **No `Scan`, no `FilterExpression` on key attributes.** GSIs are designed so reads use `Query`. Filter expressions on key attributes are a project anti-pattern (per user-memory `feedback_no_scan_no_filter.md`).

Cite: `libs/event-processor/src/intents/` for the canonical `record()` / `update()` intents.

---

## 12. Projections (Read Models)

The system uses **CQRS**. The write side is the producing service's DDB table; the read side is the consuming BFF's projection table. BFFs are the system-state read model for the UI (per user-memory `feedback_bff_is_read_model.md`).

**Intent vocabulary** (declared in `libs/event-processor/src/intents/`):

- `record()` — idempotent insert. Used to project `*_CREATED` events. Skip-if-empty is a project pattern (cite `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts`).
- `update()` — conditional patch. Used to project `*_UPDATED` events. Race-safe via `attribute_exists(pk)` (cite the advisory-bff fix shipped 2026-04-30).
- Status transitions are encoded in the projection's transform layer — e.g. `DECISION_PACKET_UPDATED` with `complianceStatus=PASSED` transitions the row's `status` field to `APPROVED`.

**The advisory-bff projection** is the highest-traffic read model. It maintains the Decision Packet GraphQL view consumed by the advisory MFE's decision list and detail pages. The 8th-session race-condition fix (record-skip-empty + UPDATE-explanation-copy) lives in this projection.

The dashboard-bff projection serves the Investor home dashboard and broadcasts via WebSocket subscriptions on AppSync (see user-memory `feedback_appsync_subscribe_filter_args.md` for the subscription-filter pitfall).

---

## 13. Decision Lifecycle (End-to-End)

Linear traversal of the canonical advisory cycle. For wire-level steps, see `flows/advisory-cycle.flow.yaml`.

```
WORKFLOW_TRIGGER_CREATED              (event from drift / schedule / deposit / mode-change)
   ↓  (decision-workflow-ctrl ingress)
SF.StartExecution                     (decision-workflow state machine)
   ↓  (4 parallel branches)
InvokeAgentRuntime × 4                (investor-profile, market-intelligence, portfolio-engine, advisory-narrative)
   ↓  (each agent persists output, completes via SendTaskSuccess)
AssemblePacket                        (decision-workflow-ctrl handler)
   ↓  (PutItem on DecisionPacket → CDC)
DECISION_PACKET_CREATED               (canonical emission point, §10.1)
   ↓  (advisory-bff projection + compliance-ctrl listener)
RECOMMENDATION_PROPOSED               (compliance-ctrl input)
   ↓  (rule engine, §8)
RECOMMENDATION_APPROVED  |  RECOMMENDATION_AWAITING_CONFIRMATION  |  RECOMMENDATION_BLOCKED
   ↓  (L1: auto-execute)              ↓  (L2: user-confirms via UI)
                                     RECOMMENDATION_CONFIRMED  |  RECOMMENDATION_REJECTED
   ↓
ORDER_INTENT_CREATED                  (execution-ctrl, crosses to Execution domain via execution-adpt)
   ↓
… execution → ledger settlement … (see flows/order-execution.flow.yaml + flows/order-ledger.flow.yaml)
```

The lifecycle is canonical for L1 cycles. L2 cycles add a user-confirmation pause; rebalance cycles add a drift-detection trigger upstream (`flows/portfolio-rebalance.flow.yaml`).

---

## 14. Operating Modes & Guardrails

Three modes — **Conservative**, **Balanced**, **Aggressive** — declare the operating envelope for autonomous decisions.

| Parameter | Conservative | Balanced | Aggressive |
|---|---|---|---|
| Max single-trade as % of portfolio | 2% | 5% | 10% |
| Monthly turnover cap | 10% | 25% | 50% |
| Drawdown circuit-breaker trigger | -5% | -10% | -15% |
| Drift trigger | 5% | 10% | 15% |
| Cool-down between rebalances | 30 days | 14 days | 7 days |
| ETF concentration cap | 25% | 35% | 50% |
| Equity risk band | conservative | balanced | aggressive |

(Numbers above are illustrative MVP defaults from the recovered 2026-03-01 baseline; live parameters are declared in `services/advisory/compliance-ctrl/` and may have been adjusted.)

**Mode change protocol.** A mandate event (`OPERATING_MODE_CHANGE_REQUESTED`) propagates through `investor-bff` → `advisory-adpt` → `advisory-bff` projection. The change takes effect on the **next decision cycle** — in-flight cycles continue under the previous mode.

### Open question: mode → agent behaviour wiring

Per user-memory `project_operating_mode.md`, the mode is captured in projections but **not yet fully wired into agent behaviour** as of 2026-04-30. See §21 Open Question #2.

---

## 15. Portfolio Truth & Reconciliation

**Dual truth.** Two canonical state stores:

- **Intent** — what the system *thinks* the portfolio should be. Lives in advisory + execution. Updated when recommendations approve and orders are placed.
- **Settlement** — what the broker actually filled. Lives in Ledger. Updated when execution events arrive (`ORDER_FILLED`, `POSITION_OPENED`, `POSITION_CLOSED`).

The two are kept in sync by the **reconciliation cycle** in `services/ledger/reconciliation-ctrl/`, which:

1. Periodically sweeps active positions on a schedule.
2. Cross-references intent (advisory state) with settlement (broker statement).
3. Emits `PORTFOLIO_DRIFT_DETECTED` when divergence exceeds threshold.
4. Triggers the circuit breaker (§16) if the drift is unsafe.

**Corporate actions** (splits, dividends, mergers) are processed in Ledger and emitted as adjustment events that the intent side reconciles against.

Reference: `flows/reconciliation.flow.yaml`, `flows/order-ledger.flow.yaml`, `docs/superpowers/specs/2026-03-26-real-money-operations-design.md`.

---

## 16. Circuit Breakers

The circuit breaker is a global pause-and-validate mechanism, owned by `broker-alpaca-adpt` since the 2026-04-15 redesign (per user-memory `project_circuit_breaker_redesign.md`).

**Trigger conditions:**
- Broker error rate above threshold over rolling window.
- Reconciliation drift exceeds severity-2 (§15).
- Cluster of mandate violations (per-tenant or system-wide).
- Manual ops kill-switch.

**Pause protocol:**
1. `CIRCUIT_BREAKER_TRIPPED` is emitted.
2. `investor-bff` flips a feature flag (gates the UI).
3. `broker-alpaca-adpt` halts new order submissions — in-flight orders complete, no new orders are sent.
4. Notification is fanned out: broker → advisory feature flag → investor notification.

**Recovery validation gates.** A heal Step Functions state machine in `broker-alpaca-adpt` runs validation (broker connectivity, reconciliation re-sync, mandate-compliance check) before emitting `CIRCUIT_BREAKER_RESET` to resume operations.

---

## 17. AgentCore Memory Contract

**Purpose.** AgentCore Memory provides per-agent durable conversation + extraction state for short- and long-term recall across decision cycles. The contract below defines how every agent in the system addresses Memory; deviations from the contract are explicitly named (§17.1).

### Namespace convention

```
/{serviceName}/{actorId}/{scope}
```

Where `actorId` is `tenantId`, and `scope` is one of:

| Scope | Lifetime | Purpose |
|---|---|---|
| `decisions/{decisionId}` | short-term | Per-decision agent inputs/outputs; written by upstream agent ctrls, read by `decision-workflow-ctrl`'s `AssemblePacket` |
| `preferences` | long-term | Investor preference extraction across cycles |
| `signals` | long-term | Market signal extraction with cross-decision shelf life |
| `rationale` | long-term | Recommendation rationale archive for explainability |
| `sessions/{sessionId}` | session | Conversational context (onboarding wizard) |

### Strategy mapping

Each namespace has an extraction strategy attached at Memory provisioning time. `decisions/{decisionId}` namespaces are intended for raw payload retrieval (no Bedrock extraction strategy — they're transient session data). Long-term namespaces (`preferences`, `signals`, `rationale`) use Bedrock extraction strategies to summarise across cycles.

### Reference implementation

`libs/agent-orchestrator/src/memory/memory-client.ts` exposes:

- `openDecisionSession(tenantId, decisionId)` → returns a `DecisionSession` with:
  - `writeAgentOutput(output)` — writes the agent's output for this decision.
  - `readUpstreamOutput(upstreamService)` — reads outputs from another service for the same decision.
  - `searchLongTermMemory(query, topK)` — searches the long-term namespaces.
- `searchTenantMemory(tenantId, query, topK)` — top-level long-term search.

### 17.1 Architectural Evolution — Current implementation diverges from contract

**Symptom (2026-04-30, 8th Playwright session).** `decision-workflow-ctrl`'s `AssemblePacket` step finds **no** agent outputs from Memory; assembly proceeds with empty agent payloads.

**Root cause.** The write path and the read path use different AgentCore Memory storage modes:

- **Write** (`libs/agent-orchestrator/src/memory/memory-client.ts:36-53`) — `writeAgentOutput` calls `CreateEventCommand` with `sessionId: decisionId`. This writes a **session event**, not a memory record. Session events are conversational state, not addressable by namespace search.
- **Read** (`libs/agent-orchestrator/src/memory/memory-client.ts:55-65`) — `readUpstreamOutput` calls `RetrieveMemoryRecordsCommand` with `namespace: /${upstreamService}/${tenantId}/decisions/${decisionId}`. This searches **memory records** addressed by namespace.

The two storage modes don't intersect. Reads find nothing because writes don't populate the namespace they search.

**Tactical mitigation in place** (commits `429afa7a` + `3dcad1eb` on `main`):
- `AssemblePacket` reads agent outputs directly from upstream Step Functions task results (in the SF execution's input map) rather than from Memory.
- `advisory-bff` projection copies `explanation` from the `DECISION_PACKET_UPDATED` event when the `DECISION_PACKET_CREATED` arrives without it.

**Resolution path.** **Spec 2** lands the namespace alignment: `writeAgentOutput` switches from `CreateEventCommand` to a memory-record write against `decisions/{decisionId}`, so reads against the same namespace return the agent outputs as designed. Tactical mitigations remain as defence-in-depth.

---

## 18. Cross-Domain Routing

**Pull model.** Each domain has exactly one cross-domain adapter (`*-adpt`) that owns the EventBridge Rules on **upstream** domain buses. The adapter copies matching events onto the consumer's bus, sometimes renaming them to scope-strip the upstream prefix.

The four cross-domain adapters:

| Service | Subscribes to (upstream buses) | Republishes onto |
|---|---|---|
| `advisory-adpt` | investor-bus, ledger-bus, execution-bus | advisory-bus |
| `execution-adpt` | advisory-bus | execution-bus |
| `investor-adpt` | advisory-bus, ledger-bus, execution-bus | investor-bus |
| `ledger-adpt` | execution-bus | ledger-bus |

(Each domain also has third-party data adapters for external sources — alpha-vantage-adpt, fred-adpt, marketwatch-adpt, sec-edgar-adpt, yahoo-finance-adpt, broker-sim-adpt, broker-alpaca-adpt — those are not cross-*domain* adapters but external-service adapters.)

**Rule pattern.** Each adapter declares its own EB rules using `Match.anyOf()` for `$or` content filters. Cite: `services/advisory/advisory-adpt/src/`. The pull model means consumers control what they listen to — the upstream domain doesn't know who consumes its events.

**Renames at boundary.** Some events are renamed when crossing — e.g. `LEDGER_PORTFOLIO_DRIFT_DETECTED` (on ledger-bus) is republished as `PORTFOLIO_DRIFT_DETECTED` (on advisory-bus). This decouples the consumer from the upstream domain's vocabulary.

Reference: user-memory `project_inverted_adapter_routing.md`.

---

## 19. Knowledge Bases

Bedrock Knowledge Bases provide **authoritative external context** to LLM agents at inference time, complementing Memory (§17).

**Hosting.** Per-service S3 vector buckets via `libs/cdk-constructs/src/extensions/knowledge-base.ts`. The naming service generates KB bucket names following the convention `kbBucketName(account, kbKey)`.

**Ingestion pipeline:** producing service writes documents to its S3 bucket → DDB stream marks ingestion intent → SQS queue → ingestion Lambda → Bedrock KB sync. Re-indexing is incremental.

**Query at agent inference.** Agents call `libs/agent-orchestrator/src/kb-retrieval.ts` to query KBs as part of their LangGraph state.

**KB vs Memory complementarity:**

| | Knowledge Base | AgentCore Memory |
|---|---|---|
| Source | Authoritative external corpus (research notes, policy docs, market analyses) | Behavioural / session / extraction artefacts |
| Lifetime | Long-lived, manually curated | Per-tenant, evolves with usage |
| Update | Document ingestion pipeline | Agent output writes |
| Query mode | Semantic search (top-K vector) | Namespace-scoped retrieval + extraction |

The agents that consume KBs in production: `market-intelligence-ctrl` (market research corpus), `advisory-narrative-ctrl` (rationale templates / regulatory boilerplate), `onboarding-bff` (RAG for onboarding answers).

---

## 20. Frontend Topology

**Shell + 5 MFEs over Native Federation.** The Angular PWA shell (`apps/nestfolio-host/`) federates 5 MFEs at runtime: `apps/investor-mfe`, `apps/dashboard-mfe`, `apps/advisory-mfe`, `apps/ledger-mfe`, `apps/onboarding-mfe`. Each MFE is paired with its BFF, and each BFF publishes its own MFE bucket + CloudFront origin (per user-memory `project_mfe_charter_migration.md`, fully graduated 2026-04-27).

**Per-route Apollo + AppSync GraphQL.** Each MFE has its own Apollo client pointed at its BFF's AppSync endpoint. Cross-MFE state passes through the shell via routing only, not via shared Apollo cache.

**`frontend-deps` shared singleton surface.** `libs/frontend-deps/index.js` exports `sharedFrontendDeps` — a 23-package singleton union spread into every `apps/*/federation.config.js`. The shell-⊇-every-MFE invariant is structural: shell shares everything every MFE shares.

**CSP single-source-of-truth.** A single CSP policy is built into the shell's `index.html` template at build time and emitted by `investor-web` at synth time. (Per user-memory `project_mfe_charter_migration.md` — exact path verified during the A1 ship in the MFE charter migration; current location is in `apps/nestfolio-host/` build artefacts; refer to that topic file for path detail.)

**onboarding-bff as a hybrid.** It serves an MFE (the onboarding wizard), exposes a CopilotKit/AG-UI bridge endpoint, and previously hosted an AgentCore Runtime. Per the 2026-04-28 onboarding-runtime redesign (user-memory `project_playwright_e2e_ui.md` and the `project_agent_contract_tests.md` resolution), the agent runs in-process via `OnboardingAgent extends AbstractAgent` (cite `services/investor/onboarding-bff/agents/onboarding/agent.ts`).

---

## 21. Open Questions

These items the writing process surfaced but did not resolve. Each lists a proposed resolution path.

1. **L1/L2 authority encoding.** Is `authorityLevel` a typed field on Decision Packet schemas, or a runtime classification in `compliance-ctrl`? Verify in `services/advisory/compliance-ctrl/src/` — if absent as a typed field, document the implicit classification logic in §6 explicitly. Spec 2 candidate.

2. **Operating mode → agent behaviour wiring.** Per user-memory `project_operating_mode.md`, mode is captured in projections but not yet flowed into agent prompt construction. Resolution: the operating-mode design spec referenced in that topic file. Out of scope for Spec 1.

3. **AgentCore Memory namespace mismatch.** `writeAgentOutput` writes session events; `readUpstreamOutput` reads memory records. **Spec 2** lands the alignment.

4. **Dual `DECISION_PACKET_CREATED` emitter.** Both `advisory-ctrl` and `decision-workflow-ctrl` emit. **Spec 2** retires `advisory-ctrl`'s decision-lifecycle subsystem.

5. **`advisory-ctrl/decision-lifecycle` AgentRuntime fate.** It deploys today; under Spec 2 it gets retired. Documented in SERVICE-INVENTORY.md as `legacy` health tag with forward-pointer to Spec 2.

6. **`operations-ctrl` absorbed events — live vs reserved.** Categories `SHADOW_RUN_*`, `MODEL_*`, `INCIDENT_*`, `CIRCUIT_BREAKER_*`, `HEALTH_CHECK_*`, `TENANT_BUDGET_*` were absorbed into `advisory-ctrl`. Phase C audit should identify which event names are actually emitted/consumed by current code (live) versus declared but dormant (reserved-for-future). Captured in SERVICE-INVENTORY.md `advisory-ctrl` entry.

7. **`decisions/{decisionId}` namespace extraction strategy.** The contract specifies "no extraction strategy — raw retrieval" but the current `RetrieveMemoryRecordsCommand` call uses a `searchQuery` (`'agent output'`) which implies a search-backed retrieval, not a direct read. Revisit during Spec 2 — may want a different API call (e.g. list-records-by-namespace) for the canonical read.

8. **`onboarding-bff` AgentCore Runtime status post-2026-04-28.** With the in-process redesign, is the AgentCore Runtime still a deployment target, or is the Hono bridge running standalone? Verify by reading `services/investor/onboarding-bff/src/service.stack.ts`. Update the SERVICE-INVENTORY entry accordingly.

9. **CSP single-source-of-truth file path.** Memory references `apps/nestfolio-host/csp.txt` but no such file is on disk (verified 2026-04-30). The CSP is single-sourced through some other mechanism. Resolution: trace the build-time CSP generation in `apps/nestfolio-host/` and update §20 with the actual path.

10. **Operating-mode-parameter source of truth.** The numbers in §14 are illustrative defaults from the 2026-03-01 baseline. Live parameters must be located in `services/advisory/compliance-ctrl/` (or wherever the rule engine reads them) and either cited inline in §14 or moved to a separate operating-mode parameters reference.

---

## 22. Glossary

- **Decision Packet** — the canonical immutable record of a decision cycle (§10).
- **Mandate** — the per-investor configuration declared at onboarding: goals, risk profile, asset constraints, ESG filters.
- **Operating Mode** — Conservative / Balanced / Aggressive; declares the autonomy envelope (§14).
- **Authority Level** (L1 / L2) — whether a decision can auto-execute or requires user confirmation (§6).
- **Account Mode** (SIM / LIVE) — paper-broker or live-broker account; declared at investor onboarding.
- **Reasoning Tier** — Sonnet / Haiku model selection per agent invocation; downgrades under cost pressure (§3).
- **Cross-Domain Adapter** — a `*-adpt` service that subscribes to upstream domain buses and republishes onto the consumer bus (§18).
- **BFF (Backend-for-Frontend)** — the CQRS read side for a frontend; owns a GraphQL API and a projection table (§12).
- **AgentCore Memory** — Bedrock-managed durable conversation + extraction store for agents (§17).
- **AgentCore Runtime** — Bedrock-managed Lambda + ECR runtime for agent code (§7).
- **Knowledge Base** — Bedrock-managed S3 vector store for RAG context (§19).
- **Circuit Breaker** — global pause-and-validate mechanism for execution-side incidents (§16).

---

## 23. Related Documents

| Path | Purpose |
|---|---|
| `docs/architecture/SERVICE-INVENTORY.md` | Per-service responsibility, events, agents, health |
| `flows/*.flow.yaml` (14 flows) | Workflow-level event traversal; canonical for business flows |
| `docs/data-flows/*.md` | Generated narrative views of the flow specs |
| `docs/architecture/c3/` | C4 SVG diagrams (system + container level) |
| `docs/architecture/nestfolio.d2` | D2 source for the C4 diagrams |
| `specifications/01-product-vision.md` | Product framing |
| `specifications/02-system-design.md` | High-level executive summary (this doc supersedes for service-level reasoning) |
| `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md` | Memory contract source design |
| `docs/superpowers/specs/2026-03-26-real-money-operations-design.md` | Real-money-ops + Ledger domain emergence |
| `docs/superpowers/specs/2026-04-30-system-architecture-docs-foundation-design.md` | This document's authoring spec |
| Per-service `CLAUDE.md` cards | Code-anchored current-state per service |
| `CLAUDE.md` (root) | Skill router; lists this file as canonical reference |

---

## 24. Maintenance

**Update protocol.** Updates to this document land via spec → plan → implementation, the same loop used for code change. A change to system architecture requires:

1. A spec under `docs/superpowers/specs/YYYY-MM-DD-<topic>.md` capturing the design.
2. A plan under `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
3. An implementation PR that lands code change *and* the corresponding section update here.

Section-level changes that don't ship code (e.g. clarifications, glossary additions, link fixes) can land as a single `docs(arch):` commit on `main`.

**Review cadence.** Each section header carries an implicit "last reviewed" date — the date of the most recent commit that touched the section. Whole-document review at 2-month intervals or upon major architectural change.

**Ownership.** Maintained by whoever lands an architectural change. The repo enforces this via `CLAUDE.md`'s "Canonical Architecture References" section, which directs every future session to read this file before architecturally non-trivial work.

**Last whole-document review:** 2026-04-30 — recovery from `eac934d5` baseline + reconciliation to current 33-service code (commit `c038691a` and following).
