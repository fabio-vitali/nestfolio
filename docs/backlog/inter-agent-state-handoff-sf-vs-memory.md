---
id: inter-agent-state-handoff-sf-vs-memory
status: parking
type: design
notes: "Migrate inter-agent ephemeral handoff (portfolio→narrative, etc.) off AgentCore Memory onto Step Functions state. Keep Memory for long-term semantic recall. Driver: 3x latency regression in narrative agent."
references:
  - "services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts"
  - "services/advisory/advisory-narrative-ctrl/CLAUDE.md"
  - "services/advisory/portfolio-engine-ctrl/CLAUDE.md"
  - "services/advisory/decision-workflow-ctrl/src/service.stack.ts"
  - "docs/backlog/advisory-narrative-latency-budget-overshoot-e2e.md"
out_of_scope: []
spec: null
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

## Promote when

Design brainstorm completes and produces a spec. Implementation gets queued separately. (Note: this trigger sentence is intentionally vague because the workstream is still in design discovery — the lint rule for QUEUED items will block premature promotion.)
