# System Architecture Documentation Foundation — Design

**Date:** 2026-04-30
**Status:** Draft, pending user review
**Workstream:** Spec 1 of 3 (this) → Spec 2 advisory-pipeline-consolidation → Spec 3 onboarding-agent-reliability
**Originating diagnosis:** session 2026-04-30; the dual `DECISION_PACKET_CREATED` emitter question could only be answered by recovering deleted git-history docs (`specs/2_system_architecture.md` @ `eac934d5`, `specifications/04-service-decomposition/service-inventory.md` @ `fa15bbfd~1`). Current `specifications/` is a 5-file high-level summary that does not capture per-service responsibility, event ownership, or rationale for non-obvious architectural choices.

## Problem

A future Claude (or human) opening this codebase has no canonical document that explains, for each service:

- Why it exists (bounded-context responsibility)
- Which events it owns (publishes via CDC) vs consumes (ingress)
- Which AI agents it hosts (if any)
- Its state model
- Architectural rationale where current code diverges from the obvious shape

The existing artefacts are:

| Artefact | Scope | Gap for our use case |
|---|---|---|
| `specifications/01..04-*.md` (5 files, ~700 lines) | High-level business + design summary | No per-service inventory; no event ownership tables; doesn't name `advisory-ctrl` vs `decision-workflow-ctrl` |
| `flows/*.flow.yaml` (14 files) | Workflow-level traversal | Per-flow, not per-service; doesn't say *why* a service is shaped the way it is |
| `docs/data-flows/*.md` (14 files) | Generated from flows | Same scope as flows; readable narrative but flow-scoped |
| `docs/architecture/nestfolio.d2` + C4 SVGs | Visual topology | No prose rationale; no event tables |
| `docs/superpowers/specs/*.md` (40+ design specs) | Per-change records | Fragmented; reading them sequentially is not how you onboard |
| Per-service `CLAUDE.md` cards | Per-service current state | Code-anchored snapshot, no rationale, no cross-cutting reasoning |

The richest historical artefacts that filled this gap have been deleted from `main`:

- `specs/2_system_architecture.md` (commit `eac934d5`, 2026-03-01) — **1672 lines**: domains, agent topology, decision authority, event taxonomy, decision packet, idempotency, projections, lifecycle, operating modes, portfolio truth, reconciliation, circuit breakers
- `specifications/04-service-decomposition/service-inventory.md` (last live at `fa15bbfd~1`, 2026-03-24) — per-service responsibility, events published/consumed, AI agents, knowledge bases, state, microfrontends
- `specifications/04-service-decomposition/event-flows.md`
- `specifications/02-system-architecture/agent-system.md`
- `specifications/02-system-architecture/portfolio-management.md`
- `specifications/05-implementation-patterns/code-patterns.md`, `testing.md`
- `specifications/06-governance-compliance.md`, `07-operations-deployment.md`
- `specifications/08-ui-ux/screen-inventory.md`, `interaction-patterns.md`

The 2026-04-14 "restore and consolidate" commit (`daa8c087`) replaced these with summary versions. The summary preserves the high-level shape but loses the per-service detail and the rationale that lets a reader answer questions like *"why do two services emit the same event?"*

## Goal

Produce two canonical, code-anchored reference documents that anchor all future architectural reasoning. Linked from `CLAUDE.md` so every future session reads them before touching architecturally non-trivial code.

## Outputs

### 1. `docs/architecture/SYSTEM-ARCHITECTURE.md`

**Source baseline:** `git show eac934d5:specs/2_system_architecture.md` (1672 lines). Recover and reconcile against current code.

**Section structure (preserved from source, updated content):**

