# System Architecture Documentation Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land two canonical, code-anchored architecture reference documents (`docs/architecture/SYSTEM-ARCHITECTURE.md` + `docs/architecture/SERVICE-INVENTORY.md`) recovered from git history (`eac934d5`, `fa15bbfd~1`) and reconciled to current 33-service code. Wire them into `CLAUDE.md` so future sessions read them before architectural changes.

**Architecture:** Doc-only PR. Six phases — (A) recover baselines verbatim from git, (B) reconcile each of 24 SYSTEM-ARCHITECTURE sections to current code with inline file-path citations and explicit "Architectural Evolution" subsections where the code diverges from the source, (C) expand SERVICE-INVENTORY to all 33 current services grouped by domain, (D) wire `CLAUDE.md` references, (E) audit cross-links resolve, (F) self-review against spec success criteria.

**Tech Stack:** Markdown docs only. No code change. Verification via `git show`, `Glob`, `Grep`, file reads. Commits frequent (one per section / per domain group).

**Source spec:** `docs/superpowers/specs/2026-04-30-system-architecture-docs-foundation-design.md` (commit `7f553072`).

---

## Pre-flight: Conventions for every task

Before each writing task, the writer:

1. Reads the corresponding spec section in `docs/superpowers/specs/2026-04-30-system-architecture-docs-foundation-design.md`.
2. For each architectural claim — runs a targeted `Grep` or `Read` to verify the cited file/line exists. If a claim cannot be cited, it goes to SYSTEM-ARCHITECTURE.md §21 "Open Questions" rather than into a section as a fact.
3. Cites file paths inline as `services/{domain}/{svc}/src/path/file.ts:LINE` — actual line numbers, not approximate.
4. Where current code diverges from recovered baseline content, adds an `**Architectural Evolution**` subsection naming: (a) what changed, (b) the spec or commit that introduced the change, (c) the present-day rationale.
5. Commits each task individually with a `docs(arch):` prefix so review can scope by section.
6. Never adds Claude attribution / co-authored trailer to commits in this plan (per repo convention — see recent commits on `main`).

---

## Phase A — Recovery scaffolding

Goal: get the two recovered files on disk verbatim from git history, committed, before any reconciliation. The recovered text will be wrong-in-places — that is intentional, the next phase walks every section and reconciles.

### Task A1: Recover SYSTEM-ARCHITECTURE.md baseline

**Files:**
- Create: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify source commit exists**

Run: `git rev-parse eac934d5`
Expected: prints `eac934d56c02ae312eafdb4835b01c9b74780fce` (or similar full SHA).

- [ ] **Step 2: Recover the file verbatim from git history**

Run: `git show eac934d5:specs/2_system_architecture.md > docs/architecture/SYSTEM-ARCHITECTURE.md`
Expected: file lands at the path with ~1672 lines. No errors.

- [ ] **Step 3: Verify line count is in expected range**

Run: `wc -l docs/architecture/SYSTEM-ARCHITECTURE.md`
Expected: line count >= 1500 (the file should be ~1672 lines).

- [ ] **Step 4: Prepend recovery banner**

Open `docs/architecture/SYSTEM-ARCHITECTURE.md` and insert at the very top (before the existing first line):

```markdown
> **Status: RECOVERY IN PROGRESS — content is the verbatim 2026-03-01 baseline (commit `eac934d5`). Phase B of the implementation plan reconciles every section to current code. Until reconciliation lands, treat this file as historical context, not as a current reference.**

```

(Blank line after the banner; the original H1 stays as the next non-blank line.)

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): recover SYSTEM-ARCHITECTURE.md baseline from eac934d5"
```

### Task A2: Recover SERVICE-INVENTORY.md baseline

**Files:**
- Create: `docs/architecture/SERVICE-INVENTORY.md`

- [ ] **Step 1: Resolve the source ref**

Run: `git rev-parse fa15bbfd~1`
Expected: prints a full SHA.

- [ ] **Step 2: Verify the source file exists at that ref**

Run: `git ls-tree -r fa15bbfd~1 -- specifications/04-service-decomposition/service-inventory.md`
Expected: prints one line ending with `specifications/04-service-decomposition/service-inventory.md`.

- [ ] **Step 3: Recover the file verbatim**

Run: `git show fa15bbfd~1:specifications/04-service-decomposition/service-inventory.md > docs/architecture/SERVICE-INVENTORY.md`
Expected: file lands at the path. No errors.

- [ ] **Step 4: Prepend recovery banner**

Open `docs/architecture/SERVICE-INVENTORY.md` and insert at the very top:

```markdown
> **Status: RECOVERY IN PROGRESS — content is the verbatim 2026-03-24 baseline (commit `fa15bbfd~1`). Phase C of the implementation plan expands this to current 33-service code. Until expansion lands, treat this file as historical context, not as a current reference.**

```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(arch): recover SERVICE-INVENTORY.md baseline from fa15bbfd~1"
```

---

## Phase B — SYSTEM-ARCHITECTURE.md section reconciliation

Each task below reconciles one section. The order intentionally lands the highest-value sections first (per spec Method §2): §7 Agent Topology, §10 Decision Packet, §17 Memory Contract, §18 Cross-Domain Routing — because these are the sections that shape Spec 2.

For every section the writer follows this template:

> 1. Read the recovered baseline section in `docs/architecture/SYSTEM-ARCHITECTURE.md`.
> 2. Run the verification commands listed in the task.
> 3. Rewrite the section in place, preserving its number and title, citing file paths inline.
> 4. If current code diverges from the baseline, add an `**Architectural Evolution**` subsection (the task lists the divergences to address).
> 5. If a claim cannot be verified, leave the claim out of the section and add a one-line entry to §21 Open Questions instead.
> 6. Commit.

The writer also maintains a running scratch list of Open Questions; each task that surfaces one appends to §21 in the same commit.

### Task B1: §1 Purpose, Audience, How to Read (NEW)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Replace §1 with the new purpose section**

Section content:

