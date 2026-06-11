---
id: advisory-agent-event-contract-coverage
status: queued
rank: 7
type: refactor
notes: "WS-1 GAP surfaced 2026-06-11 by cdc-publisher-typed-subjects (WS-2) planning. The shipped WS-1 advisory slice (typed-subject-contracts-advisory) authored producer zod contracts for the PRIMARY advisory subjects but left 12 advisory-core agent-internal/projection CDC __typenames with NO zod contract: investor-profile-ctrl AgentInvocation+ReasoningOutput, market-intelligence-ctrl AgentInvocation, portfolio-engine-ctrl AgentInvocation+ReasoningOutput+AgentFailure, advisory-narrative-ctrl ReasoningOutput+AgentFailure, decision-workflow-ctrl AgentOutput, compliance-ctrl AuditArtifact, advisory-bff AdvisoryStatus+UserInteraction. WS-2 EXEMPTS these (emits status-quo fat row, registered in the publisher exemption set) so it stays a publisher-typing-mechanism workstream. This item completes the coverage. Split: (4 PRIORITY — have real cross-service consumers, WS-3 needs them) PORTFOLIO_FAILED + NARRATIVE_FAILED (→ decision-workflow-ctrl sfn-callback), EXPLANATION_GENERATED (→ investor-adpt + advisory-adpt), ADVISORY_STATUS_UPDATED (→ dashboard-bff event-listener P3 projection) → author producer contracts, validate against REAL emissions ([[event-subject-contracts]]). (8 TELEMETRY — verified ZERO cross-service consumers 2026-06-11) GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED, MARKET_SIGNAL_DETECTED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, AGENT_OUTPUT_CREATED, AUDIT_ARTIFACT_CREATED, USER_INTERACTION_CREATED → decide per-event: author a contract OR stop emitting the CDC event entirely (no consumer → [[no-deprecation]] favours stop-emitting). As each __typename is typed (or its emission removed), drop it from the cdc-publisher-typed-subjects exemption registry. Ranked top of QUEUED per 2026-06-11 user direction (it blocks full advisory typing + WS-3 consumer parsing of the 4)."
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
contracts for the **primary** advisory subjects (`InvestorProfileSnapshot`, `MarketSnapshot`,
`DecisionPacket`, `MandateSnapshot`, `ComplianceCheck`, `DecisionReadModel`,
`UserConfirmation`, `UserRejection`, and the `*AgentOutput` agent-output sub-schemas) but left
**12 advisory-core agent-internal / projection CDC `__typename`s with no zod contract**.

`cdc-publisher-typed-subjects` (WS-2) **exempts** these from its `schemas` registry (they emit
the status-quo fat untyped row, registered in the publisher exemption set) so WS-2 can stay a
pure publisher-typing-mechanism workstream. This item closes the gap.

## The 12 uncovered emitted `__typename`s

| Producer | `__typename` | Emitted event | Consumer? |
|---|---|---|---|
| investor-profile-ctrl | `AgentInvocation` | `GOAL_INTERPRETATION_PRODUCED` | none |
| investor-profile-ctrl | `ReasoningOutput` | `RISK_EVALUATION_PRODUCED` | none |
| market-intelligence-ctrl | `AgentInvocation` | `MARKET_SIGNAL_DETECTED` | none |
| portfolio-engine-ctrl | `AgentInvocation` | `PORTFOLIO_CONSTRUCTION_PROPOSED` | none |
| portfolio-engine-ctrl | `ReasoningOutput` | `REBALANCE_PLAN_PRODUCED` | none |
| portfolio-engine-ctrl | `AgentFailure` | `PORTFOLIO_FAILED` | **decision-workflow-ctrl sfn-callback** |
| advisory-narrative-ctrl | `ReasoningOutput` | `EXPLANATION_GENERATED` | **investor-adpt + advisory-adpt** |
| advisory-narrative-ctrl | `AgentFailure` | `NARRATIVE_FAILED` | **decision-workflow-ctrl sfn-callback** |
| decision-workflow-ctrl | `AgentOutput` | `AGENT_OUTPUT_CREATED` | none |
| compliance-ctrl | `AuditArtifact` | `AUDIT_ARTIFACT_CREATED` | none |
| advisory-bff | `AdvisoryStatus` | `ADVISORY_STATUS_UPDATED` | **dashboard-bff event-listener (P3)** |
| advisory-bff | `UserInteraction` | `USER_INTERACTION_CREATED` | none |

(Consumer presence verified 2026-06-11 by grepping each event name across `services/**`
excluding the producer + tests.)

## Work

### A. The 4 consumer-having events (priority — WS-3 depends on these)

`PORTFOLIO_FAILED`, `NARRATIVE_FAILED`, `EXPLANATION_GENERATED`, `ADVISORY_STATUS_UPDATED`.
Author a producer-owned zod contract for each (named after the clean event concept, no
`Subject` suffix), type the persisted row as `TableEntry<Subject>`, and **validate against the
REAL emitted shape** — a real persisted row / captured CDC subject, NOT a fixture (the
`[[event-subject-contracts]]` lesson; agent-failure + status rows are driven by real
agent-failure + advisory-status e2e paths). Note the `AgentFailure` rows for `PORTFOLIO_FAILED`
/ `NARRATIVE_FAILED` are structural dups differing by `agentName` literal — consider the shared
`AgentFailureRow<A extends string>` generic mirroring the WS-1 `*AgentOutput` treatment.

### B. The 8 consumer-less telemetry events (decide: type or stop-emitting)

`GOAL_INTERPRETATION_PRODUCED`, `RISK_EVALUATION_PRODUCED`, `MARKET_SIGNAL_DETECTED`,
`PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`, `AGENT_OUTPUT_CREATED`,
`AUDIT_ARTIFACT_CREATED`, `USER_INTERACTION_CREATED`. These have **zero cross-service
consumers**. Per-event decide: author a contract (if the emission is intentionally retained as
an observable telemetry/audit signal), OR remove the CDC emission entirely (drop the
`__typename` from the service's Egress `eventTypes` map — `[[no-deprecation]]` favours
stop-emitting a row no consumer reads). The advisory agents return to the orchestrator via
Step Functions task tokens, not these events, so removing them does not break the decision
cycle — confirm per event before removing.

### C. Drain the WS-2 exemption registry

As each `__typename` is typed (A/B) or its emission removed (B), delete it from the
`cdc-publisher-typed-subjects` publisher exemption set so the completeness guard then requires
a real schema. When all 12 are drained the exemption set is empty and advisory-core publishers
are fully typed.

## Done

All 4 consumer-having events have producer contracts validated against real emissions; each of
the 8 telemetry events is either typed or no longer emitted; the WS-2 publisher exemption
registry is empty.