| § | Section | Notes |
|---|---|---|
| 1 | Purpose, Audience, How to Read | New section. Explicit: this is a canonical reference; updates land via spec → plan → impl; "next review" date set per release. |
| 2 | Product Summary | One-paragraph product framing |
| 3 | System Goals | Trust + safety + auditability + cost discipline |
| 4 | High-Level System Domains | **Update to 4 domains** (was 5 in original — Platform Infrastructure folded into the others). Investor / Advisory / Execution / **Ledger** (Ledger domain didn't exist in 2026-03-01, must be added). |
| 5 | Core Architectural Principles | Event-only inter-domain communication, single-writer, 6-construct CDK pattern, deterministic orchestration + governed agents, dual-truth model |
| 6 | Decision Authority Model (L1 / L2) | Hybrid authority — L1 autonomous within mandate guardrails, L2 requires user confirmation |
| 7 | Agent Topology | **Update to current 4-ctrl decomposition.** Original spec had 6 agents in advisory-ctrl: User & Goals, Risk, Market & Research, Portfolio Construction, Rebalance Planner, Recommendation & Explainability. Current code maps these to 4 ctrl services with their own AgentRuntimes: `investor-profile-ctrl` (User & Goals + Risk), `market-intelligence-ctrl` (Market & Research), `portfolio-engine-ctrl` (Portfolio Construction + Rebalance Planner), `advisory-narrative-ctrl` (Recommendation & Explainability). Plus `onboarding-bff` (Conversational onboarding agent), `advisory-ctrl/decision-lifecycle` (legacy multi-agent LangGraph — see Architectural Evolution note 7.1). Document the orchestrator/intelligence/compliance/execution layered topology. |
| 7.1 | **NEW: Architectural Evolution — 6→4 agent decomposition** | Why the original "all 6 agents in advisory-ctrl" became "1 ctrl per agent cluster orchestrated by SF". Surfaces the rationale that's currently undocumented. |
| 8 | Compliance Boundary | `compliance-ctrl` as the gate; rule engine; mandate validation; L1/L2 escalation logic |
| 9 | Event Sourcing & Event Taxonomy | Why event-sourced; canonical record shape (id/type/timestamp/subject/context); intra-domain vs cross-domain via `-adpt`; event categories (User & Mandate, Portfolio State, Decision & Planning, Execution, Explainability & Reporting). Reference `libs/event-types` for branded names. |
| 10 | Decision Packet | Canonical schema; immutability; CDC propagation; current implementation maps to `DecisionPacket` DDB row in `decision-workflow-ctrl` and `advisory-ctrl` (the dual-emitter — see Architectural Evolution 10.1) |
| 10.1 | **NEW: Architectural Evolution — Dual `DECISION_PACKET_CREATED` emitters** | Pre-2026-03-18: `advisory-ctrl` was the single SF orchestrator. Post-2026-03-18 (per `2026-03-18-agentcore-memory-design.md`): `decision-workflow-ctrl` introduced as the canonical orchestrator owning Memory + delegating to 4 agent ctrls. `advisory-ctrl` was supposed to retire its decision-lifecycle code and become the control plane (model lifecycle + incidents + budgets + reasoning-tier — absorbed from the original `operations-ctrl`). Decision-lifecycle code was never removed → both currently emit `DECISION_PACKET_CREATED`. **Spec 2 will land the cleanup**; this doc records the design intent so the cleanup is no longer "by inference". |
| 11 | Idempotency & Safety Rules | Single-writer execution; idempotency keys; dedupe & replay; `putIfNotExists` patterns; SF task-token at-most-once; SQS retry semantics |
| 12 | Projections (Read Models) | BFF tables as CQRS read side; `record()` / `update()` intents; status transition tables (DECISION_PACKET_UPDATED → COMPLIANCE_REVIEW etc.); explanation/proposedTrades/agentInvocations propagation |
| 13 | Decision Lifecycle (End-to-End) | Trigger → SF start → 4 agents fan-out → AssemblePacket → RECOMMENDATION_PROPOSED → compliance check → APPROVED/BLOCKED → user confirmation (L2) → CONFIRMED/REJECTED. Reference `flows/advisory-cycle.flow.yaml` for the wire-level steps. |
| 14 | Operating Modes & Guardrails | Conservative / Balanced / Aggressive; per-mode parameters (max single trade %, monthly turnover cap, drawdown circuit breaker, drift trigger, cool-down, ETF concentration, equity risk band); mode change protocol |
| 15 | Portfolio Truth & Reconciliation | Dual truth (intent vs settlement); reconciliation cadence; circuit-breaker integration; corporate actions |
| 16 | Circuit Breakers | Trigger conditions; pause/resume protocol; recovery validation gates; cross-domain notification (broker → advisory → investor) |
| 17 | AgentCore Memory Contract | **NEW.** Namespace convention (`/{serviceName}/{actorId}/{scope}` where scope = `decisions/{decisionId}` for short-term, `preferences|signals|rationale|sessions/{sessionId}` for long-term). Strategy mapping per namespace. Reference `libs/agent-orchestrator/src/memory/memory-client.ts`. **Currently the implementation diverges from the contract** — `writeAgentOutput` writes to a session via `CreateEventCommand`, not to the `decisions/{decisionId}` namespace; reads find no data. Spec 2 lands the alignment; this doc records the canonical contract. |
| 18 | Cross-Domain Routing | The `-adpt` pull model; one adapter per domain; consumer owns its EB rules; cross-domain event renames (e.g. `LEDGER_PORTFOLIO_DRIFT_DETECTED → PORTFOLIO_DRIFT_DETECTED`) |
| 19 | Knowledge Bases | Per-service Bedrock KBs; S3 vector buckets; ingestion via DDB stream → SQS → Lambda; query at agent inference time; KB vs Memory complementarity (KB = authoritative external, Memory = behavioural/session) |
| 20 | Frontend Topology | MFE federation via Native Federation; per-route Apollo + AppSync GraphQL; per-BFF MFE buckets + CloudFront unified topology; `frontend-deps` shared singleton surface |
| 21 | Open Questions | Items the writing process surfaces but doesn't resolve here |
| 22 | Glossary | Decision Packet, Mandate, Operating Mode, Authority Level, Account Mode (SIM/LIVE), Reasoning Tier, etc. |
| 23 | Related Documents | Flows, C4 diagrams, service inventory, design specs, CLAUDE.md, service cards |
| 24 | Maintenance | "Updates land via spec→plan→impl"; review cadence; ownership |

**Update protocol — for each section the writer:**

1. Reads the source baseline section (where present; new sections start fresh)
2. Reconciles against current code: file paths cited inline (e.g. `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:131`)
3. Where current code diverges from the original spec, adds an **Architectural Evolution** subsection that names the divergence, the spec/commit that introduced it, and the present-day rationale
4. Where current code is ambiguous, adds an **Open Question** entry to §21 with proposed resolution (input to Spec 2)
5. Cites the existing flow specs / C4 diagrams / service cards rather than restating their content

### 2. `docs/architecture/SERVICE-INVENTORY.md`

**Source baseline:** `git show fa15bbfd~1:specifications/04-service-decomposition/service-inventory.md`. Recover and expand to current 33 services.

**Top-level structure:**

```markdown
# Service Inventory

## Inventory Summary
| # | Service | Domain | Type | Has MFE | Has AI Agent | Status |
... (33 rows)

## Domain Sections
- Investor Domain: investor-hub, investor-web, investor-bff, investor-ctrl, dashboard-bff, onboarding-bff, investor-adpt
- Advisory Domain: advisory-hub, advisory-ctrl, advisory-bff, advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, decision-workflow-ctrl, compliance-ctrl, advisory-adpt
- Execution Domain: execution-hub, execution-ctrl, broker-ctrl, broker-sim-adpt, broker-alpaca-adpt, execution-adpt
- Ledger Domain: ledger-hub, ledger-ctrl, ledger-bff, reconciliation-ctrl, ledger-adpt
```

(Verify exact 33 against `Glob services/*/*-*` during writing — the count came from MEMORY.md and may need a fresh sweep.)

**Per-service section template:**

```markdown
### {service-name}

**Type:** {bff | ctrl | adpt | hub | web} · **Domain:** {investor | advisory | execution | ledger}

**Stack:** `services/{domain}/{service}/src/service.stack.ts` (link to file, anchor to a known line if helpful)

**Why this service exists** — one paragraph. Bounded-context responsibility. Why a *separate* service rather than a feature inside another.

**Responsibilities** — bullet list of cohesive responsibilities owned by this service.

**Events Published** — table: event name → CDC source (DDB row + action) → consumers
**Events Consumed** — table: event name → upstream service → handler

**AI Agents** (if any) — agent name, model tier, runtime kind (in-process / AgentCore Runtime / AgentCore Bridge), tools, memory namespaces

**State** — DDB tables, GSIs, S3 buckets, KB indexes

**API surface** (BFFs only) — GraphQL operations + auth model

**MFE** (BFFs only) — MFE bucket name, route shell, federation key

**Architectural Evolution** (where applicable) — name the divergence from the obvious shape and the spec/commit that introduced it. Concrete examples we already know we'll need:

- `advisory-ctrl`: vestigial decision-lifecycle code; was the original SF orchestrator pre-2026-03-18; absorbed `operations-ctrl`'s vocabulary; **Spec 2 will retire the decision-lifecycle subsystem**.
- `decision-workflow-ctrl`: introduced 2026-03-17 (commit `a54006c9`); replaces advisory-ctrl as the canonical SF orchestrator per `2026-03-18-agentcore-memory-design.md`; owns the Memory resource and delegates agent execution to 4 separate ctrl services.
- `investor-profile-ctrl` / `market-intelligence-ctrl` / `portfolio-engine-ctrl` / `advisory-narrative-ctrl`: emerged from the 2026-03-18 split; collectively cover what was originally a 6-agent in-process LangGraph in advisory-ctrl. The 6→4 mapping is documented in SYSTEM-ARCHITECTURE.md §7.
- `operations-ctrl`: **does not exist as a deployable service.** Its events (`SHADOW_RUN_*`, `MODEL_*`, `INCIDENT_*`, `CIRCUIT_BREAKER_*`, `HEALTH_CHECK_*`, `TENANT_BUDGET_*`) were absorbed into `advisory-ctrl` when that service was repurposed as the control plane.
- `dashboard-bff`: late addition; CQRS read side for the Investor home dashboard; broadcasts via WSS subscriptions.
- `onboarding-bff`: hybrid — both BFF (CopilotKit bridge endpoint) and AgentCore Runtime host (in-process LangGraph wizard).
- `broker-ctrl` + `broker-{sim,alpaca}-adpt`: split during the real-money-ops design (2026-03-26) — broker-ctrl owns the SF state machine, adapters own broker-specific protocol.

**Health** — status indicator: `canonical` (matches design) · `transitional` (active divergence; Spec X will land alignment) · `legacy` (will be retired; Spec X) · `dormant` (deployed but unused; reason)

**Cross-references** — service `CLAUDE.md` card, relevant flow specs, design specs that shaped this service.
```

### 3. `CLAUDE.md` integration

Add a section near the top (after "General Guidelines for working with Nx", before "System Model"):

```markdown
## Canonical Architecture References

Before any architecturally non-trivial change, read:

- `docs/architecture/SYSTEM-ARCHITECTURE.md` — domains, agent topology, decision lifecycle, event taxonomy, AgentCore Memory contract
- `docs/architecture/SERVICE-INVENTORY.md` — per-service responsibility, events published/consumed, AI agents, current health (canonical / transitional / legacy / dormant)

These supersede `specifications/02-system-design.md` (kept as a high-level summary) for service-level reasoning. Service-card `CLAUDE.md` files remain authoritative for current code state per service.
```

The existing "Skill Routing" + "Hard Constraints" sections stay where they are.

## Method

The two docs land together in one PR (Spec 1 → Plan 1 → execution). The plan will:

1. **Phase A — Recovery scaffolding (one commit per file):**
   - `git show eac934d5:specs/2_system_architecture.md > docs/architecture/SYSTEM-ARCHITECTURE.md` as the literal starting point. Add a header banner identifying it as a recovery in progress.
   - `git show fa15bbfd~1:specifications/04-service-decomposition/service-inventory.md > docs/architecture/SERVICE-INVENTORY.md` as the literal starting point.
   - Commit. The recovered text will be wrong-in-places but auditable as a starting point.

2. **Phase B — Section-by-section reconciliation:**
   For each section in SYSTEM-ARCHITECTURE.md (24 sections), one commit:
   - Read source.
   - Run targeted greps / file reads in `services/`, `libs/`, `flows/` to verify each claim.
   - Update content; cite file paths inline.
   - Add Architectural Evolution subsection where current diverges from source.
   - Add Open Questions to §21 where resolution requires user input.
   Sections 7 (Agent Topology), 10 (Decision Packet), 17 (Memory Contract), 18 (Cross-Domain Routing) are the highest-value and should land first.

3. **Phase C — Service inventory expansion:**
   For each of ~33 services (one commit per domain group of 5–8):
   - Verify service exists (`Glob services/*/*-*`)
   - Read `service.stack.ts` for stacks/CDK, `domain/events.ts` for event types, `CLAUDE.md` for current narrative.
   - Author per-service section using the template above.
   - Tag Health.

4. **Phase D — CLAUDE.md integration:**
   Add the "Canonical Architecture References" section. Update `MEMORY.md` user-memory pointer to mention the two new docs.

5. **Phase E — Cross-link audit:**
   Validate every link (file paths, flow specs, C4 diagrams, design specs) resolves. No broken refs.

6. **Phase F — Self-review:**
   Apply `superpowers:requesting-code-review` checks: placeholder scan, internal consistency, scope check, ambiguity check.

## Constraints

- **Code-anchored.** Every architectural claim cites a file path. If a claim can't be cited, it's a hypothesis that goes to Open Questions.
- **What vs why separated.** Each service's "Responsibilities" lists *what*; "Why this service exists" gives *why*. Don't conflate.
- **Architectural Evolution sections are mandatory** wherever current code diverges from the obvious shape. The dual-emitter situation, the 6→4 agent decomposition, the absorbed `operations-ctrl`, the AgentCore Memory namespace mismatch — each must be named explicitly with the originating spec/commit.
- **No code changes.** Spec 2 lands the dual-emitter cleanup and the Memory namespace alignment. Spec 1 only documents.
- **Existing CLAUDE.md service cards stay.** They are the per-service code-level snapshot; SERVICE-INVENTORY.md is the cross-cutting reference. They are not duplicates.
- **Existing flow specs stay.** SYSTEM-ARCHITECTURE.md §13 cites them rather than restating their content.

## Non-goals

- New C4 diagrams. Existing `docs/architecture/c3/` SVGs cover the topology adequately for now; regenerating them is a separate task once the architecture stabilises post-Spec 2.
- Any code change. Doc-only.
- Refactoring `specifications/`. The 5-file summary stays as the executive overview; the new architecture docs sit beside it as the detailed reference.
- Per-service `CLAUDE.md` card refresh. Out of scope; they are regenerable from code via `audit-service` skill when needed.
- Resolving the dual-emitter / Memory / Lambda timeout fixes. That's Spec 2.
- Onboarding agent flakiness fix. That's Spec 3.

## Open questions surfaced (will resolve during writing)

1. **Service count.** Memory says 33; need fresh `Glob services/*/*-*` to verify and reconcile against the inventory.
2. **`onboarding-bff` AgentRuntime status post-2026-04-28 redesign.** The runtime moved to in-process `OnboardingAgent extends AbstractAgent`. Is the AgentCore Runtime still the production target, or is the Hono bridge running standalone? Need to read `services/investor/onboarding-bff/src/service.stack.ts` to confirm current shape.
3. **`advisory-ctrl/decision-lifecycle` AgentRuntime fate.** It deploys today; under Spec 2 it gets retired. Document as "legacy — Spec 2 retirement target" in SERVICE-INVENTORY.md, or wait until Spec 2 lands? **Proposed resolution:** document now with `legacy` health tag and a forward-pointer to Spec 2. Updates land when Spec 2 ships.
4. **Operations-ctrl absorption — clean or messy?** Did all `SHADOW_RUN_*`, `MODEL_*`, `INCIDENT_*` events get reused by current code, or are some emitted by no one and consumed by no one? Need a sweep to identify dormant event names. **Proposed resolution:** SERVICE-INVENTORY.md `advisory-ctrl` section names which event categories are live and which are reserved-for-future.
5. **Ledger domain didn't exist in the 2026-03-01 spec.** Need to write Ledger-domain content from scratch using current `services/ledger/*` code + `flows/order-ledger.flow.yaml` + `flows/reconciliation.flow.yaml` + `2026-03-26-real-money-operations-design.md` as input.
6. **AgentCore Memory contract's `decisions/{decisionId}` namespace has no extraction strategy.** SYSTEM-ARCHITECTURE.md §17 must document the *intended* contract; the current implementation gap is captured as a known divergence resolved in Spec 2.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Doc drift after ship | "Next review" date in each doc header; CLAUDE.md references oblige future sessions to read them; revisions land via spec→plan→impl loop |
| Length intimidating | Both docs are indexed. SYSTEM-ARCHITECTURE.md table-of-contents at top; SERVICE-INVENTORY.md alphabetised + grouped by domain |
| Reconciliation produces unanswerable questions | §21 Open Questions section with explicit "needs user input" tag; doc lands with the questions still open and Spec 2 / Spec 3 carries them forward |
| Recovery baseline contains obsolete claims | Phase B reconciliation walks every section; Architectural Evolution subsections name the divergences explicitly so a reader sees what changed |
| Spec 2 design contradicts a doc claim | Spec 2 will be authored against these docs; if Spec 2 needs to overrule a claim, that's a doc update inside Spec 2's plan rather than a brand-new spec |

## Success criteria

1. Both docs land on `main` with all 24 SYSTEM-ARCHITECTURE.md sections + all ~33 SERVICE-INVENTORY.md service sections written.
2. CLAUDE.md references both files in a "Canonical Architecture References" section.
3. Every architectural claim cites a file path or names an Open Question.
4. The dual-emitter situation is explicitly addressed in SYSTEM-ARCHITECTURE.md §10.1 and SERVICE-INVENTORY.md (`advisory-ctrl` + `decision-workflow-ctrl` Architectural Evolution subsections).
5. The AgentCore Memory namespace contract is explicitly addressed in SYSTEM-ARCHITECTURE.md §17.
6. The 6→4 agent decomposition is explicitly addressed in SYSTEM-ARCHITECTURE.md §7.1.
7. The `operations-ctrl` absorption is explicitly addressed in SERVICE-INVENTORY.md `advisory-ctrl` section.
8. A future Claude session reading only these two docs can answer a question like "why do two services emit `DECISION_PACKET_CREATED`?" without needing to dig into git history.

## Next step

After this spec is approved, the `superpowers:writing-plans` skill produces the implementation plan that walks Phases A–F above. Spec 2 (advisory pipeline consolidation) is authored *against* the now-canonical SYSTEM-ARCHITECTURE.md / SERVICE-INVENTORY.md; Spec 3 (onboarding reliability) lands independently.