```markdown
## 1. Purpose, Audience, How to Read

**Purpose.** This document is the canonical architectural reference for the Nestfolio system. It explains, for each domain and major subsystem, *why* the code is shaped the way it is — bounded contexts, agent topology, decision lifecycle, event taxonomy, idempotency, projections, AgentCore Memory contract, and the architectural evolution that produced the current shape.

**Audience.** Future Claude sessions and human engineers making non-trivial architectural changes. For per-service current state, read the service's `CLAUDE.md` card. For workflow-level traversal, read `flows/*.flow.yaml`. For visual topology, see `docs/architecture/c3/`. This document supersedes none of those — it sits beside them as the cross-cutting reference.

**How to read.** Sections 2–5 are foundational. §6–§17 cover the decision pipeline end-to-end. §18–§20 cover cross-cutting concerns (routing, KBs, frontend). §21 captures known open questions. §22–§24 are reference material. Companion document: `docs/architecture/SERVICE-INVENTORY.md` (per-service inventory).

**Maintenance.** Updates land via spec → plan → implementation. See §24. Last reviewed: 2026-04-30.
```

- [ ] **Step 2: Remove the recovery banner from the top of the file**

The banner from Task A1 step 4 is now obsolete because §1 is updated. Delete the banner block (the `> **Status: RECOVERY IN PROGRESS...`).

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §1 — purpose & how to read"
```

### Task B2: §2 Product Summary

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Read source**

Read recovered §2 content already in `docs/architecture/SYSTEM-ARCHITECTURE.md`.

- [ ] **Step 2: Cross-check against current product framing**

Run: `Read specifications/01-product-vision.md` (entire file).

- [ ] **Step 3: Reconcile**

Rewrite §2 as one paragraph framing the product: AI-augmented investment advisory; per-investor mandates + operating modes; deterministic orchestration with governed agents; SIM and (future) LIVE broker accounts; auditable decisions. Cross-reference `specifications/01-product-vision.md` for full product detail.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §2 — product summary"
```

### Task B3: §3 System Goals

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Reconcile to current goals**

Section content:

```markdown
## 3. System Goals

1. **Trust** — every recommendation is auditable end-to-end via the immutable Decision Packet (§10).
2. **Safety** — compliance gate (§8) enforces mandate + operating-mode guardrails before any execution.
3. **Auditability** — event-sourced state (§9), single-writer per stream, idempotent handlers (§11).
4. **Cost discipline** — Lambda profiles, ARM64 AgentCore, per-tenant budget caps; reasoning tier downgrades (Sonnet→Haiku) under cost pressure.
5. **Operational resilience** — circuit breakers (§16), reconciliation cadence (§15), at-most-once SF task tokens.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §3 — system goals"
```

### Task B4: §4 High-Level System Domains (4 domains)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify domain count via filesystem**

Run: `ls services/`
Expected: `advisory  execution  investor  ledger` (4 directories).

- [ ] **Step 2: Verify Ledger domain content**

Run: `ls services/ledger/`
Expected: `ledger-adpt  ledger-bff  ledger-ctrl  ledger-hub  reconciliation-ctrl  README.md`.

- [ ] **Step 3: Reconcile §4 to 4 domains**

Section content (replacing the 5-domain baseline):

```markdown
## 4. High-Level System Domains

The system decomposes into four bounded contexts, each owning an EventBridge bus and a set of services. Inter-domain communication is exclusively via cross-domain adapters (`*-adpt`) using the pull model (§18).

| Domain | EventBridge Bus | Owned bounded context |
|---|---|---|
| **Investor** | `investor-bus` | Investor identity, profile, mandate, onboarding, dashboard projections, cross-cutting notifications |
| **Advisory** | `advisory-bus` | Decision lifecycle (trigger → recommendation), AI agent execution, compliance gating, control plane (incidents, budgets, model lifecycle) |
| **Execution** | `execution-bus` | Order routing, broker abstraction (SIM + Alpaca), execution state machine, circuit-breaker enforcement |
| **Ledger** | `ledger-bus` | Position truth (intent vs settlement), reconciliation, corporate actions, drift detection |

**Architectural Evolution — 5→4 domains.** The 2026-03-01 baseline named five domains (Investor, Advisory, Execution, *Ledger* didn't exist; Platform Infrastructure was a separate domain). Current code: Platform Infrastructure responsibilities folded into individual services (observability into `cdk-constructs`, IAM into per-service stacks); Ledger emerged as a first-class domain when reconciliation became a core concern (see `docs/superpowers/specs/2026-03-26-real-money-operations-design.md`). Cite: `services/ledger/` directory listing.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §4 — 4 domains incl. Ledger"
```

### Task B5: §5 Core Architectural Principles

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify the 6-construct CDK pattern**

Run: `ls libs/cdk-constructs/src/`
Expected: directory entries that include `state`, `ingress`, `egress`, `facade`, `agent-runtime`, `orchestration` (or close variants).

- [ ] **Step 2: Reconcile §5**

Cover: (a) event-only inter-domain communication (cite `feedback_no_api_between_services.md` if relevant + adapter convention); (b) single-writer per DDB row; (c) 6-construct CDK pattern (State, Ingress, Egress, Facade, AgentRuntime, Orchestration — all consumer-instantiated, explicitly wired via props — cite `libs/cdk-constructs/src/`); (d) deterministic orchestration (Step Functions) + governed agents (LangGraph); (e) dual-truth model (intent in Advisory/Execution, settlement in Ledger).

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §5 — core principles"
```

### Task B6: §7 Agent Topology + §7.1 Architectural Evolution (HIGH-VALUE)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify the four advisory agent ctrl services exist**

Run: `ls services/advisory/`
Expected output includes: `advisory-narrative-ctrl  investor-profile-ctrl  market-intelligence-ctrl  portfolio-engine-ctrl`.

- [ ] **Step 2: Verify decision-workflow-ctrl orchestrates them**

Run: `Grep "InvokeAgentRuntime\|StartExecution\|SendTask" services/advisory/decision-workflow-ctrl/src/ -l`
Expected: at least one match.

- [ ] **Step 3: Verify onboarding-bff hosts an in-process agent**

Run: `ls services/investor/onboarding-bff/agents/onboarding/`
Expected: at least `agent.ts` exists.

- [ ] **Step 4: Verify advisory-ctrl still has decision-lifecycle code**

Run: `Glob services/advisory/advisory-ctrl/src/**/decision-lifecycle*` (or equivalent).
If no match, broaden: `Grep "DECISION_PACKET_CREATED\|decision-lifecycle" services/advisory/advisory-ctrl/src/ -l`.
Expected: at least one hit (this is the vestigial code Spec 2 will retire).

- [ ] **Step 5: Look up the AgentCore memory design spec for the 6→4 split**

Run: `Glob docs/superpowers/specs/2026-03-1*-agentcore-memory*.md`
Expected: at least one match, e.g. `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`.

- [ ] **Step 6: Rewrite §7 — Agent Topology**

Section content (citing the verified file paths from steps 1–5):

```markdown
## 7. Agent Topology

The system runs **6 production AI agents** organised in a layered topology:

