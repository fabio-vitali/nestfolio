---
id: inter-agent-state-handoff-sf-vs-memory
status: active
type: design
notes: "Two-phase design: A=migrate inter-agent handoff to SF state (latency fix); B=wire up long-term Memory strategies (preferences/signals/rationale). Spec approved 2026-05-14; ready for writing-plans."
references:
  - "docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md"
  - "services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts"
  - "services/advisory/advisory-narrative-ctrl/CLAUDE.md"
  - "services/advisory/portfolio-engine-ctrl/CLAUDE.md"
  - "services/advisory/decision-workflow-ctrl/src/service.stack.ts"
  - "services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts"
  - "docs/architecture/SYSTEM-ARCHITECTURE.md"
  - "docs/backlog/advisory-narrative-latency-budget-overshoot-e2e.md"
out_of_scope:
  - "Onboarding-bff Memory usage (different domain, namespace patterns)"
  - "sessions/{sessionId} long-term namespace (onboarding wizard scope)"
  - "Migrating Lambda-side resilience/idempotency patterns (already shipped c9dae7db)"
  - "Backfilling historical decision data into long-term namespaces"
  - "Removing the agentcore.Memory infra construct (Part B uses it)"
  - "Touching KB ingestion paths"
  - "Cross-tenant Memory analytics or aggregation"
  - "Production rollout sequencing (dev-first; prod posture decided separately)"
  - "Bumping advisoryNarrative latency budget (the budget is correct; latency is the bug)"
  - "Reviving the old CreateEvent + RetrieveMemoryRecords path that Spec 2 replaced for short-term"
spec: docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md
plan: null
topic_memory: []
validation_gate: null
---

# Inter-agent state handoff: Step Functions state vs AgentCore Memory

## Driver

Investigation of `advisory-narrative-latency-budget-overshoot-e2e` (parked 2026-05-14 with full root-cause notes) found that AgentCore Memory's >40s eventual-consistency window between writers and readers causes a 28s mandatory retry-sleep loop in `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:55-63`. Daily p50 jumped from ~13s (pre-2026-05-09) to ~49s post-retry-loop addition. Three of four advisory pipeline agents (portfolio-engine, market-intelligence, narrative) currently use AgentCore Memory for ephemeral upstream→downstream context handoff inside a single decision execution.

## Hypothesis

AgentCore Memory was chosen as the inter-agent state surface for two purposes that should be split:

| Purpose | Current surface | Proposed surface | Why |
|---|---|---|---|
| **Ephemeral inter-agent handoff** within one decision execution (e.g., portfolio output → narrative input) | AgentCore Memory `CreateEvent` + `ListMemoryRecords` | **Step Functions state** (or S3 pointer in SF state for >32KB payloads) | SF state is synchronous, deterministic, no consistency window, ~3x cheaper, removes retry loop |
| **Long-term semantic recall** across executions (`narrative preferences`, `session summaries`) | AgentCore Memory `searchLongTermMemory` | Keep AgentCore Memory | Vector/semantic search is what AgentCore is built for; SF state can't do this |
| **Per-decision audit trail** | AgentInvocation DDB rows | Keep DDB (already there) | Already in place |

Precedent: commit `fa7f0a17` (2026-05-09) already moved `operatingMode` from Memory to SF state. That worked for a scalar — open question is whether structured agent outputs (portfolio with N positions, market analysis with news) fit the 32KB-per-state-input / 256KB-per-execution SF limit, or need an S3-pointer indirection.

## Open questions for brainstorming

