---
id: advisory-agent-event-contract-coverage
status: queued
rank: 7
type: refactor
notes: "WS-1 GAP surfaced 2026-06-11 by cdc-publisher-typed-subjects (WS-2) planning. The shipped WS-1 advisory slice (typed-subject-contracts-advisory) authored producer zod contracts for the PRIMARY advisory ROW subjects (InvestorProfileSnapshot, MarketSnapshot, DecisionPacket, MandateSnapshot, ComplianceCheck, DecisionReadModel, UserConfirmation, UserRejection — all e2e-validated row-level) but left ~14 advisory-core agent-internal/projection CDC __typenames WITHOUT a row-level zod contract. Includes a subtle trap: AgentCompletion (portfolio-engine + advisory-narrative) HAS a schema (PortfolioAgentOutputSchema / NarrativeAgentOutputSchema) but it types the agentOutput FIELD, not the row ({decisionId, tenantId, agentName, taskToken, agentOutput, completedAt}) — so schema.parse(row) fails; the row needs its own schema (e.g. a shared AgentCompletionRowSchema<A> generator in agent-orchestrator wrapping the per-service agentOutput schema, mirroring the AgentCompletionRow<A,O> TS generic). WS-2 EXEMPTS all uncovered __typenames (emits status-quo fat row, registered in the publisher exemption set) so it stays a publisher-typing-mechanism workstream; the FINAL exemption list is fixed during WS-2 execution (each row parse-tested). This item completes the coverage. 6 CONSUMER-HAVING (priority — WS-3 needs them): PORTFOLIO_FAILED + NARRATIVE_FAILED + PORTFOLIO_COMPLETED + NARRATIVE_COMPLETED (→ decision-workflow-ctrl CallbackIngress/sfn-callback), EXPLANATION_GENERATED (→ investor-adpt + advisory-adpt), ADVISORY_STATUS_UPDATED (→ dashboard-bff event-listener P3) → author row-level contracts, validate against REAL emissions ([[event-subject-contracts]]). 8 TELEMETRY (verified ZERO cross-service consumers 2026-06-11): GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED, MARKET_SIGNAL_DETECTED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, AGENT_OUTPUT_CREATED, AUDIT_ARTIFACT_CREATED, USER_INTERACTION_CREATED → per-event decide author-contract vs stop-emitting ([[no-deprecation]] favours stop-emitting a row no consumer reads). As each __typename is typed or its emission removed, drop it from the cdc-publisher-typed-subjects exemption registry. Ranked top of QUEUED per 2026-06-11 user direction (blocks full advisory typing + WS-3 consumer parsing of the 6)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
  - docs/superpowers/specs/2026-06-11-cdc-publisher-typed-subjects-design.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Advisory agent-internal event contract coverage (WS-1 completion)

The shipped WS-1 advisory slice (`typed-subject-contracts-advisory`) authored producer zod
contracts for the **primary** advisory ROW subjects (`InvestorProfileSnapshot`,
`MarketSnapshot`, `DecisionPacket`, `MandateSnapshot`, `ComplianceCheck`, `DecisionReadModel`,
`UserConfirmation`, `UserRejection` — all e2e-validated as row-level) but left **~14
advisory-core agent-internal / projection CDC `__typename`s with no row-level zod contract**.

`cdc-publisher-typed-subjects` (WS-2) **exempts** these from its `schemas` registry (they emit
the status-quo fat untyped row, registered in the publisher exemption set) so WS-2 can stay a
pure publisher-typing-mechanism workstream. The **final** exemption list is fixed during WS-2
execution — each candidate row is parse-tested against any existing schema; if it doesn't
cleanly type the row, it is exempted. This item then closes the gap.

## The uncovered emitted `__typename`s (best-effort 2026-06-11; WS-2 finalises)

