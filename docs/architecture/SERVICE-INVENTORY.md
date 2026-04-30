# Service Inventory

> **Status:** Canonical reference. Per-service responsibility, key events, AI agents, knowledge bases, state, MFEs, and architectural-evolution annotations.
>
> **Companion document:** `docs/architecture/SYSTEM-ARCHITECTURE.md` (cross-cutting architecture).
>
> **Last whole-document review:** 2026-04-30.

For per-service code-anchored detail (event subscriptions, handlers, dependencies, tests), read each service's own `CLAUDE.md` card — those are regenerable from code via the `audit-service` skill and stay in sync with the implementation. This document is the cross-cutting view: *why* each service exists and where it sits in the architectural evolution.

---

## Inventory Summary

Total services: **33** (verified 2026-04-30 via `ls services/{advisory,execution,investor,ledger}/` minus `README.md`).

Health tags:
- **canonical** — matches design intent, current code is the reference shape.
- **transitional** — active divergence; named follow-up spec will land alignment.
- **legacy** — will be retired; named follow-up spec.
- **dormant** — deployed but no live consumers (reserved for planned future).

| # | Service | Domain | Type | MFE | AI Agent | Health |
|---:|---|---|---|:---:|:---:|---|
| 1 | investor-hub | Investor | hub | — | — | canonical |
| 2 | investor-web | Investor | web (shell) | shell | — | canonical |
| 3 | investor-bff | Investor | bff | investor-mfe | — | canonical |
| 4 | investor-ctrl | Investor | ctrl | — | — | canonical |
| 5 | dashboard-bff | Investor | bff | dashboard-mfe | — | canonical |
| 6 | onboarding-bff | Investor | bff (hybrid) | onboarding-mfe | OnboardingAgent (in-process LangGraph) | canonical |
| 7 | investor-adpt | Investor | adpt (cross-domain) | — | — | canonical |
| 8 | advisory-hub | Advisory | hub | — | — | canonical |
| 9 | advisory-ctrl | Advisory | ctrl (control plane + vestigial decision-lifecycle) | — | decision-lifecycle multi-agent (LangGraph) | transitional (Spec 2) |
| 10 | advisory-bff | Advisory | bff | advisory-mfe | — | canonical |
| 11 | advisory-narrative-ctrl | Advisory | ctrl | — | Recommendation & Explainability | canonical |
| 12 | investor-profile-ctrl | Advisory | ctrl | — | User & Goals + Risk | canonical |
| 13 | market-intelligence-ctrl | Advisory | ctrl | — | Market & Research | canonical |
| 14 | portfolio-engine-ctrl | Advisory | ctrl | — | Portfolio Construction + Rebalance | canonical |
| 15 | decision-workflow-ctrl | Advisory | ctrl (orchestrator) | — | — (Step Functions) | canonical |
| 16 | compliance-ctrl | Advisory | ctrl | — | — (rule engine) | canonical |
| 17 | advisory-adpt | Advisory | adpt (cross-domain) | — | — | canonical |
| 18 | alpha-vantage-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 19 | fred-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 20 | marketwatch-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 21 | sec-edgar-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 22 | yahoo-finance-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 23 | execution-hub | Execution | hub | — | — | canonical |
| 24 | execution-ctrl | Execution | ctrl | — | — | canonical |
| 25 | broker-ctrl | Execution | ctrl (orchestrator) | — | — (Step Functions) | canonical |
| 26 | broker-sim-adpt | Execution | adpt (broker) | — | — | canonical |
| 27 | broker-alpaca-adpt | Execution | adpt (broker + circuit breaker) | — | — | canonical |
| 28 | execution-adpt | Execution | adpt (cross-domain) | — | — | canonical |
| 29 | ledger-hub | Ledger | hub | — | — | canonical |
| 30 | ledger-ctrl | Ledger | ctrl | — | — | canonical |
| 31 | ledger-bff | Ledger | bff | ledger-mfe | — | canonical |
| 32 | reconciliation-ctrl | Ledger | ctrl | — | — | canonical |
| 33 | ledger-adpt | Ledger | adpt (cross-domain) | — | — | canonical |

---

## Per-service template

Each entry below uses the same structure:

- **Type** + **Domain** + **Stack** path.
- **Why this service exists** (bounded-context responsibility).
- **Responsibilities** (cohesive responsibilities owned).
- **Key events** (published / consumed — per-service `CLAUDE.md` is authoritative for the full list).
- **AI Agents** (if any).
- **State** (DDB / S3 / KB).
- **API surface** (BFFs only).
- **MFE** (BFFs with frontend).
- **Architectural Evolution** (where applicable).
- **Health** + cross-references.

