# Task-token propagation audit (2026-04-29)

Sweep of every site in the monorepo where a Step Functions `taskToken` (issued via `$$.Task.Token` / `waitForTaskToken`) must survive across an event hop until a `resumeStateMachine` consumer can call `SendTaskSuccess` / `SendTaskFailure`.

## Method

1. `Grep "resumeStateMachine|subject\.taskToken|payload\.subject\?\.taskToken"` — every consumer of taskToken-bearing events.
2. `Grep "waitForTaskToken|\$\$\.Task\.Token"` — every emitter that injects a taskToken into an event/lambda input.
3. For each consumer, walked backwards: which event arrives, who emits it, how many hops between emit and consume, and which hops persist the field.
4. Verified `record(...)` / `update(...)` / AppSync resolver writes that consume taskToken-bearing inputs to confirm the field is preserved on the persisted row (so CDC re-emits it).
5. Read every cross-domain adapter rule for forwarding behavior.

## Findings — Audit table

| # | Site | Inbound event / input | Carries taskToken on input? | Hops to consumer | Survives all hops? | Bug? |
|---|------|----------------------|------------------------------|------------------|--------------------|------|
| 1 | `compliance-ctrl/src/handlers/event-listener.ts` (`processDecisionPacket`) | `DECISION_PACKET_CREATED` | ❌ Row written by `assemble-packet.ts` has no `taskToken` | 2-hop: SF → DDB row → CDC | ❌ field never persisted | **YES — primary bug** |
| 2 | `advisory-bff/src/transforms/decision-status-changed.ts` (USER_CONFIRMATION_REQUESTED branch) | `USER_CONFIRMATION_REQUESTED` | ✅ Yes (decision-state-machine.ts:245) | Sets only `status: AWAITING_CONFIRMATION` on `DecisionReadModel` row — `taskToken` dropped | ❌ | **YES — second bug** |
| 3 | `advisory-bff/src/graphql/js-function/confirm-decision.fn.js` | AppSync mutation `confirmDecision` | n/a (must read taskToken from `DecisionReadModel`) | Writes `UserConfirmation` row → CDC `USER_CONFIRMED` → `decision-workflow-ctrl/sfn-callback.ts` | ❌ row lacks `taskToken` (and source row also lacks it per #2) | **YES — third bug** |
| 4 | `advisory-bff/src/graphql/js-function/reject-decision.fn.js` | AppSync mutation `rejectDecision` | n/a | Writes `UserRejection` row → CDC `USER_REJECTED` | ❌ same as #3 | **YES — fourth bug** |
| 5 | `decision-workflow-ctrl/src/handlers/sfn-callback.ts` (`COMPLIANCE_EVENT_TYPES`) | `DECISION_APPROVED`, `DECISION_BLOCKED` | reads `subject.taskToken` | Consumer of #1 chain | n/a (consumer) | Fails because #1 doesn't emit it |
| 6 | `decision-workflow-ctrl/src/handlers/sfn-callback.ts` (`USER_RESPONSE_EVENT_TYPES`) | `USER_CONFIRMED`, `USER_REJECTED` | reads `subject.taskToken` | Consumer of #3/#4 chain | n/a (consumer) | Fails because #3/#4 don't emit it |
| 7 | `decision-workflow-ctrl/src/handlers/sfn-callback.ts` (`AGENT_COMPLETION_EVENT_TYPES`) | `INVESTOR_PROFILE_COMPLETED`, `MARKET_ANALYSIS_COMPLETED`, `PORTFOLIO_COMPLETED`, `NARRATIVE_COMPLETED` | n/a | Vestigial — no service emits these. Agent services use direct `resumeStateMachine` callback (#8-#11). | n/a | **DEAD CODE** (out of scope; flag for follow-up cleanup) |
| 8 | `investor-profile-ctrl/src/handlers/event-listener.ts` | `ANALYZE_INVESTOR_PROFILE` | ✅ Yes (decision-state-machine.ts:60) | 1-hop, in-process: `resumeStateMachine` reads `payload.subject.taskToken` and calls `SendTaskSuccess` directly | ✅ | No |
| 9 | `market-intelligence-ctrl/src/handlers/event-listener.ts` | `ANALYZE_MARKET` | ✅ Yes | 1-hop direct callback | ✅ | No |
| 10 | `portfolio-engine-ctrl/src/handlers/event-listener.ts` | `CONSTRUCT_PORTFOLIO` | ✅ Yes | 1-hop direct callback | ✅ | No |
| 11 | `advisory-narrative-ctrl/src/handlers/event-listener.ts` | `GENERATE_NARRATIVE` | ✅ Yes | 1-hop direct callback | ✅ | No |
| 12 | `broker-ctrl/src/handlers/route-order.ts` (Lambda invoke.waitForTaskToken) | SF Lambda `Payload.taskToken` | ✅ Yes (state-machine `taskToken.$: $$.Task.Token`) | Persists `fillTaskToken` on `BrokerOrder` row in same Lambda call | ✅ | No |
| 13 | `broker-ctrl/src/handlers/callback-resolver.ts` | `SIM_ORDER_FILLED`/etc. | reads `BrokerOrder.fillTaskToken` from DDB lookup | Consumer of #12 | ✅ | No |

## Cross-domain adapters

`advisory-adpt`, `execution-adpt`, `investor-adpt`, `ledger-adpt` were inspected — none transform the `subject.taskToken` field; they forward `Detail` whole. So an adapter does not strip the field. (Forwarding task tokens across domain bus boundaries IS an authorization smell, but no in-flight forwarding currently exists and the user-confirm flow keeps the loop on `advisoryBus`.)

## Vestigial state-machine emission (RECOMMENDATION_PROPOSED, fire-and-forget)

`decision-workflow-ctrl/src/constructs/decision-state-machine.ts:149-178` — the `PublishRecommendation` task emits `RECOMMENDATION_PROPOSED` with **NO** `taskToken` and **NO** `awaitingCompliance` flag. **No service subscribes to `RECOMMENDATION_PROPOSED`** anywhere in the codebase (`Grep` confirmed). Combined with the second emission at line 180-212 (`waitForCompliance`, with token + flag), this creates a duplicate-event hazard once compliance-ctrl is migrated to subscribe to `RECOMMENDATION_PROPOSED`. Recommendation: drop the fire-and-forget state — out of scope for the bug fix but bundled in the same PR for clarity since both states would need to be reconciled together.

## Latent missing-data bug surfaced during audit

`compliance-ctrl/src/handlers/event-listener.ts:40-44` validates that `payload.subject` carries `proposedTrades`, `portfolioValue`, `riskScore`, `currentPositions`. The `DecisionPacket` row written by `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` (via `DecisionPacketRepository.createDecisionPacket`) carries **none** of these fields. So even with `taskToken` plumbed through, the validation throws `NotRetryableError` and no `ComplianceCheck` row is ever written. This means `processDecisionPacket` has been dead in production since AssemblePacket was introduced. The recommended fix (subscribe to `RECOMMENDATION_PROPOSED` with bundled packet data) **resolves both bugs in one move**; alternative fixes that keep the two-hop pattern need to ALSO add the missing fields to the row.

## Fix plan

### In-scope for this PR

| # | Fix | Owner |
|---|-----|-------|
| 1 | **compliance-ctrl** subscribes to `RECOMMENDATION_PROPOSED` (filter on `awaitingCompliance === true`); drop `DECISION_PACKET_CREATED` / `DECISION_PACKET_UPDATED` subscriptions; persist `taskToken` on the `ComplianceCheck` row. | compliance-ctrl |
| 2 | **decision-workflow-ctrl** state-machine: capture `AssembleDecisionPacket` Lambda result on `$.decisionPacket` (replace `ResultPath: DISCARD`); inline `decisionPacket.proposedTrades`, `.portfolioValue`, `.riskScore`, `.currentPositions` in the `WaitForCompliance` event subject alongside `taskToken`. Drop the vestigial `PublishRecommendation` state. | decision-workflow-ctrl |
| 3 | **decision-workflow-ctrl** `assemble-packet.ts` returns the additional fields from the LangGraph agent outputs (currently parses `portfolioOutput`, `investorProfileOutput`, etc. from Memory). | decision-workflow-ctrl |
| 4 | **advisory-bff** `decision-status-changed.ts` writes `taskToken` from `USER_CONFIRMATION_REQUESTED.subject` to the `DecisionReadModel` row. | advisory-bff |
| 5 | **advisory-bff** `confirm-decision.fn.js` and `reject-decision.fn.js` read `taskToken` from the existing `DecisionReadModel` row (within the TransactWrite's read step or separate query) and include it in the `UserConfirmation` / `UserRejection` PutItem. | advisory-bff |
| 6 | **decision-workflow-ctrl** event-types: ensure `RECOMMENDATION_PROPOSED` is exported from `@nestfolio/decision-workflow-ctrl/events` for compliance-ctrl import. (Already exported per `domain/events.ts:16` — no-op.) | n/a |
| 7 | Update unit + integration tests across compliance-ctrl, decision-workflow-ctrl, advisory-bff. Add a focused regression: SF emits `RECOMMENDATION_PROPOSED` with `taskToken='X'` → CDC chain emits `DECISION_APPROVED` with `taskToken='X'`. | tests |

### Deferred (out of scope, follow-up plans)

- **Vestigial `*_COMPLETED` subscriptions** (#7 in audit table) — `AGENT_COMPLETION_EVENT_TYPES` handlers in `sfn-callback.ts` are dead code. Cleanup PR.
- **ProcessContext systemic refactor** — three propagation seams (ingress→DDB write, DDB stream→CDC event, cross-domain adapter forwarding default-off) deserve a typed `ProcessContext` field. Spec only, no implementation: `docs/superpowers/specs/2026-04-29-process-context.md` (TODO).
