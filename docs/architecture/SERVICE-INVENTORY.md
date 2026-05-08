# Service Inventory

> **Status:** Canonical reference. Per-service responsibility, key events, AI agents, knowledge bases, state, MFEs, and architectural-evolution annotations.
>
> **Companion document:** `docs/architecture/SYSTEM-ARCHITECTURE.md` (cross-cutting architecture).
>
> **Last whole-document review:** 2026-04-30.

For per-service code-anchored detail (event subscriptions, handlers, dependencies, tests), read each service's own `CLAUDE.md` card — those are regenerable from code via the `audit-service` skill and stay in sync with the implementation. This document is the cross-cutting view: *why* each service exists and where it sits in the architectural evolution.

---

## Inventory Summary

Total services: **32** (verified 2026-04-30 via `ls services/{advisory,execution,investor,ledger}/` minus `README.md`; advisory-ctrl removed by Spec 2 2026-04-30).

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
| 9 | advisory-bff | Advisory | bff | advisory-mfe | — | canonical |
| 10 | advisory-narrative-ctrl | Advisory | ctrl | — | Recommendation & Explainability | canonical |
| 11 | investor-profile-ctrl | Advisory | ctrl | — | User & Goals + Risk | canonical |
| 12 | market-intelligence-ctrl | Advisory | ctrl | — | Market & Research | canonical |
| 13 | portfolio-engine-ctrl | Advisory | ctrl | — | Portfolio Construction + Rebalance | canonical |
| 14 | decision-workflow-ctrl | Advisory | ctrl (orchestrator) | — | — (Step Functions) | canonical |
| 15 | compliance-ctrl | Advisory | ctrl | — | — (rule engine) | canonical |
| 16 | advisory-adpt | Advisory | adpt (cross-domain) | — | — | canonical |
| 17 | alpha-vantage-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 18 | fred-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 19 | marketwatch-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 20 | sec-edgar-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 21 | yahoo-finance-adpt | Advisory | adpt (3rd-party data) | — | — | canonical |
| 22 | execution-hub | Execution | hub | — | — | canonical |
| 23 | execution-ctrl | Execution | ctrl | — | — | canonical |
| 24 | broker-ctrl | Execution | ctrl (orchestrator) | — | — (Step Functions) | canonical |
| 25 | broker-sim-adpt | Execution | adpt (broker) | — | — | canonical |
| 26 | broker-alpaca-adpt | Execution | adpt (broker + circuit breaker) | — | — | canonical |
| 27 | execution-adpt | Execution | adpt (cross-domain) | — | — | canonical |
| 28 | ledger-hub | Ledger | hub | — | — | canonical |
| 29 | ledger-ctrl | Ledger | ctrl | — | — | canonical |
| 30 | ledger-bff | Ledger | bff | ledger-mfe | — | canonical |
| 31 | reconciliation-ctrl | Ledger | ctrl | — | — | canonical |
| 32 | ledger-adpt | Ledger | adpt (cross-domain) | — | — | canonical |

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

**Responsibilities.** Composite InvestorProfile projection (single DDB row holds goal, riskProfile, operatingMode, mandate, accountMode, executionMode); Mandate sibling aggregate row (sk='Mandate'); feature-flag mutations (used by circuit-breaker — see user-memory `project_cb_appsync_auth.md`); cross-domain read aggregation via `investor-adpt`.

