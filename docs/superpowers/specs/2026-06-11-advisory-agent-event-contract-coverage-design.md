# Advisory agent-internal event contract coverage (WS-1 completion) — Design

- **Date:** 2026-06-11
- **Status:** design (approved decisions; ready for writing-plans)
- **Backlog:** `docs/backlog/advisory-agent-event-contract-coverage.md`
- **Program:** completes WS-1 of the typed-subject program — strategy
  `docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md`; closes the coverage gap
  that WS-2 (`docs/superpowers/specs/2026-06-11-cdc-publisher-typed-subjects-design.md`, Decision 5)
  deferred via `exemptTypenames`.
- **Depends on:** WS-1 (`typed-subject-producer-contracts`, shipped) + WS-2
  (`cdc-publisher-typed-subjects`, shipped). **Blocks:** WS-3 (`consumer-parse-subject`) for the 6
  consumer-having events.

## Problem

The shipped WS-1 advisory slice (`typed-subject-contracts-advisory`) authored producer zod
contracts for the **primary** advisory ROW subjects (`InvestorProfileSnapshot`, `MarketSnapshot`,
`DecisionPacket`, `MandateSnapshot`, `ComplianceCheck`, `DecisionReadModel`, `UserConfirmation`,
`UserRejection` — all e2e-validated row-level) but left **14 advisory-core agent-internal /
projection CDC `__typename`s with no row-level zod contract**. WS-2 (Decision 5) registered each in
its service handler's `exemptTypenames` set (emits the status-quo fat row, no crash, no regression)
rather than author the missing contracts. This workstream closes that gap and drains the exemption
registries to empty.

### Verified current state (against shipped WS-2 code, 2026-06-11)

The finalized `exemptTypenames` registries live in each service's
`src/handlers/publisher-schemas.ts`. They map exactly to 14 `(producer × __typename × event)` rows:

| Producer | `__typename` | Emitted event | Consumer? |
|---|---|---|---|
| investor-profile-ctrl | `AgentInvocation` | `GOAL_INTERPRETATION_PRODUCED` | none |
| investor-profile-ctrl | `ReasoningOutput` | `RISK_EVALUATION_PRODUCED` | none |
| market-intelligence-ctrl | `AgentInvocation` | `MARKET_SIGNAL_DETECTED` | none |
| portfolio-engine-ctrl | `AgentInvocation` | `PORTFOLIO_CONSTRUCTION_PROPOSED` | none |
| portfolio-engine-ctrl | `ReasoningOutput` | `REBALANCE_PLAN_PRODUCED` | none |
| portfolio-engine-ctrl | `AgentCompletion` | `PORTFOLIO_COMPLETED` | **DWC CallbackIngress** |
| portfolio-engine-ctrl | `AgentFailure` | `PORTFOLIO_FAILED` | **DWC sfn-callback** |
| advisory-narrative-ctrl | `ReasoningOutput` | `EXPLANATION_GENERATED` | **investor-adpt** |
| advisory-narrative-ctrl | `AgentCompletion` | `NARRATIVE_COMPLETED` | **DWC CallbackIngress** |
| advisory-narrative-ctrl | `AgentFailure` | `NARRATIVE_FAILED` | **DWC sfn-callback** |
| decision-workflow-ctrl | `AgentOutput` | `AGENT_OUTPUT_CREATED` | none |
| compliance-ctrl | `AuditArtifact` | `AUDIT_ARTIFACT_CREATED` | none |
| advisory-bff | `AdvisoryStatus` | `ADVISORY_STATUS_UPDATED` | **dashboard-bff event-listener (P3)** |
| advisory-bff | `UserInteraction` | `USER_INTERACTION_CREATED` | none |

Consumer presence verified by grepping each event name across `services/**` excluding the producer
and tests:
- 6 **consumer-having**: `PORTFOLIO_COMPLETED`/`FAILED` + `NARRATIVE_COMPLETED`/`FAILED`
  (→ `decision-workflow-ctrl/src/handlers/sfn-callback.ts:25/47`), `EXPLANATION_GENERATED`
  (→ `investor-adpt/src/service.stack.ts:41`), `ADVISORY_STATUS_UPDATED`
  (→ `dashboard-bff/src/handlers/event-listener.ts:41`).
- 8 **consumer-less telemetry**: zero cross-service consumers (Egress declarations only).

### The `AgentCompletion` trap