**Orchestrator layer.**
- `decision-workflow-ctrl` — Step Functions state machine that triggers the 4 advisory agents in parallel, writes results to AgentCore Memory, then assembles the Decision Packet (cite: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`).

**Intelligence layer (4 agent ctrl services, each with its own AgentCore Runtime).**
| Service | Original 6-agent role | Cluster | Model tier |
|---|---|---|---|
| `investor-profile-ctrl` | User & Goals + Risk | Investor profile inference | Haiku/Sonnet (per tier) |
| `market-intelligence-ctrl` | Market & Research | Market signal extraction | Sonnet |
| `portfolio-engine-ctrl` | Portfolio Construction + Rebalance Planner | Allocation + rebalance proposals | Sonnet |
| `advisory-narrative-ctrl` | Recommendation & Explainability | Recommendation rationale + explainability | Sonnet |

**Compliance layer.**
- `compliance-ctrl` — rule-based gate, not an LLM agent; enforces mandate + operating-mode guardrails on the assembled Decision Packet (§8).

**Execution-adjacent agents.**
- `onboarding-bff` — in-process LangGraph wizard hosted by the BFF, AG-UI streaming, 7-phase onboarding (cite: `services/investor/onboarding-bff/agents/onboarding/agent.ts`).

**Models.** All agents target Bedrock Claude inference profiles via `libs/agent-orchestrator`. Default profile: `us.anthropic.claude-sonnet-4-6`. Cost-pressure downgrade path: Sonnet → Haiku (cite: `libs/agent-orchestrator/src/agent-factory.ts`).

### 7.1 Architectural Evolution — 6→4 advisory agent decomposition

**Pre-2026-03-18.** A single `advisory-ctrl` service hosted **all 6 agents** (User & Goals, Risk, Market & Research, Portfolio Construction, Rebalance Planner, Recommendation & Explainability) as one in-process LangGraph; Step Functions sat in front of `advisory-ctrl` only as a trigger.

**Post-2026-03-18** (per `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`). The 6 agents were clustered into 4 cohesive ctrl services, each hosting its own AgentRuntime (User & Goals + Risk → `investor-profile-ctrl`; Market & Research → `market-intelligence-ctrl`; Portfolio Construction + Rebalance Planner → `portfolio-engine-ctrl`; Recommendation & Explainability → `advisory-narrative-ctrl`). A new orchestrator `decision-workflow-ctrl` was introduced (commit `a54006c9`, 2026-03-17) to fan out to the 4 ctrl services via Step Functions task tokens and assemble results from AgentCore Memory.

**Rationale for the split.**
- Memory locality: each agent owns its own Memory namespace and resource ARN.
- Independent deploy + scale per agent cluster.
- Per-cluster model tier control (cost discipline).
- Distinct timeout / retry / observability profiles.

**Vestigial code.** `advisory-ctrl` retains the original decision-lifecycle code paths (cite: `services/advisory/advisory-ctrl/src/`). Both `advisory-ctrl` and `decision-workflow-ctrl` currently emit `DECISION_PACKET_CREATED` (see §10.1). Spec 2 (advisory pipeline consolidation) retires the `advisory-ctrl` decision-lifecycle subsystem; `advisory-ctrl` becomes the control plane (model lifecycle + incidents + budgets + reasoning-tier).
```

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §7 — agent topology + 6→4 evolution"
```

### Task B7: §6 Decision Authority Model (L1 / L2)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify L1/L2 vocabulary in code**

Run: `Grep "authorityLevel\|L1\|L2" services/advisory/ libs/event-types/ -l`
Expected: at least one match. (If no match, the L1/L2 model is documented intent rather than runtime — note that in the section.)

- [ ] **Step 2: Reconcile §6**

Cover the hybrid authority model from the baseline: L1 = autonomous within mandate guardrails (small drift rebalances, scheduled DCAs); L2 = requires user confirmation (large allocation shifts, mode changes, account closures). Cite the relevant flow specs (`flows/advisory-cycle.flow.yaml`, `flows/withdrawal.flow.yaml`, `flows/account-closure.flow.yaml`). If the code does not encode L1/L2 as a typed field today, note it and add an Open Question to §21.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §6 — decision authority L1/L2"
```

### Task B8: §8 Compliance Boundary

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify compliance-ctrl shape**

Run: `ls services/advisory/compliance-ctrl/src/`
Expected: directory listing with handlers / rule engine.

Run: `Grep "RECOMMENDATION_PROPOSED\|COMPLIANCE_REVIEW\|APPROVED\|BLOCKED" services/advisory/compliance-ctrl/src/ -l`
Expected: matches in handler files.

- [ ] **Step 2: Reconcile §8**

Cover: compliance-ctrl as the single gate; rule engine (mandate + operating-mode guardrails); inputs `RECOMMENDATION_PROPOSED`; outputs `RECOMMENDATION_APPROVED` or `RECOMMENDATION_BLOCKED`; L1/L2 escalation routing. Cite `services/advisory/compliance-ctrl/src/...:LINE` for the rule-engine entry point.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §8 — compliance boundary"
```

### Task B9: §9 Event Sourcing & Event Taxonomy

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify libs/event-types is the canonical event registry**

Run: `ls libs/event-types/src/`
Expected: directory listing.

Run: `Grep "EventName" libs/event-types/src/ -l`
Expected: at least one match.

- [ ] **Step 2: Verify the canonical envelope shape**

Run: `Grep -n "envelope\|source\|detail-type\|EventBridge" libs/event-types/src/ libs/event-processor/src/ -l`
Expected: matches (record the shape from those files).

- [ ] **Step 3: Reconcile §9**

Cover: (a) why event-sourced (immutability, replay, audit); (b) canonical envelope (id, type/detail-type, time, source, detail); (c) intra-domain (direct on bus) vs cross-domain (via `*-adpt`); (d) event categories — User & Mandate, Portfolio State, Decision & Planning, Execution, Reporting & Explainability, Control Plane (model/incident/budget); (e) reference `libs/event-types` for branded `EventName`. Note: event names are free-form strings, **no closed suffix set** (cite `feedback_event_naming_freedom.md`).

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §9 — event sourcing & taxonomy"
```

### Task B10: §10 Decision Packet + §10.1 Architectural Evolution — Dual emitters (HIGH-VALUE)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify the canonical Decision Packet shape**

Run: `Grep -n "DecisionPacket\|DECISION_PACKET" libs/event-types/src/ -l`
Expected: matches with the type definition.

- [ ] **Step 2: Verify both services emit DECISION_PACKET_CREATED today**

Run: `Grep -rn "DECISION_PACKET_CREATED" services/advisory/advisory-ctrl/src/ services/advisory/decision-workflow-ctrl/src/`
Expected: matches in both service trees. Record the file:line of each emission site.

- [ ] **Step 3: Verify the AssemblePacket step in decision-workflow-ctrl**

Run: `Grep -rn "AssemblePacket\|assemble-packet\|assemble_packet" services/advisory/decision-workflow-ctrl/src/`
Expected: matches.

- [ ] **Step 4: Look up the originating spec for decision-workflow-ctrl introduction**

Run: `git log --oneline --all -- services/advisory/decision-workflow-ctrl/ | tail -5`
Record the introduction commit (spec lists `a54006c9` as the introduction reference).

- [ ] **Step 5: Reconcile §10**

Cover: canonical schema (id, decisionId, tenantId, recommendation summary, proposedTrades, agentInvocations, explanation, status, timestamps); immutability post-creation; CDC propagation from `decision-workflow-ctrl` DDB row to `DECISION_PACKET_CREATED` and `DECISION_PACKET_UPDATED`; consumer projections in advisory-bff (`record()` + `update()` intents — cite `services/advisory/advisory-bff/src/...:LINE`). Cite `libs/event-types/src/...:LINE` for the type and the emission sites from step 2.

- [ ] **Step 6: Add §10.1 Architectural Evolution — Dual emitters**

Subsection content:

```markdown
### 10.1 Architectural Evolution — Dual `DECISION_PACKET_CREATED` emitters

**Pre-2026-03-18.** `advisory-ctrl` was the single Step Functions orchestrator; it owned the Decision Packet write and was the sole emitter of `DECISION_PACKET_CREATED`.

**Post-2026-03-18** (per `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`). `decision-workflow-ctrl` was introduced as the canonical orchestrator (owns the AgentCore Memory resource, delegates the 4 agent invocations to ctrl services, runs the `AssemblePacket` step). Per the design intent, `advisory-ctrl` was supposed to retire its decision-lifecycle code and become the **control plane** (model lifecycle, incidents, budgets, reasoning-tier — absorbing what `operations-ctrl` would have owned).

**Current state.** The retirement never landed. Both services still emit `DECISION_PACKET_CREATED`:
- `services/advisory/decision-workflow-ctrl/src/<emit-site>:LINE` — canonical, post-AssemblePacket.
- `services/advisory/advisory-ctrl/src/<emit-site>:LINE` — vestigial, pre-2026-03-18 code path.

**Symptom observed in 2026-04-30 8th-session Playwright run.** The dual emitter caused a race in advisory-bff's CQRS projection — `DECISION_PACKET_UPDATED` arrived before `CREATED`, producing a sparse row. Mitigated tactically with `attribute_exists(pk)` on the update path (commits `429afa7a` + `3dcad1eb`); root-cause cleanup is **Spec 2**.

**Resolution path.** Spec 2 (advisory pipeline consolidation) retires `advisory-ctrl`'s decision-lifecycle subsystem, leaving `decision-workflow-ctrl` as the sole emitter.
```

(Replace `<emit-site>:LINE` placeholders with actual paths from step 2.)

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §10 — Decision Packet + dual-emitter evolution"
```

### Task B11: §11 Idempotency & Safety Rules

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify idempotency primitives in code**

Run: `Grep -n "putIfNotExists\|attribute_not_exists\|attribute_exists\|idempotencyKey" libs/event-processor/src/ libs/cdk-constructs/src/ -l`
Expected: matches.

- [ ] **Step 2: Verify SF task-token semantics**

Run: `Grep -rn "SendTaskSuccess\|SendTaskFailure\|task[Tt]oken" services/advisory/decision-workflow-ctrl/src/`
Expected: matches.

- [ ] **Step 3: Reconcile §11**

Cover: single-writer per DDB row; idempotency keys on event-processor pipelines (cite `libs/event-processor/src/...:LINE`); dedupe + replay (SQS visibility timeout + DDB conditional writes); `putIfNotExists` patterns; SF task-token at-most-once semantics. Cross-reference `feedback_no_scan_no_filter.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §11 — idempotency & safety"
```

### Task B12: §12 Projections (Read Models)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify BFF read-model intents**

Run: `Grep -rn "record\|update\|WriteIntent" services/advisory/advisory-bff/src/ services/investor/dashboard-bff/src/ -l`
Expected: matches.

- [ ] **Step 2: Reconcile §12**

Cover: BFF tables as the CQRS read side (cite `feedback_bff_is_read_model.md`); `record()` (idempotent insert) + `update()` (conditional patch) intents; status transitions (e.g. `DECISION_PACKET_UPDATED` → status:`COMPLIANCE_REVIEW`); explanation/proposedTrades/agentInvocations propagation (the field-set the 8th-session bug fix landed). Cite the projection handlers.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §12 — projections (read models)"
```

### Task B13: §13 Decision Lifecycle (End-to-End)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Read flows/advisory-cycle.flow.yaml**

Run: `Read flows/advisory-cycle.flow.yaml`.

- [ ] **Step 2: Reconcile §13**

Cover the linear traversal in prose: WORKFLOW_TRIGGER_CREATED → SF start → 4 agents fan-out (parallel) → AgentCore Memory writes → AssemblePacket → DECISION_PACKET_CREATED → compliance check → APPROVED/BLOCKED → user confirmation if L2 → CONFIRMED/REJECTED → ORDER_INTENT_CREATED. Defer wire-level steps to `flows/advisory-cycle.flow.yaml`; reference `docs/data-flows/advisory-cycle.md` if it exists.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §13 — decision lifecycle end-to-end"
```

### Task B14: §14 Operating Modes & Guardrails

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify operating-mode handling in code**

Run: `Grep -rn "AGGRESSIVE\|BALANCED\|CONSERVATIVE\|operatingMode" services/ libs/event-types/src/ -l`
Expected: matches; record where operating mode is read.

- [ ] **Step 2: Reconcile §14**

Cover: three modes (Conservative / Balanced / Aggressive); per-mode parameters (max single-trade %, monthly turnover cap, drawdown circuit breaker, drift trigger, cool-down, ETF concentration cap, equity risk band); mode-change protocol (mandate event → projection update → next-cycle behaviour). Note: per `project_operating_mode.md` (memory), the mode is captured but **not yet wired into agent behaviour** as of 2026-04-30 — flag in §21 Open Questions.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §14 — operating modes & guardrails"
```

### Task B15: §15 Portfolio Truth & Reconciliation

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify ledger services**

Run: `ls services/ledger/ledger-ctrl/src/ services/ledger/reconciliation-ctrl/src/`

- [ ] **Step 2: Read the reconciliation flow**

Run: `Read flows/reconciliation.flow.yaml`.

- [ ] **Step 3: Reconcile §15**

Cover dual-truth model (intent-side in advisory + execution; settlement-side in ledger); reconciliation cadence (event-triggered + scheduled); circuit-breaker integration on reconciliation failure (§16); corporate-actions flow. Cite `services/ledger/reconciliation-ctrl/src/...:LINE` and the flow spec.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §15 — portfolio truth & reconciliation"
```

### Task B16: §16 Circuit Breakers

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Read the circuit-breaker flow**

Run: `Read flows/broker-circuit-breaker.flow.yaml`.

- [ ] **Step 2: Verify CB lives in broker-alpaca-adpt**

Run: `Grep -rn "CIRCUIT_BREAKER\|circuit-breaker" services/execution/broker-alpaca-adpt/src/`
Expected: matches.

- [ ] **Step 3: Reconcile §16**

Cover: trigger conditions (broker error rate, reconciliation drift, mandate violation cluster); pause protocol (`CIRCUIT_BREAKER_TRIPPED` → advisory feature flag → broker halts); recovery validation gates (Heal SF in broker-alpaca-adpt); cross-domain notification (broker → advisory feature flag → investor notification). Reference `project_circuit_breaker_redesign.md` (memory) for the 2026-04-15 redesign.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §16 — circuit breakers"
```

### Task B17: §17 AgentCore Memory Contract (NEW, HIGH-VALUE)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify memory client shape**

Run: `Read libs/agent-orchestrator/src/memory/memory-client.ts`.

- [ ] **Step 2: Verify the current write path uses CreateEvent (the divergence)**

Run: `Grep -rn "CreateEventCommand\|CreateMemoryRecord\|createEvent" libs/agent-orchestrator/src/memory/`
Expected: at least one match around the `writeAgentOutput` path.

- [ ] **Step 3: Look up the canonical Memory design spec**

Run: `Glob docs/superpowers/specs/2026-03-1*-agentcore-memory*.md`
Expected: at least one match.

- [ ] **Step 4: Write §17 (NEW section)**

Section content:

```markdown
## 17. AgentCore Memory Contract

**Purpose.** AgentCore Memory provides per-agent durable conversation + extraction state for short- and long-term recall across decision cycles. The contract below defines how every agent in the system addresses Memory; deviations from the contract are explicitly named.

**Namespace convention.**

```
/{serviceName}/{actorId}/{scope}
```

Where `scope` is one of:

| Scope | TTL | Purpose |
|---|---|---|
| `decisions/{decisionId}` | short-term | Per-decision agent inputs/outputs; written by `writeAgentOutput`, read by `AssemblePacket` |
| `preferences` | long-term | Investor preference extraction across cycles |
| `signals` | long-term | Market signal extraction with cross-decision shelf life |
| `rationale` | long-term | Recommendation rationale archive for explainability |
| `sessions/{sessionId}` | session | Conversational context (onboarding wizard) |

**Strategy mapping.** Each namespace has an extraction strategy attached at Memory provisioning time (see `libs/agent-orchestrator/src/memory/memory-client.ts`). `decisions/{decisionId}` namespaces are intended for raw payload retrieval (no extraction); long-term namespaces use Bedrock-extraction strategies.

**Reference implementation.** `libs/agent-orchestrator/src/memory/memory-client.ts` exposes `writeAgentOutput`, `readAgentOutputs`, `appendSession`, `readSession`.

### 17.1 Architectural Evolution — Current Implementation Diverges from Contract

**Symptom (2026-04-30, 8th Playwright session).** `decision-workflow-ctrl`'s `AssemblePacket` step reads no agent outputs from Memory; assembly proceeds with empty agent payloads.

**Root cause.** `writeAgentOutput` writes via `CreateEventCommand` (a session-event write) instead of `CreateMemoryRecord` against the `decisions/{decisionId}` namespace. Reads against `decisions/{decisionId}` therefore find nothing. Cite: `libs/agent-orchestrator/src/memory/memory-client.ts:LINE`.

**Tactical mitigation in place.** `AssemblePacket` reads agent outputs directly from upstream task results before creating the row, bypassing Memory (commit `429afa7a`). `advisory-bff` projection copies explanation from `UPDATE` when `CREATE` arrives empty (commit `3dcad1eb`).

**Resolution path.** Spec 2 lands the namespace alignment: `writeAgentOutput` switches to `CreateMemoryRecord` against `decisions/{decisionId}`; `AssemblePacket` reverts to a Memory read. Tactical mitigations remain as defence-in-depth.
```

(Replace `LINE` placeholders with actual line numbers from step 1.)

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): write SYSTEM-ARCHITECTURE §17 — AgentCore Memory contract + divergence"
```

### Task B18: §18 Cross-Domain Routing (HIGH-VALUE)

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify the four cross-domain adapters**

Run: `ls services/*/[a-z]*-adpt/`
Expected: includes `advisory-adpt`, `execution-adpt`, `investor-adpt`, `ledger-adpt`. (Plus per-domain third-party adapters like `alpha-vantage-adpt` etc.)

- [ ] **Step 2: Verify adapter Rules pattern**

Run: `Grep -rn "EventBridge.*Rule\|RuleProps\|eventPattern" services/advisory/advisory-adpt/src/`
Expected: matches showing the consumer-owned rule pattern.

- [ ] **Step 3: Reconcile §18**

Cover: pull model (consumer's adapter owns the EB rules on the upstream bus, copies the matching events onto the consumer bus); one cross-domain adapter per domain (`advisory-adpt`, `execution-adpt`, `investor-adpt`, `ledger-adpt`); event renames at the boundary (e.g. `LEDGER_PORTFOLIO_DRIFT_DETECTED → PORTFOLIO_DRIFT_DETECTED` on the advisory side); cross-domain rule pattern uses `Match.anyOf()` for `$or` content filters. Cite `services/advisory/advisory-adpt/src/...:LINE`.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §18 — cross-domain routing (pull model)"
```

### Task B19: §19 Knowledge Bases

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify KB infrastructure**

Run: `Grep -rn "KnowledgeBase\|kbBucketName\|S3 vector\|BedrockKnowledgeBase" libs/cdk-constructs/src/ services/ -l | head -15`
Expected: matches in services that host KBs.

- [ ] **Step 2: Reconcile §19**

Cover: per-service Bedrock KBs (which services host them — likely `market-intelligence-ctrl`, `advisory-narrative-ctrl`, `onboarding-bff`); S3 vector buckets (`kbBucketName` naming convention via NamingService); ingestion pipeline (DDB stream → SQS → Lambda); KB query at agent inference time; KB vs Memory complementarity (KB = authoritative external corpus, Memory = behavioural/session/extraction). Cite the construct and the consumer service stacks.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §19 — knowledge bases"
```

### Task B20: §20 Frontend Topology

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify MFE structure**

Run: `ls apps/`
Expected: shell app + 5 MFE apps + onboarding host.

Run: `ls libs/frontend-deps/src/`
Expected: directory listing including `sharedFrontendDeps` source.

- [ ] **Step 2: Reconcile §20**

Cover: Angular PWA shell + 5 MFEs via Native Federation; per-route Apollo + AppSync GraphQL; per-BFF MFE buckets + CloudFront unified topology (post-MFE-charter graduation 2026-04-27); `frontend-deps` shared singleton surface (cite `libs/frontend-deps/src/...:LINE`); CSP single-source-of-truth at `apps/nestfolio-host/csp.txt`; service-card cross-reference. Reference `project_mfe_charter_migration.md` (memory) for the migration history.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §20 — frontend topology"
```

### Task B21: §21 Open Questions

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Consolidate the running list**

Throughout Phase B, every task that surfaced an unverifiable claim appended an Open Question. Now §21 is rewritten to ensure each entry has: (a) the question, (b) why it matters, (c) proposed resolution / which spec carries it. Reasonable expected entries (from spec):
1. L1/L2 authority not encoded as typed field (or is it?).
2. Operating mode captured but not wired into agent behaviour.
3. AgentCore Memory namespace mismatch — Spec 2 to land alignment.
4. Dual `DECISION_PACKET_CREATED` emitter — Spec 2 to retire `advisory-ctrl` decision-lifecycle.
5. `advisory-ctrl/decision-lifecycle` AgentRuntime fate — `legacy` health tag, Spec 2 retirement target.
6. operations-ctrl absorbed events: which are live, which are dormant — to be audited in Phase C `advisory-ctrl` section.
7. `decisions/{decisionId}` Memory namespace lacks an extraction strategy — Spec 2.
8. `onboarding-bff` AgentCore Runtime status post-2026-04-28 — verified during Phase C.
9. (Add any others surfaced during Phase B.)

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): consolidate SYSTEM-ARCHITECTURE §21 — open questions"
```

### Task B22: §22 Glossary

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Reconcile glossary**

Required terms (each one short paragraph): Decision Packet, Mandate, Operating Mode, Authority Level (L1/L2), Account Mode (SIM / LIVE), Reasoning Tier (Sonnet / Haiku), Cross-Domain Adapter, BFF (read-model), AgentCore Memory, AgentCore Runtime, Knowledge Base, Circuit Breaker.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §22 — glossary"
```

### Task B23: §23 Related Documents

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Verify each linked artefact exists**

For each link the section will include, run `ls` (or `Glob`) to verify it resolves:

```
flows/*.flow.yaml                          (ls flows/)
docs/architecture/c3/                      (ls docs/architecture/c3/)
docs/architecture/SERVICE-INVENTORY.md     (must exist; Task A2)
docs/architecture/nestfolio.d2             (ls)
specifications/01-product-vision.md        (ls)
specifications/02-system-design.md         (ls)
docs/data-flows/                           (ls)
CLAUDE.md                                  (ls; will be updated in Phase D)
docs/superpowers/specs/                    (ls)
```

Expected: every path resolves.

- [ ] **Step 2: Reconcile §23 — Related Documents**

Section content:

```markdown
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
| `docs/superpowers/specs/` | Per-change design specs |
| Per-service `CLAUDE.md` cards | Code-anchored current-state per service |
| `CLAUDE.md` (root) | Skill router; lists this file as canonical reference (§Canonical Architecture References) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §23 — related documents"
```

### Task B24: §24 Maintenance

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Write §24**

Section content:

```markdown
## 24. Maintenance

**Update protocol.** Updates to this document land via spec → plan → implementation, the same loop used for code change. A change to system architecture requires:
1. A spec under `docs/superpowers/specs/YYYY-MM-DD-<topic>.md` capturing the design.
2. A plan under `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
3. An implementation PR that lands code change *and* the corresponding section update here.

Section-level changes that don't ship code (e.g. clarifications, glossary additions, link fixes) can land as a single `docs(arch):` commit on `main`.

**Review cadence.** Each section header carries an implicit "last reviewed" date — the date of the most recent commit that touched the section. Whole-document review at 2-month intervals or upon major architectural change.

**Ownership.** Maintained by whoever lands an architectural change. The repo enforces this via `CLAUDE.md`'s "Canonical Architecture References" section, which directs every future session to read this file before architecturally non-trivial work.

**Last whole-document review:** 2026-04-30 (recovery from `eac934d5` baseline + reconciliation).
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): reconcile SYSTEM-ARCHITECTURE §24 — maintenance"
```

### Task B25: Update §11 / §13 / §10 / §6 cross-references and add table of contents

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Add a table of contents at the top of the file**

After §1 "Purpose, Audience, How to Read", add a TOC linking to every section header (§2 through §24, including 7.1, 10.1, 17.1).

- [ ] **Step 2: Verify all in-doc anchor links resolve**

Run: `Grep -n "^## " docs/architecture/SYSTEM-ARCHITECTURE.md`
Cross-check section numbers in the TOC against the actual headers.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): add SYSTEM-ARCHITECTURE table of contents"
```

---

## Phase C — SERVICE-INVENTORY.md expansion

The recovered baseline does not match the current 33 services. Phase C overwrites the inventory with a fresh structure built per-domain. Each task below covers one domain (4 commits total). Within each task, the writer authors one section per service following the per-service template from the spec.

### Pre-Phase-C: enumerate services and Inventory Summary

#### Task C0: Replace inventory header + Inventory Summary table

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md`

- [ ] **Step 1: Enumerate every service**

Run: `Glob services/*/*` (filter to directories only, excluding `README.md`)
Or: `ls services/{advisory,execution,investor,ledger}`

Record the full list. Expected total: 33.

- [ ] **Step 2: Determine BFF / MFE / agent presence per service**

For each service, determine:
- Type from suffix: `-bff`, `-ctrl`, `-adpt`, `-hub`, `-web`, `*-ctrl` data adapter (e.g. `alpha-vantage-adpt` is a third-party data adapter ctrl-shape).
- Has MFE? `Glob apps/<service>` to check.
- Has AI agent? `Glob services/<domain>/<svc>/agents/` or grep for `AgentRuntime`/`AgentCore`/`agent-orchestrator` in service stack.

- [ ] **Step 3: Replace the recovered baseline with new inventory header + summary**

Open `docs/architecture/SERVICE-INVENTORY.md` and replace its entire content (preserving any wisdom paragraphs you want to keep — but the recovered table is stale and should go) with:

```markdown
# Service Inventory