**Key events consumed.** `USER_REGISTERED`, `NOTIFICATION_CREATED`, `BALANCE_UPDATED`, `ONBOARDING_COMPLETED`, `GO_LIVE_CONFIRMED`, `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `DEPOSIT_DETECTED`.

**Key events emitted (Egress shapes — post-resplit, 3-tier topology).** `InvestorProfile` row → `INVESTOR_PROFILE_CREATED` (INSERT) / `INVESTOR_PROFILE_UPDATED` (always on modify, carrier) / `OPERATING_MODE_CHANGED` (onFieldChange:operatingMode, semantic) / `GOAL_UPDATED` (onFieldChange:goal, semantic); `Mandate` row → `MANDATE_ISSUED` (INSERT, lifecycle) / `MANDATE_REVOKED` (modify, lifecycle); `Deposit` → `DEPOSIT_INITIATED` / `DEPOSIT_UPDATED`; `Withdrawal` → `WITHDRAWAL_REQUESTED` / `WITHDRAWAL_UPDATED`; `ExecutionModeChange` → `EXECUTION_MODE_CHANGED` / `EXECUTION_MODE_CHANGE_UPDATED`; `Notification` → `NOTIFICATION_READ`.

**State.** DDB projection table (composite InvestorProfile row + Mandate sibling row, sk='Mandate'); AppSync GraphQL.

**API surface.** AppSync GraphQL with Cognito-User-Pool authentication and IAM-signed write paths from sibling services. The `check-auth.fn.js` JS resolver detects IAM identity to bypass Cognito claims for cross-service mutations (per user-memory `project_cb_appsync_auth.md`).

**MFE.** `apps/investor-mfe/`. Shares its MFE bucket via the A3 per-BFF construct.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memories `project_cb_appsync_auth.md`, `feedback_bff_is_read_model.md`.

---

### investor-ctrl

**Type:** ctrl · **Domain:** Investor
**Stack:** `services/investor/investor-ctrl/src/service.stack.ts`

**Why this service exists.** Owns the Investor identity + notification subsystem. Despite the `ctrl` suffix this service handles cross-cutting investor notifications — there is **no `notification-ctrl` service**, that vocabulary is sometimes invented in error (per user-memory `feedback_investor_ctrl_not_notification.md`).

**Responsibilities.** Investor registration; identity write side; notification fan-out (system → user channels) via NOTIFICATION_TEMPLATES. Each notification template maps directly to the triggering event — no diff detection needed because the 3-tier topology produces one semantic event per change type.

**Key events consumed (15).** `ONBOARDING_COMPLETED`, `MANDATE_ISSUED`, `MANDATE_REVOKED`, `OPERATING_MODE_CHANGED`, `GOAL_UPDATED`, `DEPOSIT_INITIATED`, `DECISION_APPROVED`, `ORDER_FILLED`, `BALANCE_UPDATED`, `ORDER_REJECTED`, `DECISION_BLOCKED`, `WITHDRAWAL_COMPLETED`, `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED`.

**Key events emitted.** `Notification` → `NOTIFICATION_CREATED` / `NOTIFICATION_UPDATED`; `MonthlyReport` → `MONTHLY_REPORT_CREATED` / `MONTHLY_REPORT_UPDATED`.

**Architectural Evolution.** Notification-lifecycle resplit 2026-05-08: legacy `INVESTOR_PROFILE_UPDATED` diff-detect handler removed. Now subscribes directly to semantic events (`OPERATING_MODE_CHANGED`, `GOAL_UPDATED`) and lifecycle events (`MANDATE_ISSUED`, `MANDATE_REVOKED`). 14 → 15 subscriptions (net: dropped `INVESTOR_PROFILE_UPDATED`, added `OPERATING_MODE_CHANGED` + `GOAL_UPDATED`).

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; user-memory `feedback_investor_ctrl_not_notification.md`.

---

### dashboard-bff

**Type:** bff · **Domain:** Investor
**Stack:** `services/investor/dashboard-bff/src/service.stack.ts`

**Why this service exists.** CQRS read side for the Investor home dashboard. Aggregates portfolio state + active decisions + recent activity into a single GraphQL view. Separate from `investor-bff` because the dashboard's read patterns + WSS subscription topology differ enough to justify a dedicated projection.

**Responsibilities.** Dashboard projection table; WebSocket subscription broadcasts on AppSync (mind the subscription-filter pitfall — every `@aws_subscribe` filter arg must be on the return type, resolver response, AND the publisher's mutation selection per user-memory `feedback_appsync_subscribe_filter_args.md`).

**Key events consumed.** `BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `RECONCILIATION_COMPLETED`, `DECISION_PACKET_CREATED`, `USER_CONFIRMATION_REQUESTED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `LEDGER_ENTRY_RECORDED`, `INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`. Post-collapse: the 6 legacy per-entity events (GOAL_*, RISK_PROFILE_*, OPERATING_MODE_*) replaced by the 2 composite events; the investor-snapshot transform reads goal, riskProfile, operatingMode from the composite payload.

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

**Responsibilities.** AG-UI bridge endpoint (Hono server in `services/investor/onboarding-bff/src/`); LangGraph wizard graph (`services/investor/onboarding-bff/agents/onboarding/graph.ts`); Bedrock KB query for RAG-backed answers; phase progression (7 phases) culminating in the `ONBOARDING_COMPLETED` event that investor-bff materialises into the composite `InvestorProfile` row + `MandateStatus` lifecycle row (post-collapse 2026-05-03).

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

## Advisory Domain (14 services)

### advisory-hub

**Type:** hub · **Domain:** Advisory
**Stack:** `services/advisory/advisory-hub/src/service.stack.ts`

**Why this service exists.** Owns `advisory-bus` and the SSM parameters consumed by advisory-domain services — including the model inference-profile IDs (`models/opus`, `models/sonnet`, `models/haiku`) referenced from `agent-orchestrator` (per advisory-ctrl `CLAUDE.md`).

**State.** None.

**Architectural Evolution.** None.

**Health.** canonical.

---

### advisory-bff

**Type:** bff · **Domain:** Advisory
**Stack:** `services/advisory/advisory-bff/src/service.stack.ts`

**Why this service exists.** CQRS read side for the advisory domain — Decision Packet projections, Recommendation projections, decision-list views consumed by the Advisory MFE.

**Responsibilities.** Decision Packet projection (the highest-traffic read model in the system); decision-list filters; subscription broadcasts when packets transition state.

**Key events consumed.** `DECISION_PACKET_CREATED`, `DECISION_PACKET_UPDATED` (sole emitter: `decision-workflow-ctrl` — see SYSTEM-ARCHITECTURE.md §10.1), `RECOMMENDATION_PROPOSED|APPROVED|BLOCKED|AWAITING_CONFIRMATION`.

**State.** DDB projection table; AppSync GraphQL.

**API surface.** AppSync GraphQL with Cognito + IAM auth.

**MFE.** `apps/advisory-mfe/`.

**Architectural Evolution.** Hosts the 2026-04-30 defence-in-depth guards (commits `429afa7a` + `3dcad1eb`): `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts` skips events that carry neither `explanation` nor `proposedTrades`; `services/advisory/advisory-bff/src/handlers/event-listener.ts` copies `explanation` from the UPDATE path with `attribute_exists(pk)` condition. These guards remain as defence-in-depth now that Spec 2 removed the dual emitter. See SYSTEM-ARCHITECTURE.md §10.1.

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
- TRIGGER_EVENT_TYPES (7, direct EB → SF): `INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`. Wired declaratively on `Orchestration.triggers`; no TriggerIngress, no WorkflowTrigger DDB row, no `WORKFLOW_TRIGGER_CREATED` hop.
- Callback-consumed: `INVESTOR_PROFILE_COMPLETED`, `MARKET_ANALYSIS_COMPLETED`, `PORTFOLIO_COMPLETED`, `NARRATIVE_COMPLETED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `USER_CONFIRMED`, `USER_REJECTED`.
- Emitted: `DECISION_PACKET_CREATED` (canonical, post-AssemblePacket — `assemble-packet.ts:70`), `DECISION_PACKET_UPDATED`, `AGENT_OUTPUT_CREATED`, `AGENT_OUTPUT_UPDATED`.