`portfolio-engine-ctrl` / `advisory-narrative-ctrl` export `PortfolioAgentOutputSchema` /
`NarrativeAgentOutputSchema` (`src/domain/contracts.ts`), but these type the **`agentOutput`
field**, not the row. The emitted `AgentCompletion` subject is the whole row
`{ decisionId, agentName, taskToken, agentOutput, completedAt }` (+ envelope + `tenantId`), so
`PortfolioAgentOutputSchema.parse(row)` fails. The row already has a TS type —
`AgentCompletionRow<'portfolio-engine', PortfolioAgentOutput>` from `@nestfolio/agent-orchestrator`
(`libs/agent-orchestrator/src/agent-completion-row.ts:16`) — but no runtime zod equivalent.
`AgentFailure` is the structural sibling (`AgentFailureRow<A>`, same file:21).

## Goal

Every one of the 14 `__typename`s is either typed (producer-owned row-level zod contract validated
against the real emission) or no longer CDC-emitted; every advisory-core publisher's
`exemptTypenames` is `[]`; the WS-2 registry-completeness guard then requires a real schema for
every emitted `__typename`.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | The 8 consumer-less telemetry events | **Stop emitting all 8** (user direction 2026-06-11). Remove each `__typename`→event from the service's CDK Egress `eventTypes` map *and* from `exemptTypenames`. Rows still persist in DDB; only the CDC→EventBridge emission stops. Rationale: zero consumers; a dedicated `AgentTraceEnvelope` channel (`*_AGENT_INVOCATION_TRACED` via `EventBridgeTraceEmitter`) is already the canonical agent-observability pattern, so these CDC `*_PRODUCED`/`*_CREATED` events are duplicate signal; `[[no-deprecation]]` favours removing a row no consumer reads; agents resume via SF task tokens, not these events. |
| 2 | The 4 `AgentCompletion`/`AgentFailure` contracts | **Shared zod-schema generator in `@nestfolio/agent-orchestrator`**, mirroring the existing `AgentCompletionRow<A,O>`/`AgentFailureRow<A>` TS generics — not hand-rolled per service. Reusability is the primary objective: any future task-token agent gets a row contract for free, and the four contracts become one-liners. |
| 3 | The 2 bespoke contracts' homes | **Defined in the producer's own `/contracts`** (`ExplanationGenerated` → `advisory-narrative-ctrl/contracts`; `AdvisoryStatus` → `advisory-bff/contracts`) — the producer owns its event subject, matching the `UserConfirmation`/`UserRejection` precedent. The `advisory-adpt/domain` cross-domain **re-export** (the import surface for the investor-domain consumers `investor-adpt`/`dashboard-bff`) is added by WS-3 (consumer-side), out of scope here — exactly as WS-1 left `UserConfirmation`. (`ProposedTrade` lives directly in `advisory-adpt/domain` only because it is a shared *value object* with no single producer service, not an event subject.) |
| 4 | The 4 AgentCompletion/Failure contract homes | Consumed by DWC (advisory) → **intra-domain** → each producer's own `@nestfolio/<svc>/contracts`. |
| 5 | Workstream shape | **One workstream** (the backlog Done = whole registry drained), internally phased: generator → AgentCompletion/Failure contracts → bespoke contracts → stop-emit the 8 → closing deploy + scoped e2e. |

## Architecture

### §1 — The reusable generator (`libs/agent-orchestrator/src/agent-completion-row.ts`)

Add, alongside the existing `AgentCompletionRow<A,O>` / `AgentFailureRow<A>` TS types:

```ts
import { z, type ZodType } from 'zod';

/** Row-level zod contract for a task-token agent's success callback row. Wraps the per-service
 *  agentOutput schema into the full DRY subject (envelope + tenantId stripped on parse). */
export const AgentCompletionRowSchema = <A extends string, O>(
  agentName: A,
  agentOutput: ZodType<O>,
) =>
  z.object({
    decisionId: z.string(),
    agentName: z.literal(agentName),
    taskToken: z.string(),
    agentOutput,
    completedAt: z.string(),
  });

export const AgentFailureRowSchema = <A extends string>(agentName: A) =>
  z.object({
    decisionId: z.string(),
    agentName: z.literal(agentName),
    taskToken: z.string(),
    errorType: z.string(),
    errorMessage: z.string(),
    failedAt: z.string(),
  });
```

- **DRY by construction.** The publisher emits `Schema.parse(row)`; zod strips unknown keys, so the
  envelope (`pk`/`sk`/`__typename`/`createdAt`/`ttl`/`version`) and `tenantId` (→ event `context`)
  drop out, leaving exactly the domain subject. `taskToken` stays in the subject — the DWC consumer
  needs it to call `SendTaskSuccess`/`SendTaskFailure`.