---

## Investor Domain (7 services)

### investor-hub

**Type:** hub · **Domain:** Investor
**Stack:** `services/investor/investor-hub/src/service.stack.ts`

**Why this service exists.** Owns the `investor-bus` EventBridge bus and the cross-cutting SSM parameters consumed by investor-domain services (account IDs, runtime config). One bus per domain is the architectural convention (§4 of SYSTEM-ARCHITECTURE.md).

**Responsibilities.** EventBridge bus provisioning; SSM parameter exports for sibling services.

**State.** None (no DDB, no Lambda handlers).

**Architectural Evolution.** None.

**Health.** canonical.

**Cross-references.** Per-service `CLAUDE.md` card.

---

### investor-web

**Type:** web (Angular shell host) · **Domain:** Investor
**Stack:** `services/investor/investor-web/src/service.stack.ts`

**Why this service exists.** Hosts the Angular PWA shell that federates the 5 MFEs at runtime via Native Federation. Includes CloudFront distribution + WAF + the unified MFE-bucket origin topology (§20).

**Responsibilities.** Shell static-asset hosting; routing to MFE remoteEntry.json; per-route auth integration with Cognito; CSP enforcement.

**State.** S3 shell bucket + CloudFront distribution. Exports `web/distributionId` at the canonical subsystem-scoped SSM path (per the A3 ship in user-memory `project_mfe_charter_migration.md`).

**MFE.** This is the shell, not a federated MFE. `apps/nestfolio-host/` contains the shell source.

**Architectural Evolution.** Through the MFE charter migration (2026-04-24 → 2026-04-27, fully graduated), `investor-web` became the canonical CloudFront origin host for all 5 MFEs via per-BFF MFE buckets (A3) + the `frontend-deps` shared singleton library (A2) + the CSP single-source-of-truth (A1). See user-memory `project_mfe_charter_migration.md`.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memory `project_mfe_charter_migration.md`.

---

### investor-bff

**Type:** bff · **Domain:** Investor
**Stack:** `services/investor/investor-bff/src/service.stack.ts`

**Why this service exists.** Backend-for-Frontend for the Investor MFE. Owns the GraphQL surface for investor profile + mandate management + cross-cutting feature flags (e.g. circuit-breaker UI gate). BFFs are the system-state read model for the UI (per user-memory `feedback_bff_is_read_model.md`).

**Responsibilities.** Profile + mandate + risk-profile projections; feature-flag mutations (used by circuit-breaker — see user-memory `project_cb_appsync_auth.md`); cross-domain read aggregation via `investor-adpt`.

**Key events consumed.** `MANDATE_DEFINED`, `RISK_PROFILE_*`, `OPERATING_MODE_CHANGED`, `CIRCUIT_BREAKER_*` (via investor-adpt).

**State.** DDB projection table; AppSync GraphQL.

**API surface.** AppSync GraphQL with Cognito-User-Pool authentication and IAM-signed write paths from sibling services. The `check-auth.fn.js` JS resolver detects IAM identity to bypass Cognito claims for cross-service mutations (per user-memory `project_cb_appsync_auth.md`).

**MFE.** `apps/investor-mfe/`. Shares its MFE bucket via the A3 per-BFF construct.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memories `project_cb_appsync_auth.md`, `feedback_bff_is_read_model.md`.

---

### investor-ctrl

**Type:** ctrl · **Domain:** Investor
**Stack:** `services/investor/investor-ctrl/src/service.stack.ts`

**Why this service exists.** Owns the Investor identity + notification subsystem. Despite the `ctrl` suffix this service handles cross-cutting investor notifications — there is **no `notification-ctrl` service**, that vocabulary is sometimes invented in error (per user-memory `feedback_investor_ctrl_not_notification.md`).

**Responsibilities.** Investor registration; identity write side; notification fan-out (system → user channels).

**Architectural Evolution.** None.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memory `feedback_investor_ctrl_not_notification.md`.

---

### dashboard-bff

**Type:** bff · **Domain:** Investor
**Stack:** `services/investor/dashboard-bff/src/service.stack.ts`

**Why this service exists.** CQRS read side for the Investor home dashboard. Aggregates portfolio state + active decisions + recent activity into a single GraphQL view. Separate from `investor-bff` because the dashboard's read patterns + WSS subscription topology differ enough to justify a dedicated projection.