**State.** DDB DecisionPacket + AgentOutput tables (the canonical post-2026-03-18 owner); AgentCore Memory resource (per the §17 contract). WorkflowTrigger row removed by InvestorProfile collapse Phase 2 (2026-05-03).

**Architectural Evolution.** Introduced 2026-03-17 (commit `a54006c9`). Became the sole `DECISION_PACKET_CREATED` emitter when advisory-ctrl was removed by Spec 2 (2026-04-30) — see SYSTEM-ARCHITECTURE.md §10.1. The AgentCore Memory namespace alignment (§17.1) was also landed in Spec 2: `writeAgentOutput` now uses `BatchCreateMemoryRecordsCommand`; `readUpstreamOutput` uses `ListMemoryRecordsCommand` against the same namespace. The 8th-Playwright-session bug fix (commit `429afa7a`) lives in this service: `AssemblePacket` reads agent outputs from SF task results before creating the row + persists `explanation`. **InvestorProfile collapse Phase 2 (2026-05-03)** moved the trigger ingestion from the TriggerIngress + WorkflowTrigger row aggregator to direct EB → SF, eliminating the 11-event-list-with-duplication anti-pattern (now 7 events, one SF execution per trigger).

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §7, §10, §10.1, §13, §17.1; `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md` (recovered 2026-05-01 by Spec 4).

---

### compliance-ctrl

**Type:** ctrl (rule engine) · **Domain:** Advisory
**Stack:** `services/advisory/compliance-ctrl/src/service.stack.ts`