- **Type fidelity.** A type-level test asserts `z.infer<ReturnType<typeof AgentCompletionRowSchema>>`
  structurally equals the domain-subject portion of `AgentCompletionRow<A, O>` (i.e. the row type
  minus the `TableEntry` envelope and the `{ tenantId }` context generic), guaranteeing the runtime
  schema and the TS generic cannot drift.
- The exact zod surface (`z.literal` vs `z.string` for `agentName`, whether `agentOutput` is passed
  as `ZodType<O>` or a generic param) is finalized in the plan against the real
  `Portfolio/NarrativeAgentOutputSchema` signatures; the shape above is the contract.

### §2 — Part A: the 6 consumer-having contracts

| Event | `__typename` | Contract expression | Home (export path) |
|---|---|---|---|
| `PORTFOLIO_COMPLETED` | AgentCompletion | `AgentCompletionRowSchema('portfolio-engine', PortfolioAgentOutputSchema)` | `@nestfolio/portfolio-engine-ctrl/contracts` |
| `PORTFOLIO_FAILED` | AgentFailure | `AgentFailureRowSchema('portfolio-engine')` | `@nestfolio/portfolio-engine-ctrl/contracts` |
| `NARRATIVE_COMPLETED` | AgentCompletion | `AgentCompletionRowSchema('advisory-narrative', NarrativeAgentOutputSchema)` | `@nestfolio/advisory-narrative-ctrl/contracts` |
| `NARRATIVE_FAILED` | AgentFailure | `AgentFailureRowSchema('advisory-narrative')` | `@nestfolio/advisory-narrative-ctrl/contracts` |
| `EXPLANATION_GENERATED` | ReasoningOutput | bespoke `ExplanationGenerated` schema (real AN `ReasoningOutput` row shape) | `@nestfolio/advisory-narrative-ctrl/contracts` |
| `ADVISORY_STATUS_UPDATED` | AdvisoryStatus | bespoke `AdvisoryStatus` schema (real bff `AdvisoryStatus` row shape) | `@nestfolio/advisory-bff/contracts` |

- The agent name literals must match the values the producers actually persist (`'portfolio-engine'`
  / `'advisory-narrative'` per the `domain/models.ts` typed aliases) — confirmed in the plan against
  the real rows, since `z.literal` will reject a mismatched value at parse time (a useful tripwire).
- The 2 **bespoke** contracts (`ExplanationGenerated`, `AdvisoryStatus`) are authored from the
  **real persisted row** (read the producer's writer + a captured/real row), DRY (identity in
  `context`, not subject), named per convention 4 (clean event-concept name, no `Subject` suffix).
- Each producer's `publisher-schemas.ts` adds the schema to `subjectSchemas` and removes the
  `__typename` from `exemptTypenames`. **Every producer imports its contract from its OWN
  `@nestfolio/<svc>/contracts`** — the publisher emits its own service's rows, so this is always an
  intra-service import (no adapter, no cross-domain import in this workstream). The
  `advisory-adpt/domain` re-export that lets the investor-domain consumers (`investor-adpt`,
  `dashboard-bff`) import `ExplanationGenerated`/`AdvisoryStatus` cross-domain is **WS-3's** job —
  out of scope here, exactly as WS-1 left the `UserConfirmation` re-export for WS-3.
- **Note on `ReasoningOutput` reuse.** `ReasoningOutput` is a `__typename` used by 3 services with
  distinct payloads: AN→`EXPLANATION_GENERATED` (typed here), IP→`RISK_EVALUATION_PRODUCED` and
  PE→`REBALANCE_PLAN_PRODUCED` (both stop-emitted in Part B). Each service's `ReasoningOutput` row is
  its own producer-owned contract; only AN's is authored.

### §3 — Part B: stop-emit the 8 consumer-less telemetry events

`GOAL_INTERPRETATION_PRODUCED`, `RISK_EVALUATION_PRODUCED`, `MARKET_SIGNAL_DETECTED`,
`PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`, `AGENT_OUTPUT_CREATED`,
`AUDIT_ARTIFACT_CREATED`, `USER_INTERACTION_CREATED`.

For each event, two coordinated edits keep the WS-2 completeness guard
(`subjectSchemas ∪ exemptTypenames == emitted __typename set`) green:

1. Remove the `__typename`→event entry from the producer's **CDK Egress `eventTypes` map**
   (`service.stack.ts`) — so the `__typename` leaves the emitted set entirely. The agent still
   writes the row to DDB; the CDC stream simply no longer maps it to an EventBridge emission.
2. Remove the `__typename` from `exemptTypenames` in `publisher-schemas.ts` (and its per-service
   unit-test emitted-set assertion).