> **Status:** Canonical reference. Per-service responsibility, events published/consumed, AI agents, knowledge bases, state, MFEs, and architectural-evolution annotations.
>
> **Companion document:** `docs/architecture/SYSTEM-ARCHITECTURE.md` (cross-cutting architecture).
>
> **Last whole-document review:** 2026-04-30.

## Inventory Summary

Total services: **33** (verified via `Glob services/*/*` on 2026-04-30).

| # | Service | Domain | Type | Has MFE | Has AI Agent | Health |
|---|---|---|---|---|---|---|
... (33 rows; one per service; Health is one of: canonical / transitional / legacy / dormant)
```

(Fill in 33 rows from the enumeration in step 1.)

After the table, add the index of per-service sections, grouped by domain (in the order Investor → Advisory → Execution → Ledger), with anchor links to the sections that Tasks C1–C4 will write.

- [ ] **Step 4: Remove the recovery banner**

Delete the banner inserted in Task A2 step 4 — it's no longer accurate.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(arch): SERVICE-INVENTORY — inventory summary + 33-row table"
```

### Per-service template

Each service section in Tasks C1–C4 uses this template. The writer **copies the template** for each service and fills it in — no `(see template above)` shortcuts.

```markdown
### {service-name}

**Type:** {bff | ctrl | adpt | hub | web} · **Domain:** {investor | advisory | execution | ledger}

**Stack:** [`services/{domain}/{service}/src/service.stack.ts`](../../services/{domain}/{service}/src/service.stack.ts)

**Why this service exists.** One paragraph. Bounded-context responsibility. Why a *separate* service rather than a feature inside another.

**Responsibilities.**
- Bullet list of cohesive responsibilities owned by this service.

**Events Published.**

| Event | Source (DDB row + action) | Consumers |
|---|---|---|
| `EVENT_NAME` | `<DDB-row-type>` (INSERT/MODIFY) | `consumer-svc-1`, `consumer-svc-2` |

**Events Consumed.**

| Event | Upstream service | Handler |
|---|---|---|
| `EVENT_NAME` | `producer-svc` | `handlers/foo.ts` |

**AI Agents** (if any). Agent name, model tier, runtime kind (in-process / AgentCore Runtime / AgentCore Bridge), tools, memory namespaces.

**State.** DDB tables, GSIs, S3 buckets, KB indexes.

**API surface** (BFFs only). GraphQL operations + auth model.

**MFE** (BFFs with frontend, only). MFE bucket name, route shell, federation key.

**Architectural Evolution** (where applicable). Name the divergence from the obvious shape and the spec/commit that introduced it.

**Health.** {canonical | transitional | legacy | dormant} — one-line rationale.

**Cross-references.** Service `CLAUDE.md` card, relevant flow specs, design specs.

---
```