1. **Sizing.** Measure actual agent output payload sizes on dev. Do they fit 32KB? If not, S3-pointer pattern.
2. **Migration order.** Per-agent or full-pipeline cutover? Per-agent allows incremental validation but needs dual-read during transition.
3. **What counts as "inter-agent" vs "long-term"?** `searchLongTermMemory('session summaries')` could be cross-execution OR within-execution depending on session scope. Need to audit each call site.
4. **Memory writes that survive after migration.** Even when reads move to SF state, do agents still WRITE to Memory for downstream long-term recall? If yes, the writes themselves still cost — but they no longer block.
5. **Trace and telemetry.** AgentTraceEnvelope `gen_ai.invocation.latency_ms` should drop ~28s after migration. How do we verify the regression closes in CloudWatch?
6. **Compliance / audit implications.** `MandateSnapshot` and other compliance reads use AgentCore Memory? (Probably no — those are DDB. Verify.)
7. **Cost model.** Quantify dollars-per-pipeline-execution before vs after. AgentCore Memory CreateEvent/ListMemoryRecords vs SF state transitions.
8. **Failure modes.** SF state is lost when an execution fails; Memory persists. Does this matter for the inter-agent handoff use case? (Probably no — failures restart the pipeline.)

## Affected services

- `services/advisory/decision-workflow-ctrl` — orchestrator, owns SF state shape
- `services/advisory/investor-profile-ctrl` — produces investor-profile output
- `services/advisory/portfolio-engine-ctrl` — produces portfolio output
- `services/advisory/market-intelligence-ctrl` — produces market analysis output
- `services/advisory/advisory-narrative-ctrl` — consumes all three; the loudest victim of the current architecture

## Phase A — SHIPPED 2026-05-14

Phase A landed on branch `feat/inter-agent-sf-state-phase-a`. Commit-range `f0fbf2d3..HEAD` (16 substantive commits + revert + dossier rewrites). Five advisory service stacks deployed to dev sandbox (all UPDATE_COMPLETE: decision-workflow-ctrl, advisory-narrative-ctrl, portfolio-engine-ctrl, investor-profile-ctrl, market-intelligence-ctrl).

What Phase A delivered:
- 4 advisory agents now read upstream context from SF state subject (no Memory reads for inter-agent handoff).
- AssemblePacket reads 4 agent outputs from its event payload.
- Runtime size guard `wrapAgentOutput` (25KB UTF-8 byte threshold) at `libs/agent-orchestrator/src/wrap-agent-output.ts`.
- `MemoryClient.writeAgentOutput` and `readUpstreamOutput` removed from the lib.
- `BatchCreateMemoryRecords` and `ListMemoryRecords` IAM grants dropped from the 4 advisory service stacks.
- Dead `session.writeAgentOutput(...)` calls removed from 4 agent graph.ts files.
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §17 namespace table + new §17.2 + §7 line 131 updated.

Validation finding: the 28s Memory retry IS gone (verified by code review AND by absence of writeAgentOutput/BatchCreate in CloudWatch AgentRuntime logs across 20+ invocations). Daily p95 narrative-ingress Lambda Duration dropped from ~56s to ~22-30s within minutes of deploy. The e2e test's 20s budget still fails because a separately-scoped 22-30s steady-state inference floor was hidden behind the retry — tracked as queued workstream [[advisory-narrative-agentcore-latency-residual]] rank 20, scheduled after Phase B per user direction 2026-05-14.

Three follow-up items filed during execution:
- [[stale-memory-write-comments-phase-a-cleanup]] — 6 stale comment locations in adjacent files (parking)
- [[portfolio-engine-service-unavailable-asymmetric-handling]] — pre-existing asymmetry surfaced by Task 7 (parking)
- [[advisory-narrative-agentcore-latency-residual]] — UX-blocking inference floor (queued, rank 20)

## Phase B — remains

Phase B wires Bedrock MemoryStrategies on the `preferences`, `signals`, and `rationale` long-term namespaces so the 6 surviving `searchLongTermMemory` callers begin returning non-empty results. Workstream stays `status: active`. Plan will be written in a fresh session after Phase A is on `main` for a few days. The `agentcore.Memory` construct + `RetrieveMemoryRecords` IAM grants are intentionally preserved for Phase B.