**Per-event pre-removal confirmation** (already grep-verified zero cross-service consumers; the plan
re-confirms each): no EventBridge rule, no cross-domain adapter `$or`/forwarding subscription, and no
`flows/*.flow.yaml` references the event. The advisory agents return to the orchestrator via SF task
tokens, not these events, so removing them does not affect the decision cycle.

Where an `AgentInvocation` / `ReasoningOutput` row is written purely to drive the now-removed CDC
emission and nothing else reads it, the plan evaluates removing the dead **write** too (file-and-
continue if it is entangled); the contract-coverage Done only requires the emission gone, so a
dead-write cleanup is opportunistic, not blocking.

### §4 — Part C: drain the exemption registries (end-state)

After Parts A + B, every advisory-core publisher's `exemptTypenames` is `[]`:

| Service | Covered after | Exempt after |
|---|---|---|
| investor-profile-ctrl | `InvestorProfileSnapshot` | `[]` (AgentInvocation, ReasoningOutput stop-emitted) |
| market-intelligence-ctrl | `MarketSnapshot` | `[]` (AgentInvocation stop-emitted) |
| portfolio-engine-ctrl | `AgentCompletion`, `AgentFailure` | `[]` (AgentInvocation, ReasoningOutput stop-emitted) |
| advisory-narrative-ctrl | `ReasoningOutput`(→ExplanationGenerated), `AgentCompletion`, `AgentFailure` | `[]` |
| decision-workflow-ctrl | `DecisionPacket`, `MandateSnapshot`, … | `[]` (AgentOutput stop-emitted) |
| compliance-ctrl | `ComplianceCheck` | `[]` (AuditArtifact stop-emitted) |
| advisory-bff | `DecisionReadModel`, `UserConfirmation`, `UserRejection`, `AdvisoryStatus` | `[]` (UserInteraction stop-emitted) |

The WS-2 cold-start completeness assertion and per-service unit tests then enforce that every emitted
advisory-core `__typename` has a real schema.

## Validation strategy

Per the program's #1 risk — **validate against the REAL emission, not fixtures**
(`[[event-subject-contracts]]`: a schema co-wrong with its fixture passed integration; only e2e
caught it).

- **Unit (per service, fast, no deploy).** For each newly-covered `__typename`: drive the publisher
  (`changeDataCapture({ schemas, exemptTypenames })`) with a realistic row fixture and assert the
  emitted `subject` strict-equals `Schema.parse(row)` and carries no envelope keys
  (`pk`/`sk`/`__typename`/`tenantId` absent); a drifted row throws `NotRetryableError`; the
  registry-completeness cross-check (`covered ∪ exempt == emitted set`) holds with the stop-emitted
  types gone. Plus the generator's type-level test (§1) and `tsc` green.
- **e2e #1-risk gate (real emissions).** Extend the existing advisory `contract-emission` e2e gate to
  assert each real persisted row for the 6 consumer-having events parses against its new contract,
  and that the 8 stop-emitted events **no longer fire** (no EventBridge emission for the removed
  `__typename`s on a real decision cycle). Reuse the existing emission-capture/trap pattern; do not
  build new infrastructure.
- **Deploy.** Complex lane: deploy the affected advisory-core services + `agent-orchestrator`
  consumers to dev, run the scoped advisory e2e (the decision-cycle / contract-emission scenarios
  the change touches), not the full suite.

**Known e2e risk — advisory gate is sandbox-maxVms-flaky.** The advisory `contract-emission` /
full-decision-cycle e2e is gated on the 4-agent decision cycle materializing `InvestorProfileSnapshot`
under the deliberately-low sandbox AgentCore `maxVms` quota; it is documented flaky-not-broken
(passed 7/7 in WS-1 `typed-subject-contracts-advisory`; see `contract-emission-dry-wire-reenable`,
`agentcore-maxvms-prod-quota-increase`). The unit layer (every `__typename`, deterministic) is the
primary correctness gate; the e2e is the #1-risk real-emission confirmation. A fail-then-pass is
treated as a real failure — pull CloudWatch evidence from the failing window before continuing and
run a confirmation pass (`[[feedback-flake-means-broken]]`); do not extend POM timeouts as a
band-aid. If the cycle cannot complete under the sandbox quota within the workstream, the 6-contract
parse-assertion can be confirmed against captured/real persisted rows (the unit + real-row path)
rather than blocking the ship on the maxVms-bound full cycle — mirroring how WS-1 shipped.

## Phasing (one workstream, internal commits)

1. **Generator + type test** in `@nestfolio/agent-orchestrator` (`AgentCompletionRowSchema` /
   `AgentFailureRowSchema`). No deploy.