### Task C1: Investor domain (7 services)

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md`

Services: `investor-hub`, `investor-web`, `investor-bff`, `investor-ctrl`, `dashboard-bff`, `onboarding-bff`, `investor-adpt`.

- [ ] **Step 1: For each service, gather data**

For each service in the list, run:

```
ls services/investor/<svc>/
Read services/investor/<svc>/CLAUDE.md       (if exists; service card)
Read services/investor/<svc>/src/service.stack.ts
Glob services/investor/<svc>/src/handlers/   (events consumed)
Grep "EventBridge\|emitEvent\|putEvents\|RECORD_TYPE\|__typename" services/investor/<svc>/src/   (events published context)
Glob services/investor/<svc>/agents/         (AI agents)
```

For BFFs additionally:
- `Glob apps/<svc-mfe>/` for MFE shell.
- `Read services/investor/<svc>/schema.graphql` (or equivalent) for API surface.

- [ ] **Step 2: Author one section per service**

Use the per-service template above. **Required Architectural Evolution annotations** (per spec §SERVICE-INVENTORY):

- **`onboarding-bff`** — hybrid: BFF (CopilotKit bridge endpoint) + AgentCore Runtime host. 2026-04-28 redesign moved the runtime to in-process `OnboardingAgent extends AbstractAgent`; cite `services/investor/onboarding-bff/agents/onboarding/agent.ts:LINE`. Verify whether AgentCore Runtime is still the deployment target (open question #8 in §21) — read `service.stack.ts` to confirm.

- **`dashboard-bff`** — late addition; Investor home dashboard CQRS read side; broadcasts via WSS subscriptions. Reference `feedback_appsync_subscribe_filter_args.md`.

- **`investor-ctrl`** — handles cross-cutting Investor notifications. **No `notification-ctrl` service exists**; cite `feedback_investor_ctrl_not_notification.md`.

- **`investor-adpt`** — cross-domain adapter (pull model, owns EB rules on upstream domain buses). Cite §18.

- **`investor-hub`** — EventBridge router; no Lambda handlers, no DDB. Integration test model N/A. Mark Health: `canonical`.

- **`investor-web`** — Angular shell host + investor MFE; Native Federation aggregation point. Cite `apps/nestfolio-host/csp.txt` for CSP.

Health tags expected:
- `investor-bff`, `investor-ctrl`, `dashboard-bff`, `onboarding-bff`, `investor-adpt`, `investor-hub`, `investor-web`: all `canonical` unless verification surfaces something.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(arch): SERVICE-INVENTORY — Investor domain (7 services)"
```