**Why this service exists.** The single gate between agent-proposed recommendations and execution. Rule-based (deterministic), **not** an LLM. Enforces mandate guardrails + operating-mode parameters (§14) on the assembled Decision Packet; classifies as L1 (auto-execute) / L2 (user-confirm) / Blocked.

**Key events.**
- Consumed: `RECOMMENDATION_PROPOSED`, `MANDATE_ISSUED`, `OPERATING_MODE_CHANGED`, `MANDATE_REVOKED`. The semantic and lifecycle events project the `GuardrailPolicy` (MandateSnapshot) that the rule engine consumes. `MANDATE_ISSUED` bootstraps the policy on first onboarding. `OPERATING_MODE_CHANGED` re-projects the 8 guardrail fields when the mode changes. `MANDATE_REVOKED` sets `MandateSnapshot.status='REVOKED'`, which MandateValidator's REVOKED gate short-circuits the rule engine on.
- Emitted: `DECISION_APPROVED`, `DECISION_BLOCKED` (field-dispatch on `ComplianceCheck.result`), `AUDIT_ARTIFACT_CREATED`, `AUDIT_ARTIFACT_UPDATED`.

**Architectural Evolution.** InvestorProfile collapse Phase 3 (2026-05-03): subscribed to carrier events (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`). Domain resplit (2026-05-08): swapped to semantic/lifecycle events — `MANDATE_ISSUED`, `OPERATING_MODE_CHANGED`, `MANDATE_REVOKED` — removing the dependency on the composite payload shape. The GUARDRAIL_TABLE policy is now owned entirely within compliance-ctrl (`src/rules/guardrail-params.ts`). MandateSnapshot shape: `{level, status, operatingMode, effectiveDate}`.

**Health.** canonical.

**Cross-references.** Service `CLAUDE.md` card; SYSTEM-ARCHITECTURE.md §6, §8.

---

### advisory-adpt

**Type:** adpt (cross-domain) · **Domain:** Advisory
**Stack:** `services/advisory/advisory-adpt/src/service.stack.ts`

**Why this service exists.** Pull-model cross-domain adapter for the Advisory domain. Subscribes to investor-bus + ledger-bus + execution-bus events the Advisory domain needs (mandate events, portfolio drift, order outcomes, etc.) and republishes onto advisory-bus.

**Forwarding rules.**
- Investor → Advisory (4 events): `INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `MANDATE_ISSUED`, `MANDATE_REVOKED`. The carrier (`INVESTOR_PROFILE_UPDATED`) is forwarded for decision-workflow-ctrl triggers; the lifecycle events are forwarded for compliance-ctrl guardrail management. Semantic events (`OPERATING_MODE_CHANGED`, `GOAL_UPDATED`) are NOT forwarded cross-domain — compliance-ctrl subscribes to them directly on InvestorBus via the advisory-adpt Ingress.
- Execution → Advisory (4): `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`.
- Ledger → Advisory (2): `PORTFOLIO_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`.

**Architectural Evolution.** Pull-model inversion (`project_inverted_adapter_routing.md`); InvestorProfile collapse Phase 6 (2026-05-03) reduced the FromInvestor rule from 7 → 4 events. Domain resplit (2026-05-08): forwarding count unchanged at 4; compliance-ctrl now receives `OPERATING_MODE_CHANGED` via its own Ingress subscription (not via advisory-adpt forwarding).

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

**Architectural Evolution.** Split during the 2026-03-26 real-money-operations design (`docs/superpowers/specs/2026-03-26-real-money-ops-design.md` + companions `2026-03-26-broker-ctrl-sf-native-design.md`, `2026-03-26-broker-ctrl-sf-state-machine.md`; recovered 2026-05-01 by Spec 4) — `broker-ctrl` owns the SF state machine; `broker-{sim,alpaca}-adpt` own the broker-specific protocols. The split lets us add brokers (e.g. IBKR) without changing the orchestration layer.

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

This document covers all 32 services as of 2026-04-30 (advisory-ctrl removed by Spec 2). Updates land via spec → plan → impl per `CLAUDE.md` "Canonical Architecture References" section. For event-detail tables and full handler manifests on a given service, `audit-service` regenerates the per-service `CLAUDE.md` from code.

Health-tag state (post Spec 2, 2026-04-30):

- **canonical:** all 32 services. No transitional, legacy, or dormant entries remain.

No services currently carry the `dormant` tag — every entry has live consumers.