| Producer | `__typename` | Emitted event | Consumer? |
|---|---|---|---|
| investor-profile-ctrl | `AgentInvocation` | `GOAL_INTERPRETATION_PRODUCED` | none |
| investor-profile-ctrl | `ReasoningOutput` | `RISK_EVALUATION_PRODUCED` | none |
| market-intelligence-ctrl | `AgentInvocation` | `MARKET_SIGNAL_DETECTED` | none |
| portfolio-engine-ctrl | `AgentInvocation` | `PORTFOLIO_CONSTRUCTION_PROPOSED` | none |
| portfolio-engine-ctrl | `ReasoningOutput` | `REBALANCE_PLAN_PRODUCED` | none |
| portfolio-engine-ctrl | `AgentCompletion` | `PORTFOLIO_COMPLETED` | **decision-workflow-ctrl CallbackIngress** |
| portfolio-engine-ctrl | `AgentFailure` | `PORTFOLIO_FAILED` | **decision-workflow-ctrl sfn-callback** |
| advisory-narrative-ctrl | `ReasoningOutput` | `EXPLANATION_GENERATED` | **investor-adpt + advisory-adpt** |
| advisory-narrative-ctrl | `AgentCompletion` | `NARRATIVE_COMPLETED` | **decision-workflow-ctrl CallbackIngress** |
| advisory-narrative-ctrl | `AgentFailure` | `NARRATIVE_FAILED` | **decision-workflow-ctrl sfn-callback** |
| decision-workflow-ctrl | `AgentOutput` | `AGENT_OUTPUT_CREATED` | none |
| compliance-ctrl | `AuditArtifact` | `AUDIT_ARTIFACT_CREATED` | none |
| advisory-bff | `AdvisoryStatus` | `ADVISORY_STATUS_UPDATED` | **dashboard-bff event-listener (P3)** |
| advisory-bff | `UserInteraction` | `USER_INTERACTION_CREATED` | none |

(Consumer presence verified 2026-06-11 by grepping each event name across `services/**`
excluding the producer + tests; `PORTFOLIO_COMPLETED`/`NARRATIVE_COMPLETED` consumers confirmed
from the service cards: DWC CallbackIngress resumes the SF on the AgentCompletion CDC event.)

## The `AgentCompletion` trap (why a schema exists but doesn't cover the row)

`portfolio-engine-ctrl` / `advisory-narrative-ctrl` export `PortfolioAgentOutputSchema` /
`NarrativeAgentOutputSchema`, but those describe the **`agentOutput` field**, while the emitted
subject is the whole `AgentCompletion` row
`{ decisionId, tenantId, agentName, taskToken, agentOutput, completedAt }` (+ envelope). The
row already has a TS type (`AgentCompletionRow<'portfolio-engine', PortfolioAgentOutput>` from
`@nestfolio/agent-orchestrator`) but no runtime zod schema. The fix: a shared
`AgentCompletionRowSchema<A>(outputSchema)` generator in `@nestfolio/agent-orchestrator` that
composes the per-service `*AgentOutputSchema` into the full row shape (mirroring the existing
generic). `AgentFailure` is the structural sibling (`AgentFailureRow<A>`).

## Work

### A. The 6 consumer-having events (priority — WS-3 depends on these)

`PORTFOLIO_FAILED`, `NARRATIVE_FAILED`, `PORTFOLIO_COMPLETED`, `NARRATIVE_COMPLETED`,
`EXPLANATION_GENERATED`, `ADVISORY_STATUS_UPDATED`. Author a producer-owned **row-level** zod
contract for each (clean event-concept name, no `Subject` suffix), type the persisted row as
`TableEntry<Subject>`, and **validate against the REAL emitted shape** — a real persisted row /
captured CDC subject, NOT a fixture ([[event-subject-contracts]]). For `AgentCompletion` /
`AgentFailure`, add the shared `AgentCompletionRowSchema<A>` / `AgentFailureRowSchema<A>`
generators in `@nestfolio/agent-orchestrator`.

### B. The 8 consumer-less telemetry events (decide: type or stop-emitting)

`GOAL_INTERPRETATION_PRODUCED`, `RISK_EVALUATION_PRODUCED`, `MARKET_SIGNAL_DETECTED`,
`PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`, `AGENT_OUTPUT_CREATED`,
`AUDIT_ARTIFACT_CREATED`, `USER_INTERACTION_CREATED` — **zero cross-service consumers**.
Per-event decide: author a contract (if retained as an observable telemetry/audit signal) OR
remove the CDC emission entirely (drop the `__typename` from the service's Egress `eventTypes`
map — `[[no-deprecation]]` favours stop-emitting a row no consumer reads). The advisory agents
return to the orchestrator via Step Functions task tokens, not these events, so removing them
does not break the decision cycle — confirm per event before removing.

### C. Drain the WS-2 exemption registry

As each `__typename` is typed (A/B) or its emission removed (B), delete it from the
`cdc-publisher-typed-subjects` publisher exemption set so the completeness guard then requires a
real schema. When all are drained the exemption set is empty and advisory-core publishers are
fully typed.

## Done

All 6 consumer-having events have row-level producer contracts validated against real
emissions; each of the 8 telemetry events is either typed or no longer emitted; the WS-2
publisher exemption registry is empty.