### Task C2: Advisory domain (15 services)

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md`

Services: `advisory-hub`, `advisory-ctrl`, `advisory-bff`, `advisory-narrative-ctrl`, `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`, `decision-workflow-ctrl`, `compliance-ctrl`, `advisory-adpt`, `alpha-vantage-adpt`, `fred-adpt`, `marketwatch-adpt`, `sec-edgar-adpt`, `yahoo-finance-adpt`.

- [ ] **Step 1: Verify count**

Run: `ls services/advisory/`
Expected: 15 service directories (excluding README.md). If the count differs, reconcile and update §C0 inventory summary.

- [ ] **Step 2: Author one section per service**

Use the per-service template. **Required Architectural Evolution annotations** (per spec §SERVICE-INVENTORY):

- **`advisory-ctrl`** — vestigial decision-lifecycle code; was the original SF orchestrator pre-2026-03-18; absorbed `operations-ctrl`'s vocabulary (control-plane responsibilities: model lifecycle, incidents, budgets, reasoning-tier — SHADOW_RUN_*, MODEL_*, INCIDENT_*, CIRCUIT_BREAKER_*, HEALTH_CHECK_*, TENANT_BUDGET_*). **Spec 2 retires the decision-lifecycle subsystem.** Health: `transitional` (Spec 2 will land alignment) — but the decision-lifecycle subsystem itself is `legacy` with forward-pointer to Spec 2. Cite §10.1, §17.1.
  - **Sub-task:** sweep the absorbed event vocabulary. Run: `Grep -rn "SHADOW_RUN_\|MODEL_\|INCIDENT_\|CIRCUIT_BREAKER_\|HEALTH_CHECK_\|TENANT_BUDGET_" services/ libs/event-types/src/` and identify which event names are emitted/consumed by current code (live) vs reserved-for-future (dormant). Document the split in this section. (This addresses spec Open Question #4.)

- **`decision-workflow-ctrl`** — introduced 2026-03-17 (commit `a54006c9`); replaces advisory-ctrl as the canonical SF orchestrator per `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`; owns the AgentCore Memory resource and delegates agent execution to 4 separate ctrl services. Cite §7.1, §10.1. Health: `canonical`.

- **`investor-profile-ctrl`**, **`market-intelligence-ctrl`**, **`portfolio-engine-ctrl`**, **`advisory-narrative-ctrl`** — emerged from the 2026-03-18 split; each hosts its own AgentCore Runtime; the 6→4 mapping is documented in SYSTEM-ARCHITECTURE.md §7.1. Each section names its agent's original 6-agent role (User & Goals + Risk / Market & Research / Portfolio Construction + Rebalance Planner / Recommendation & Explainability). Health: `canonical`.

- **`compliance-ctrl`** — rule-based gate, not an LLM. Cite §8. Health: `canonical`.

- **`advisory-bff`** — CQRS read side for Decision Packets and decision lists; the 8th-session race-condition fix (`record()` skip-empty-CREATE + UPDATE-explanation-copy) lives here. Cite `feedback_bff_is_read_model.md`. Health: `canonical`.

- **`advisory-adpt`** — cross-domain adapter (pull model). Cite §18.

- **`alpha-vantage-adpt`, `fred-adpt`, `marketwatch-adpt`, `sec-edgar-adpt`, `yahoo-finance-adpt`** — third-party data adapters. Use AWS Parameters and Secrets Lambda Extension for runtime config (per memory). Health: `canonical`.

- **`advisory-hub`** — EventBridge router. Health: `canonical`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(arch): SERVICE-INVENTORY — Advisory domain (15 services)"
```