**Responsibilities.** Dashboard projection table; WebSocket subscription broadcasts on AppSync (mind the subscription-filter pitfall — every `@aws_subscribe` filter arg must be on the return type, resolver response, AND the publisher's mutation selection per user-memory `feedback_appsync_subscribe_filter_args.md`).

**State.** DDB projection table; AppSync GraphQL with WSS.

**MFE.** `apps/dashboard-mfe/`.

**Architectural Evolution.** Late addition relative to the original 2026-03-01 design — emerged when dashboard read patterns diverged from investor-bff's CRUD shape.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memory `feedback_appsync_subscribe_filter_args.md`.

---

### onboarding-bff

**Type:** bff (hybrid: BFF + AgentCore Bridge + LangGraph host) · **Domain:** Investor
**Stack:** `services/investor/onboarding-bff/src/service.stack.ts`

**Why this service exists.** The conversational onboarding wizard runs an in-process LangGraph agent that streams via the AG-UI protocol to a CopilotKit-driven Angular MFE. The BFF + agent-host coupling exists because the wizard's mid-flow state is most easily owned by the same Lambda that serves the GraphQL layer.

**Responsibilities.** AG-UI bridge endpoint (Hono server in `services/investor/onboarding-bff/src/`); LangGraph wizard graph (`services/investor/onboarding-bff/agents/onboarding/graph.ts`); Bedrock KB query for RAG-backed answers; phase progression (7 phases) culminating in `INVESTOR_REGISTERED` + `MANDATE_DEFINED`.

**AI Agents.**
- `OnboardingAgent extends AbstractAgent` (`@ag-ui/client`) at `services/investor/onboarding-bff/agents/onboarding/agent.ts`. Drives the in-process LangGraph; emits AG-UI events directly. Default model: `us.anthropic.claude-sonnet-4-6`.

**State.** DDB session table; Bedrock KB for onboarding RAG.

**MFE.** `apps/onboarding-mfe/`.

**Architectural Evolution.** **Onboarding agent runtime redesign — SHIPPED 2026-04-28** (see user-memory `project_playwright_e2e_ui.md`). Replaced `@copilotkit/runtime/langgraph`'s remote-only `LangGraphAgent` (which required `deploymentUrl` + LangSmith) with a custom `OnboardingAgent` driving the in-process LangGraph via `streamEvents({ version: 'v2' })`. Symmetric with the 5 advisory agents (also in-process LangGraph in AgentCore). Bundle 6.8 → 6.3 MB. Spec: `docs/superpowers/specs/2026-04-28-onboarding-runtime-redesign.md`.

**Open question** (§21 Open Question #8 in SYSTEM-ARCHITECTURE.md). With the in-process redesign, is the AgentCore Runtime still a deployment target, or is the Hono bridge running standalone? Verify in `service.stack.ts`.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memory `project_playwright_e2e_ui.md`; `docs/superpowers/specs/2026-04-28-onboarding-runtime-redesign.md`.

---

### investor-adpt

**Type:** adpt (cross-domain) · **Domain:** Investor
**Stack:** `services/investor/investor-adpt/src/service.stack.ts`

**Why this service exists.** Pull-model cross-domain adapter for the Investor domain. Owns EB Rules on advisory-bus, ledger-bus, execution-bus that match events the Investor domain consumes (e.g. `DECISION_PACKET_*`, `CIRCUIT_BREAKER_*`, `PORTFOLIO_DRIFT_DETECTED`) and republishes them onto investor-bus (sometimes renaming to scope-strip the upstream prefix).

**Responsibilities.** Cross-domain rule subscriptions; event renames; pass-through projection-ready envelopes onto investor-bus.

**Architectural Evolution.** Pull-model inversion (per user-memory `project_inverted_adapter_routing.md`) — adapters own their subscriptions rather than the upstream domain pushing.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §18.

---

## Advisory Domain (15 services)

### advisory-hub

**Type:** hub · **Domain:** Advisory
**Stack:** `services/advisory/advisory-hub/src/service.stack.ts`

**Why this service exists.** Owns `advisory-bus` and the SSM parameters consumed by advisory-domain services — including the model inference-profile IDs (`models/opus`, `models/sonnet`, `models/haiku`) referenced from `agent-orchestrator` (per advisory-ctrl `CLAUDE.md`).

**State.** None.

**Architectural Evolution.** None.

**Health.** canonical.

---

### advisory-ctrl

**Type:** ctrl (control plane + vestigial decision-lifecycle) · **Domain:** Advisory
**Stack:** `services/advisory/advisory-ctrl/src/service.stack.ts`

**Why this service exists.** Per the post-2026-03-18 design, this is the **control plane** for the advisory domain — model lifecycle (`MODEL_REGISTERED`, `SHADOW_RUN_*`, `MODEL_PROMOTED`, `MODEL_ROLLBACK_TRIGGERED`), incident management (`INCIDENT_DETECTED|CONTAINED|ESCALATED|RESOLVED`), tenant budget enforcement (`TENANT_BUDGET_*`), reasoning-tier control (`REASONING_TIER_CHANGED`), and operator action audit (`OPERATOR_ACTION_PERFORMED`). It absorbs the originally-planned `operations-ctrl` service — that service does **not** exist as a deployable.

**Responsibilities.**
- *(Designed)* Control plane: model lifecycle, incidents, budgets, reasoning tier.
- *(Vestigial)* Decision-lifecycle multi-agent LangGraph (the original 6-agent in-process orchestrator pre-2026-03-18). The `agents/decision-lifecycle/` subtree, the 6 prompt files, the orchestrator graph — all still on disk, still deployed.

**Key events.**
- *Live emission* (via CDC, per its `CLAUDE.md`): `DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED`, `AGENT_INVOCATION_CREATED|UPDATED`, `WORKFLOW_STATE_CREATED|UPDATED`.
- *Declared but not currently emitted* (typed event constants in `services/advisory/advisory-ctrl/src/domain/events.ts:1-41` — reserved-for-future): the operations-ctrl absorbed vocabulary (`SHADOW_RUN_*`, `MODEL_*`, `INCIDENT_*`, `HEALTH_CHECK_*`, `TENANT_BUDGET_*`, `REASONING_TIER_CHANGED`, `OPERATOR_ACTION_PERFORMED`, `EVENT_DELIVERY_FAILED`, `EVENT_REPLAYED`). These have routing surface in `investor-adpt` and `advisory-adpt` event-types but no producer code yet.

**AI Agents.** `advisory_ctrl_decision_lifecycle` — multi-agent LangGraph orchestrator (Opus / Sonnet / Haiku via SSM); tools: portfolio-lookup, market-data, instrument-universe, event-publisher (per CLAUDE.md card).

**State.** DDB tables (Decision Packet legacy, AgentInvocation, WorkflowState) + standalone tool Lambdas.

**Architectural Evolution — vestigial decision-lifecycle.** Pre-2026-03-18: this was the single SF orchestrator hosting all 6 agents in-process. Post-2026-03-18 (per `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`): `decision-workflow-ctrl` was introduced as the canonical orchestrator and the 6 agents were split into 4 cluster-ctrl services (SYSTEM-ARCHITECTURE.md §7.1). `advisory-ctrl` was supposed to retire its decision-lifecycle code. The retirement never landed → both services emit `DECISION_PACKET_CREATED` (SYSTEM-ARCHITECTURE.md §10.1, line citation `services/advisory/advisory-ctrl/src/service.stack.ts:69`). **Spec 2 (advisory pipeline consolidation) retires the decision-lifecycle subsystem** and leaves advisory-ctrl as the pure control plane.

**Architectural Evolution — operations-ctrl absorbed.** The operations-ctrl service was planned in the 2026-03-01 baseline but never built. Its event vocabulary was absorbed into advisory-ctrl when the service was repurposed as the control plane. Most of those events are still typed-but-unwired today.

**Health.** transitional. The decision-lifecycle subsystem is `legacy` with a forward-pointer to **Spec 2**; the control-plane responsibilities are `canonical` but largely reserved-for-future (most events typed, most producers not yet implemented).

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §7.1, §10.1; `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`.

---

### advisory-bff

**Type:** bff · **Domain:** Advisory
**Stack:** `services/advisory/advisory-bff/src/service.stack.ts`

**Why this service exists.** CQRS read side for the advisory domain — Decision Packet projections, Recommendation projections, decision-list views consumed by the Advisory MFE.

**Responsibilities.** Decision Packet projection (the highest-traffic read model in the system); decision-list filters; subscription broadcasts when packets transition state.

**Key events consumed.** `DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED` (both emitters — see SYSTEM-ARCHITECTURE.md §10.1), `RECOMMENDATION_PROPOSED|APPROVED|BLOCKED|AWAITING_CONFIRMATION`.

**State.** DDB projection table; AppSync GraphQL.

**API surface.** AppSync GraphQL with Cognito + IAM auth.

**MFE.** `apps/advisory-mfe/`.

**Architectural Evolution.** Hosts the **2026-04-30 race-condition fix** for the dual-emitter situation: `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts` skips empty CREATE events; `services/advisory/advisory-bff/src/handlers/event-listener.ts` copies `explanation` from the UPDATE path with `attribute_exists(pk)` condition (commit `3dcad1eb`). Tactical mitigation, not root-cause fix — the proper resolution is **Spec 2** retiring the dual emitter.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §10.1, §12; user-memory `feedback_bff_is_read_model.md`.

---

### advisory-narrative-ctrl

**Type:** ctrl (agent host) · **Domain:** Advisory
**Stack:** `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`

**Why this service exists.** Hosts the Recommendation & Explainability agent — converts the assembled Decision Packet's structured trades + portfolio diff into a plain-language rationale that lands on the packet via the `explanation` field.

**AI Agents.** Recommendation & Explainability — Bedrock Sonnet 4.6 via AgentCore Runtime; consumes upstream agent outputs from AgentCore Memory (subject to the §17.1 namespace divergence).

**State.** DDB; Bedrock Memory namespace; possibly Knowledge Base for rationale templates / regulatory boilerplate.

**Architectural Evolution.** Emerged from the 2026-03-18 6→4 split (SYSTEM-ARCHITECTURE.md §7.1) — covers the original "Recommendation & Explainability" agent role. Subject to the AgentCore Memory namespace divergence (§17.1) — Spec 2 lands the alignment.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §7.1, §17.1.

---

### investor-profile-ctrl

**Type:** ctrl (agent host) · **Domain:** Advisory
**Stack:** `services/advisory/investor-profile-ctrl/src/service.stack.ts`

**Why this service exists.** Hosts the User & Goals + Risk agent cluster — consumes mandate + investor profile inputs and emits a structured profile inference (goals interpretation, risk evaluation) that feeds downstream agents.

**AI Agents.** User & Goals + Risk Assessment cluster — Bedrock Sonnet 4.6 via AgentCore Runtime.

**Architectural Evolution.** Emerged from the 2026-03-18 6→4 split (SYSTEM-ARCHITECTURE.md §7.1) — covers the original "User & Goals" + "Risk Assessment" agent roles consolidated into one cluster. Subject to the §17.1 Memory namespace divergence.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §7.1.

---

### market-intelligence-ctrl

**Type:** ctrl (agent host) · **Domain:** Advisory
**Stack:** `services/advisory/market-intelligence-ctrl/src/service.stack.ts`

**Why this service exists.** Hosts the Market & Research agent — consumes upstream market-data adapter outputs (alpha-vantage / fred / marketwatch / sec-edgar / yahoo-finance) + a Bedrock Knowledge Base for research notes; emits market signal extraction.

**AI Agents.** Market & Research — Bedrock Sonnet 4.6 via AgentCore Runtime.

**State.** DDB; Bedrock Memory; Bedrock KB (research-notes corpus).

**Architectural Evolution.** Emerged from the 2026-03-18 6→4 split (SYSTEM-ARCHITECTURE.md §7.1). Subject to the §17.1 Memory namespace divergence.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §7.1.

---

### portfolio-engine-ctrl

**Type:** ctrl (agent host) · **Domain:** Advisory
**Stack:** `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`

**Why this service exists.** Hosts the Portfolio Construction + Rebalance Planner cluster — consumes investor-profile-ctrl + market-intelligence-ctrl outputs from Memory; emits a portfolio construction + a rebalance plan.

**AI Agents.** Portfolio Construction + Rebalance Planner cluster — Bedrock Sonnet 4.6 via AgentCore Runtime.

**Architectural Evolution.** Emerged from the 2026-03-18 6→4 split (SYSTEM-ARCHITECTURE.md §7.1) — covers the original "Portfolio Construction" + "Rebalance Planner" agent roles consolidated into one cluster. Subject to the §17.1 Memory namespace divergence.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §7.1.

---

### decision-workflow-ctrl

**Type:** ctrl (orchestrator) · **Domain:** Advisory
**Stack:** `services/advisory/decision-workflow-ctrl/src/service.stack.ts`

**Why this service exists.** **Canonical orchestrator** of the advisory decision cycle. Owns the Step Functions state machine that fans out to the 4 agent ctrls in parallel, persists their outputs to AgentCore Memory, runs the `AssemblePacket` step, and emits the canonical `DECISION_PACKET_CREATED`. Owns the AgentCore Memory resource for the decision-cycle short-term namespace.

**Responsibilities.** SF state machine (`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`); agent invocation via task tokens; AssemblePacket reduction (`services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`); CDC emission of Decision Packet events.

**Key events.**
- Consumed: `WORKFLOW_TRIGGER_CREATED` (the cycle kick-off).
- Emitted: `DECISION_PACKET_CREATED` (canonical, post-AssemblePacket — `assemble-packet.ts:70`), `DECISION_PACKET_UPDATED`.

**State.** DDB DecisionPacket table (the canonical post-2026-03-18 owner); AgentCore Memory resource (per the §17 contract).

**Architectural Evolution.** Introduced 2026-03-17 (commit `a54006c9`); replaces `advisory-ctrl` as the canonical SF orchestrator per `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`. The retirement of advisory-ctrl's decision-lifecycle code never landed → dual `DECISION_PACKET_CREATED` emitter (SYSTEM-ARCHITECTURE.md §10.1). The 8th-Playwright-session bug fix (commit `429afa7a`) lives in this service: `AssemblePacket` reads agent outputs directly from upstream task results before creating the row + persists `explanation`. The AgentCore Memory namespace divergence (§17.1) is also rooted in this service's `writeAgentOutput` / `readUpstreamOutput` calls (delegated to `libs/agent-orchestrator/src/memory/memory-client.ts`).

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §7, §10, §10.1, §13, §17.1; `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`.

---

### compliance-ctrl

**Type:** ctrl (rule engine) · **Domain:** Advisory
**Stack:** `services/advisory/compliance-ctrl/src/service.stack.ts`

**Why this service exists.** The single gate between agent-proposed recommendations and execution. Rule-based (deterministic), **not** an LLM. Enforces mandate guardrails + operating-mode parameters (§14) on the assembled Decision Packet; classifies as L1 (auto-execute) / L2 (user-confirm) / Blocked.

**Key events.**
- Consumed: `RECOMMENDATION_PROPOSED`.
- Emitted: `RECOMMENDATION_APPROVED`, `RECOMMENDATION_AWAITING_CONFIRMATION`, `RECOMMENDATION_BLOCKED`.

**Architectural Evolution.** None.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §6, §8.

---

### advisory-adpt

**Type:** adpt (cross-domain) · **Domain:** Advisory
**Stack:** `services/advisory/advisory-adpt/src/service.stack.ts`

**Why this service exists.** Pull-model cross-domain adapter for the Advisory domain. Subscribes to investor-bus + ledger-bus + execution-bus events the Advisory domain needs (mandate events, portfolio drift, order outcomes, etc.) and republishes onto advisory-bus.

**Architectural Evolution.** None beyond the pull-model inversion (`project_inverted_adapter_routing.md`).

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §18.

---

### alpha-vantage-adpt

**Type:** adpt (3rd-party data) · **Domain:** Advisory
**Stack:** `services/advisory/alpha-vantage-adpt/src/service.stack.ts`

**Why this service exists.** Adapter to the Alpha Vantage market-data API. Polled / triggered by market-intelligence-ctrl's needs; emits market-data ingestion events onto advisory-bus.

**Responsibilities.** Alpha Vantage API client; rate-limit handling; envelope normalisation; KB ingestion path (where applicable).

**State.** Uses AWS Parameters and Secrets Lambda Extension for runtime config (per user-memory's "Third-party adapters" technical note) — not env vars.

**Architectural Evolution.** None.

**Health.** canonical.

---

### fred-adpt

**Type:** adpt (3rd-party data — FRED economic data) · **Domain:** Advisory
**Stack:** `services/advisory/fred-adpt/src/service.stack.ts`

**Why this service exists.** Adapter to the Federal Reserve Economic Data (FRED) API for macro indicators consumed by market-intelligence-ctrl.

**Responsibilities.** FRED API client; macro-indicator publication.

**State.** Parameters and Secrets Extension for credentials.

**Architectural Evolution.** None.

**Health.** canonical.

---

### marketwatch-adpt

**Type:** adpt (3rd-party data — MarketWatch news) · **Domain:** Advisory
**Stack:** `services/advisory/marketwatch-adpt/src/service.stack.ts`

**Why this service exists.** News + market-headline adapter for market-intelligence-ctrl.

**Architectural Evolution.** None.

**Health.** canonical.

---

### sec-edgar-adpt

**Type:** adpt (3rd-party data — SEC EDGAR filings) · **Domain:** Advisory
**Stack:** `services/advisory/sec-edgar-adpt/src/service.stack.ts`

**Why this service exists.** SEC EDGAR filings adapter — equity research source for advisory-narrative-ctrl + market-intelligence-ctrl.

**Architectural Evolution.** None.

**Health.** canonical.

---

### yahoo-finance-adpt

**Type:** adpt (3rd-party data — Yahoo Finance prices) · **Domain:** Advisory
**Stack:** `services/advisory/yahoo-finance-adpt/src/service.stack.ts`

**Why this service exists.** Quote + price-history adapter for market-intelligence-ctrl + portfolio-engine-ctrl.

**Architectural Evolution.** None.

**Health.** canonical.

---

## Execution Domain (6 services)

### execution-hub

**Type:** hub · **Domain:** Execution
**Stack:** `services/execution/execution-hub/src/service.stack.ts`

**Why this service exists.** Owns `execution-bus` and the SSM parameters consumed by execution-domain services.

**State.** None.

**Architectural Evolution.** None.

**Health.** canonical.

---

### execution-ctrl

**Type:** ctrl · **Domain:** Execution
**Stack:** `services/execution/execution-ctrl/src/service.stack.ts`

**Why this service exists.** Top-level execution coordinator. Consumes `RECOMMENDATION_CONFIRMED` (from advisory side via `execution-adpt`); creates `ORDER_INTENT_CREATED` envelopes; routes to `broker-ctrl` for SF-driven execution.

**Key events.**
- Consumed: `RECOMMENDATION_CONFIRMED` (cross-domain via `execution-adpt`).
- Emitted: `ORDER_INTENT_CREATED`, `EXECUTION_*`.

**Architectural Evolution.** None.

**Health.** canonical.

---

### broker-ctrl

**Type:** ctrl (orchestrator) · **Domain:** Execution
**Stack:** `services/execution/broker-ctrl/src/service.stack.ts`

**Why this service exists.** Owns the broker-side Step Functions state machine. Receives `ORDER_INTENT_CREATED`, routes the order through the appropriate broker adapter (sim or alpaca based on account mode), tracks fill state, emits `ORDER_FILLED` / `ORDER_REJECTED`.

**Architectural Evolution.** Split during the 2026-03-26 real-money-ops design (`docs/superpowers/specs/2026-03-26-real-money-operations-design.md`) — `broker-ctrl` owns the SF state machine; `broker-{sim,alpaca}-adpt` own the broker-specific protocols. The split lets us add brokers (e.g. IBKR) without changing the orchestration layer.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memory `project_real_money_ops.md`.

---

### broker-sim-adpt

**Type:** adpt (broker — paper trading) · **Domain:** Execution
**Stack:** `services/execution/broker-sim-adpt/src/service.stack.ts`

**Why this service exists.** Paper-trading broker adapter — fills orders against synthetic prices for SIM accounts. Used in tests + dev tenant onboarding.

**Architectural Evolution.** Same 2026-03-26 split as broker-ctrl.

**Health.** canonical.

---

### broker-alpaca-adpt

**Type:** adpt (broker + circuit breaker host) · **Domain:** Execution
**Stack:** `services/execution/broker-alpaca-adpt/src/service.stack.ts`

**Why this service exists.** Alpaca broker adapter for LIVE accounts + **owns the global circuit-breaker** since the 2026-04-15 redesign (per user-memory `project_circuit_breaker_redesign.md`). The circuit breaker lives here because broker-side is where execution failures originate; consolidating the breaker with the broker adapter avoids cross-service state for pause/resume.

**Responsibilities.** Alpaca API client; order routing for LIVE accounts; circuit-breaker tripping + heal SF state machine; cross-domain notification fan-out (broker → advisory feature flag → investor notification).

**Key events.**
- Emitted: `CIRCUIT_BREAKER_TRIPPED`, `CIRCUIT_BREAKER_RESET`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_FAILED`.

**State.** DDB; `Orchestration` construct (heal SF state machine).

**Architectural Evolution.** Circuit-breaker redesign merged 2026-04-15 (`project_circuit_breaker_redesign.md`). Branch was `feat/cb-redesign`; CB previously in `execution-ctrl`. Includes IAM-based AppSync auth (`check-auth.fn.js` detects IAM identity, bypasses Cognito claims) per user-memory `project_cb_appsync_auth.md`.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §16; user-memories `project_circuit_breaker_redesign.md`, `project_cb_appsync_auth.md`.

---

### execution-adpt

**Type:** adpt (cross-domain) · **Domain:** Execution
**Stack:** `services/execution/execution-adpt/src/service.stack.ts`

**Why this service exists.** Pull-model cross-domain adapter — subscribes to advisory-bus events (mainly `RECOMMENDATION_CONFIRMED`) and republishes onto execution-bus.

**Architectural Evolution.** None beyond the pull-model inversion.

**Health.** canonical.

**Cross-references.** SYSTEM-ARCHITECTURE.md §18.

---

## Ledger Domain (5 services)

The Ledger domain didn't exist in the 2026-03-01 baseline; it emerged with the real-money-ops design (2026-03-26). It owns settlement truth — what the broker actually filled — separately from intent (advisory + execution).

### ledger-hub

**Type:** hub · **Domain:** Ledger
**Stack:** `services/ledger/ledger-hub/src/service.stack.ts`

**Why this service exists.** Owns `ledger-bus` and the SSM parameters consumed by ledger-domain services.

**State.** None.

**Architectural Evolution.** Domain itself emerged 2026-03-26.

**Health.** canonical.

---

### ledger-ctrl

**Type:** ctrl · **Domain:** Ledger
**Stack:** `services/ledger/ledger-ctrl/src/service.stack.ts`

**Why this service exists.** Settlement truth — owns the canonical position table. Consumes execution-side fill events; updates positions; emits position-state events that feed reconciliation + dashboard projections.

**Key events.**
- Consumed (cross-domain via `ledger-adpt`): `ORDER_FILLED`, `ORDER_REJECTED`.
- Emitted: `POSITION_OPENED`, `POSITION_CLOSED`, `POSITION_UPDATED`, `LEDGER_PORTFOLIO_DRIFT_DETECTED` (renamed at the cross-domain boundary to `PORTFOLIO_DRIFT_DETECTED` for advisory consumers — SYSTEM-ARCHITECTURE.md §18).

**Architectural Evolution.** Underwent a 2026-04 rewrite (per user-memory `project_explicit_state_orchestration.md`) to align with the 6-construct CDK pattern.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; flows `flows/order-ledger.flow.yaml`, `flows/reconciliation.flow.yaml`.

---

### ledger-bff

**Type:** bff · **Domain:** Ledger
**Stack:** `services/ledger/ledger-bff/src/service.stack.ts`

**Why this service exists.** CQRS read side for portfolio positions — the GraphQL surface consumed by the Ledger MFE.

**State.** DDB projection table; AppSync GraphQL.

**MFE.** `apps/ledger-mfe/`.

**Architectural Evolution.** None.

**Open question.** BFF resolver region sweep is pending (per user-memory's "BFF resolver region sweep" item) — mutation resolvers may be missing the `region` field that `check-auth.fn.js` writes to `ctx.stash`. Verify.

**Health.** canonical (with open follow-up).

**Cross-references.** Service `CLAUDE.md` card.

---

### reconciliation-ctrl

**Type:** ctrl · **Domain:** Ledger
**Stack:** `services/ledger/reconciliation-ctrl/src/service.stack.ts`

**Why this service exists.** Periodic + event-driven reconciliation between intent (advisory) and settlement (ledger). Detects drift; triggers the advisory-side rebalance cycle on threshold breach; escalates to circuit-breaker on unsafe divergence.

**Key events.**
- Emitted: `LEDGER_PORTFOLIO_DRIFT_DETECTED`, `RECONCILIATION_COMPLETED`, `CORPORATE_ACTION_PROCESSED`.

**Architectural Evolution.** The ledger-ctrl 2026-04 rewrite split out reconciliation into this dedicated service (per user-memory).

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; `flows/reconciliation.flow.yaml`; SYSTEM-ARCHITECTURE.md §15.

---

### ledger-adpt

**Type:** adpt (cross-domain) · **Domain:** Ledger
**Stack:** `services/ledger/ledger-adpt/src/service.stack.ts`

**Why this service exists.** Pull-model cross-domain adapter — subscribes to execution-bus events (mainly `ORDER_FILLED`, `ORDER_REJECTED`) and republishes onto ledger-bus.

**Architectural Evolution.** None beyond the pull-model inversion.

**Health.** canonical.

**Cross-references.** SYSTEM-ARCHITECTURE.md §18.

---

## Closing notes

This document covers all 33 services as of 2026-04-30. Updates land via spec → plan → impl per `CLAUDE.md` "Canonical Architecture References" section. For event-detail tables and full handler manifests on a given service, `audit-service` regenerates the per-service `CLAUDE.md` from code.

Health-tag forecasts (subject to change with Spec 2):

- **transitional → canonical (Spec 2):** `advisory-ctrl` (after decision-lifecycle retirement).
- **canonical:** all other 32 services as of 2026-04-30.

No services currently carry the `dormant` tag — every entry has live consumers. `advisory-ctrl`'s control-plane *event vocabulary* has dormant entries (operations-ctrl absorbed events declared but no producer), but the service itself is live (decision-lifecycle path).