2. **AgentCompletion/AgentFailure contracts** (PE-ctrl + AN-ctrl `/contracts`) + their
   `publisher-schemas.ts` wiring + unit tests.
3. **Bespoke cross-domain contracts** (`ExplanationGenerated`, `AdvisoryStatus`) in
   `advisory-adpt/domain/contracts.ts`, authored from the real rows; AN-ctrl + advisory-bff
   publisher wiring + unit tests.
4. **Stop-emit the 8** (CDK Egress `eventTypes` + `publisher-schemas.ts` + per-service unit-test
   emitted-set assertions), per-event consumer re-confirmation.
5. **Closing deploy + scoped e2e** (extended contract-emission gate: 6 parse-asserts + 8
   no-longer-emitted asserts) + verify every advisory-core `exemptTypenames` is `[]`.

## Resolved consistency check (was: open at planning time)

**Resolved (user direction, 2026-06-11): producer-owned `/contracts`.** WS-1 defined the analogous
cross-domain event subjects `UserConfirmation`/`UserRejection` in **`advisory-bff/contracts`** (the
producer), and did **not** re-export them through `advisory-adpt/domain` — because the cross-domain
re-export is the **consumer-side** (WS-3) step, not the producer step. The home rule is:

- The producer **defines** its event-subject contract in its own `@nestfolio/<svc>/contracts`.
- A **same-domain** consumer imports from `{producer}/contracts`.
- A **cross-domain** consumer imports from `{producer-domain}-adpt/domain`, which **re-exports** the
  producer contract — added by the consumer-side workstream (WS-3).
- A shared **value object** with no single producer service (e.g. `ProposedTrade`) lives **directly**
  in `{domain}-adpt/domain` — this is the *only* reason `ProposedTrade` sits in the adapter, and it is
  not the case for an event subject like `ExplanationGenerated`/`AdvisoryStatus`.

So `ExplanationGenerated` → `advisory-narrative-ctrl/contracts` and `AdvisoryStatus` →
`advisory-bff/contracts` (Decision 3, corrected). The `advisory-adpt/domain` re-export for the
investor-domain consumers is WS-3, out of scope here.

## Out of scope

(Mirrors the backlog `out_of_scope:`.)

- **WS-3 consumer-side `parseSubject` conversions** of the 6 consumer-having events (DWC
  sfn-callback/CallbackIngress, investor-adpt, advisory-adpt, dashboard-bff event-listener) — this
  workstream authors the producer contracts only; retyping the consumers is `consumer-parse-subject`.
  **Exception (Decision-4 surgical fix, in scope):** when typing one of these 6 events to DRY makes a
  consumer hard-break by reading a now-stripped envelope/identity field off the subject, the minimal
  surgical read-fix (read that field from `context`) travels with this workstream. The 2026-06-11
  consumer sweep found exactly ONE such break: `dashboard-bff/src/transforms/advisory-status.ts`
  reads `subject.tenantId` for the `AdvisoryStatus` P3 projection key → fixed to
  `uow.event.context.tenantId` (the full `parseSubject(AdvisoryStatusSchema)` conversion stays WS-3).
  `sfn-callback` (4 completion/failure events) already falls back to `ctx.tenantId`; `EXPLANATION_GENERATED`
  has no subject-reading consumer.
- **Re-engineering the CDC publisher pipeline / `changeDataCapture` mechanism** — shipped in WS-2.
  This item only authors the missing contracts and drains `exemptTypenames`.
- **The enforcement capstone** (lint rule / `tools/` check-script / `create-*`/`audit-*` skill +
  arch-doc updates) — `typing-convention-enforcement-skills-docs`.
- **Non-advisory-core publishers already covered by WS-2** (ledger, investor-ctrl, execution-ctrl,
  broker-*, the advisory feed adapters, onboarding-bff) — not re-touched.
- **The 8 primary advisory subjects already contracted + e2e-validated by WS-1** — not re-authored.
- **Latent producer/consumer drift bugs** tracked separately
  (`dwc-sfn-callback-reason-blockreason-gap`, `broker-funding-completed-normalization-drift`) —
  file-and-continue if more surface.

## Done

All 6 consumer-having events have producer-owned row-level zod contracts validated against real
emissions; each of the 8 telemetry events is no longer CDC-emitted; every advisory-core publisher's
`exemptTypenames` is `[]` (WS-2 completeness guard green); the shared
`AgentCompletionRowSchema`/`AgentFailureRowSchema` generators exist in `@nestfolio/agent-orchestrator`
with a type-level fidelity test; publisher unit tests + the extended contract-emission e2e gate are
green against deployed dev.