### Task C3: Execution domain (6 services)

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md`

Services: `execution-hub`, `execution-ctrl`, `broker-ctrl`, `broker-sim-adpt`, `broker-alpaca-adpt`, `execution-adpt`.

- [ ] **Step 1: Verify count**

Run: `ls services/execution/`
Expected: 6 service directories (excluding README.md).

- [ ] **Step 2: Author one section per service**

Use the per-service template. **Required Architectural Evolution annotations**:

- **`broker-ctrl` + `broker-sim-adpt` + `broker-alpaca-adpt`** — split during the real-money-ops design (2026-03-26, cite `docs/superpowers/specs/2026-03-26-real-money-operations-design.md`). `broker-ctrl` owns the SF state machine; `broker-{sim,alpaca}-adpt` own broker-specific protocol. `broker-alpaca-adpt` additionally hosts the circuit-breaker (per `project_circuit_breaker_redesign.md`, merged 2026-04-15). Cite §16.

- **`execution-ctrl`** — execution-side state machine; consumes `RECOMMENDATION_CONFIRMED`, emits `ORDER_INTENT_CREATED`. Health: `canonical`.

- **`execution-adpt`** — cross-domain adapter. Cite §18.

- **`execution-hub`** — EventBridge router. Health: `canonical`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(arch): SERVICE-INVENTORY — Execution domain (6 services)"
```

### Task C4: Ledger domain (5 services)

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md`

Services: `ledger-hub`, `ledger-ctrl`, `ledger-bff`, `reconciliation-ctrl`, `ledger-adpt`.

- [ ] **Step 1: Verify count**

Run: `ls services/ledger/`
Expected: 5 service directories (excluding README.md).

- [ ] **Step 2: Author one section per service**

Use the per-service template. Per the spec, the Ledger domain didn't exist in the 2026-03-01 baseline — content is written from scratch using current code + flows + the real-money-ops spec. Required cross-references: `flows/order-ledger.flow.yaml`, `flows/reconciliation.flow.yaml`, `docs/superpowers/specs/2026-03-26-real-money-operations-design.md`.

- **`ledger-ctrl`** — position truth (intent vs settlement). 2026-04 rewrite (cite memory `project_explicit_state_orchestration.md`).

- **`ledger-bff`** — CQRS read side for portfolio positions. BFF resolver region sweep is a known pending task (per memory). Health: `canonical` with note.

- **`reconciliation-ctrl`** — drift detection + reconciliation cadence. Cite §15.

- **`ledger-adpt`** — cross-domain adapter. Cite §18.

- **`ledger-hub`** — EventBridge router. Health: `canonical`.

- [ ] **Step 3: Update Inventory Summary if any per-service Health tags changed**

If Phase C surfaced a service that needs a `transitional` or `legacy` tag not predicted in C0, update the summary table in §Inventory Summary in the same commit.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(arch): SERVICE-INVENTORY — Ledger domain (5 services)"
```

---

## Phase D — CLAUDE.md integration

### Task D1: Add Canonical Architecture References section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read current CLAUDE.md**

Run: `Read CLAUDE.md`.

- [ ] **Step 2: Find insertion point**

The new section goes **after** the "General Guidelines for working with Nx" section and **before** the "## System Model" section. Identify the exact heading line above System Model — likely `## System Model`.

- [ ] **Step 3: Insert the new section**

Insert the following block immediately before `## System Model`:

```markdown
## Canonical Architecture References

Before any architecturally non-trivial change, read:

- `docs/architecture/SYSTEM-ARCHITECTURE.md` — domains, agent topology, decision lifecycle, event taxonomy, AgentCore Memory contract, idempotency, circuit breakers, frontend topology
- `docs/architecture/SERVICE-INVENTORY.md` — per-service responsibility, events published/consumed, AI agents, current health (canonical / transitional / legacy / dormant)

These supersede `specifications/02-system-design.md` (kept as a high-level summary) for service-level reasoning. Per-service `CLAUDE.md` cards remain authoritative for current code state per service.

```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): wire canonical architecture references into CLAUDE.md"
```

### Task D2: Update user-memory MEMORY.md pointer

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`
- (Optionally) Create: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_system_architecture_docs.md`

- [ ] **Step 1: Read current MEMORY.md**

Run: `Read /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`.

- [ ] **Step 2: Append a Topic Files entry**

Under the existing "## Topic Files" list, append:

```markdown
- [System architecture docs](./project_system_architecture_docs.md) — canonical refs at `docs/architecture/SYSTEM-ARCHITECTURE.md` + `docs/architecture/SERVICE-INVENTORY.md`; landed 2026-04-30 from `eac934d5` + `fa15bbfd~1` baselines, reconciled to 33-service current code; supersedes `specifications/02-system-design.md` for service-level reasoning. Spec 1 of 3 — Spec 2 (advisory pipeline consolidation) and Spec 3 (onboarding reliability) follow.
```

- [ ] **Step 3: Optionally create the topic file**

If the user prefers a topic-file pointer (per the MEMORY.md convention), create `project_system_architecture_docs.md` with:

```markdown
---
name: System architecture documentation foundation
description: Canonical SYSTEM-ARCHITECTURE.md + SERVICE-INVENTORY.md docs landed 2026-04-30; Spec 1 of 3-spec workstream
type: project
---

Two canonical architecture docs at `docs/architecture/SYSTEM-ARCHITECTURE.md` (24 sections — domains, agent topology, decision lifecycle, AgentCore Memory contract incl. divergence at §17.1, dual `DECISION_PACKET_CREATED` evolution at §10.1, 6→4 agent decomposition at §7.1) + `docs/architecture/SERVICE-INVENTORY.md` (33 services across 4 domains, per-service responsibility / events / agents / health).

**Why:** future sessions had no canonical doc explaining *why* services are shaped the way they are; the dual-emitter question in 2026-04-30 8th-session could only be answered by recovering deleted git-history docs.

**How to apply:** `CLAUDE.md` "Canonical Architecture References" section directs every future session to read both files before architecturally non-trivial work. Updates land via spec → plan → impl. Spec 2 (advisory pipeline consolidation) authored *against* these docs lands the dual-emitter cleanup + Memory namespace alignment.

**Status:** SHIPPED 2026-04-30 on `main`. Spec 2 + Spec 3 next.
```

(Memory writes are local to the user's profile, not committed to the repo. Skip the `git add` for this step. The MEMORY.md update itself is also outside the repo.)

- [ ] **Step 4: No git commit for memory files**

Memory updates above are outside the repo — no `git add` / `git commit` needed.

---

## Phase E — Cross-link audit

### Task E1: Verify every doc-link in both files resolves

**Files:**
- Read-only: `docs/architecture/SYSTEM-ARCHITECTURE.md`, `docs/architecture/SERVICE-INVENTORY.md`

- [ ] **Step 1: Extract every linked path**

Run: `Grep -nE "\\(\\.\\./|\\((flows|services|libs|apps|specifications|docs|CLAUDE)/" docs/architecture/SYSTEM-ARCHITECTURE.md docs/architecture/SERVICE-INVENTORY.md`
Record every cited file path.

- [ ] **Step 2: Verify each path exists**

For each unique cited path, run a `ls`/`Glob` to verify it resolves on disk. (Paths with line-numbers — e.g. `services/.../foo.ts:131` — verify just the file part exists; the line number is informational and not link-checked.)

- [ ] **Step 3: Verify each cited spec exists**

For every `docs/superpowers/specs/<filename>.md` referenced, run `ls docs/superpowers/specs/<filename>.md`.

- [ ] **Step 4: Fix broken links in place**

For any path that doesn't resolve, either:
(a) update the citation to a path that does resolve (preferred), or
(b) move the claim to §21 Open Questions if the citation can't be salvaged.

Commit any fixes.

- [ ] **Step 5: Commit (if any fixes were needed)**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(arch): fix broken cross-links surfaced by audit"
```

(Skip the commit step if no fixes were needed — note that in the task output.)

### Task E2: Verify §21 Open Questions list is exhaustive

**Files:**
- Read-only: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Search for hedging language inside §2–§20**

Run: `Grep -nE "TBD|TODO|unclear|unknown|may be|might be|appears to|seems|presumably|should be|will be" docs/architecture/SYSTEM-ARCHITECTURE.md`

For each match, decide: is this a fact that should have a citation, or an Open Question? Move Open Questions to §21; cite facts inline.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): move hedged claims into §21 Open Questions"
```

(Skip the commit step if no hedged claims were found.)

---

## Phase F — Self-review

### Task F1: Spec coverage check

**Files:**
- Read-only

- [ ] **Step 1: Re-read the spec**

Run: `Read docs/superpowers/specs/2026-04-30-system-architecture-docs-foundation-design.md`.

- [ ] **Step 2: Walk the spec's "Success criteria" section**

For each of the 8 success criteria in the spec (lines 240–249), point to the section/task that delivers it:

1. Both docs on `main` with all 24 SYSTEM-ARCHITECTURE sections + 33 SERVICE-INVENTORY sections — verified by walking ToC + Inventory Summary.
2. CLAUDE.md "Canonical Architecture References" section — Task D1.
3. Every architectural claim cites a file path or Open Question — Task E2.
4. Dual-emitter explicitly addressed — §10.1 + advisory-ctrl + decision-workflow-ctrl sections.
5. AgentCore Memory namespace contract — §17.
6. 6→4 agent decomposition — §7.1.
7. operations-ctrl absorption — `advisory-ctrl` section.
8. Future Claude can answer "why do two services emit `DECISION_PACKET_CREATED`?" — verified by reading §10.1 cold.

- [ ] **Step 3: If any criterion is unmet, fix it**

Either reopen a prior Phase B/C task to fill the gap, or land a follow-up commit.

### Task F2: Placeholder scan

**Files:**
- Read-only

- [ ] **Step 1: Scan both files for placeholder text**

Run: `Grep -nE "TBD|TODO|fill in|placeholder|<.+>|XXX|FIXME|implement later" docs/architecture/SYSTEM-ARCHITECTURE.md docs/architecture/SERVICE-INVENTORY.md`

Expected: zero matches outside genuine code-block examples.

- [ ] **Step 2: Fix any matches**

Replace placeholders with real content or move to §21 Open Questions.

### Task F3: Internal consistency check

**Files:**
- Read-only

- [ ] **Step 1: Verify section numbers in TOC match actual headers**

Run: `Grep -n "^## " docs/architecture/SYSTEM-ARCHITECTURE.md`
Cross-check against TOC.

- [ ] **Step 2: Verify Inventory Summary count matches per-service section count**

Run: `Grep -c "^### " docs/architecture/SERVICE-INVENTORY.md`
Expected: 33 (one heading per service).

If mismatch — either summary count is wrong or a service section is missing. Reconcile.

- [ ] **Step 3: Verify cross-references between docs**

Every reference from SYSTEM-ARCHITECTURE.md to SERVICE-INVENTORY.md should land at an actual `### service-name` heading in that file. Spot-check 5 references.

### Task F4: Final commit + summary

**Files:**
- Modify: any final fixes from F1–F3

- [ ] **Step 1: Land any final fixes**

```bash
git add docs/architecture/
git commit -m "docs(arch): self-review fixes (Phase F)"
```

(Skip if no fixes needed.)

- [ ] **Step 2: Print summary of work**

Print to terminal a concise summary of:
- Total commits in the branch on top of `main` (`git log --oneline main..HEAD | wc -l`)
- Diff line count (`git diff --stat main..HEAD`)
- Confirmation that both files exist and pass the audit

- [ ] **Step 3: Mark plan complete**

The plan is done. The PR is ready for review against the spec's success criteria.

---

## Out of Scope (per spec §Non-goals)

- New C4 diagrams.
- Any code change.
- Refactoring `specifications/`.
- Per-service `CLAUDE.md` card refresh.
- Resolving dual-emitter / Memory / Lambda timeout fixes (Spec 2).
- Onboarding agent flakiness fix (Spec 3).
