# Workstream 3 — advisory versioned DecisionPacket projection (design)

**Date:** 2026-05-30
**Backlog:** `bff-readmodel-w3-advisory-decision-packet` (ACTIVE, `type: refactor`, `effort: xhigh`)
**Program spec:** `docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md`
(rollout step 3; see §Decomposition + §Per-row classification)
**Status:** design, pending plan

This is the workstream-level design for rollout step 3 of the BFF read-model
materialization redesign. It records the architectural decisions resolved during
brainstorming and the verified mechanisms; it does not restate the program spec.
The program spec is the authority for the pattern (`projectVersioned`, the P1/P2/P3
variants, the ownership tags, the freeze layers). Read it first.

## Problem (workstream-scoped)

The advisory decision read model is the most race-prone path in the system. Two
shipped bug fixes already live here, both visible in the current code:

- **Sparse-item race** — `advisory-bff/src/transforms/decision-status-changed.ts:55`
  guards an UPDATE-before-CREATE race with `updateOrRetry(..., { condition:
  'attribute_exists(pk)' })`.
- **Out-of-order / dual-path clobber ("Bug E", 2026-05-24)** —
  `decision-status-changed.ts:11-22` documents that advisory-bff *deliberately
  ignores* `DECISION_PACKET_UPDATED` and instead maps the per-field status-fragment
  events (`DECISION_APPROVED`/`DECISION_BLOCKED`/`USER_CONFIRMATION_REQUESTED`) to a
  display status, because the CDC `DECISION_PACKET_UPDATED` and the fragment events
  both fan out and a late `UPDATED` would overwrite a terminal status.
- **L2 overwrite race (2026-05-26 fix)** — `decision-status-changed.ts:30-44` makes
  `DECISION_APPROVED` a no-op for L2 so that only `USER_CONFIRMATION_REQUESTED` drives
  the `AWAITING_CONFIRMATION` transition, because the two events race with no
  completion-order guarantee.

These are the four-faced bug class the program spec dissolves. This workstream
applies the cure: make `DecisionReadModel` a **versioned P1 projection** of a single
authoritative producer.

## Verified facts (code-grounded, 2026-05-30)

1. **Single writer already.** Both `DecisionPacket` row write paths live inside
   `decision-workflow-ctrl`: `assemble-packet.ts` → `decision-packet.repository.ts`
   `createDecisionPacket` (`putIfNotExists`, `status: 'INITIATED'`) and
   `handlers/sfn-callback.ts:73,95` (`update('DecisionPacket', …)` on compliance and
   user-response events). `compliance-ctrl` writes its *own* `ComplianceCheck` row and
   emits `DECISION_APPROVED`/`DECISION_BLOCKED`; it does **not** write the
   `DecisionPacket` row. The SF "UpdateStatus*" states
   (`decision-state-machine.ts:248,252,291`) are comment-only `Pass` states — they do
   not write. **Producer authority = decision-workflow-ctrl, settled.**

2. **CDC already emits the full row.** DWC egress is bare `changeDataCapture()`
   (`event-publisher.ts`). With no `transform`, `change-data-capture.ts:127` sets
   `subject: record` = the full DynamoDB Streams `NewImage`. Streams always emit a
   complete `NewImage` after any write (Put/Update/TransactWrite), so every
   `DECISION_PACKET_CREATED`/`DECISION_PACKET_UPDATED` already carries the full
   snapshot. **No Egress change is needed.**

3. **No `__version` today.** `decision-packet.repository.ts` writes no version
   attribute. advisory-bff's `DecisionReadModel` has a hardcoded `version: 1`
   (`decision-packet-created.ts:38`) that never increments.

4. **The `taskToken` is the one field not on the row.** The L2 user-confirmation SF
   task token exists only in the `USER_CONFIRMATION_REQUESTED` event
   (`decision-state-machine.ts:275`); advisory-bff persists it onto `DecisionReadModel`
   (`decision-status-changed.ts:46-53`) so `confirmDecision`/`rejectDecision` can
   resume the SF. Retiring the fragment event requires the token to reach the
   authoritative row some other way.

5. **`.waitForTaskToken` on DynamoDB — AWS SDK integration only.** Per the SF
   integration-pattern reference
   (`docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource`): the
   *optimized* `dynamodb` integration does **not** support `.waitForTaskToken`, but
   the **AWS SDK integration** (`arn:aws:states:::aws-sdk:dynamodb:updateItem`) does
   on Standard Workflows — the only rule is "the API must have a parameter field in
   which to place the task token." `UpdateItem` qualifies (embed `$$.Task.Token` in
   `ExpressionAttributeValues`, write it to an attribute). **No Lambda required.**

6. **Two inconsistent `AdvisoryStatus` accumulators exist.** advisory-bff
   (`decision-trigger-received` +1 on 7 triggers; `decision-packet-created` −1 on
   packet-created) and dashboard-bff (`advisory-status.ts` +1 on triggers, −1 on
   `DECISION_APPROVED`/`DECISION_BLOCKED`). They count *different* windows and are the
   exact "accumulate from disparate events" anti-pattern the spec kills.

## Decisions (resolved at brainstorm, 2026-05-30)

- **D1 — version stamping = DynamoDB atomic counter.** `ADD __version :1` on every
  producer write; create initializes to 1. Server-side monotonic, no clock
  dependency. At-least-once redelivery just bumps the version with identical content
  (harmless); the consumer's `projectVersioned` guard
  (`attribute_not_exists(pk) OR attribute_not_exists(#__version) OR #__version <
  :version`) dedupes and orders.

- **D2 — taskToken reaches the row natively, no Lambda.** `RequestUserConfirmation`
  changes from `putEvents.waitForTaskToken` to
  `arn:aws:states:::aws-sdk:dynamodb:updateItem.waitForTaskToken` (raw-ASL
  `CustomState`, consistent with the existing `WaitForCompliance` CustomState). One
  atomic write:
  `ADD #__version :one SET #status = :awaiting, taskToken = :token, updatedAt = :now`
  with `:token = $$.Task.Token`, `:awaiting = "AWAITING_CONFIRMATION"`. CDC emits the
  full snapshot (status + token + bumped version); advisory-bff projects it;
  `confirmDecision`/`rejectDecision` read the token from the projected row unchanged.
  `USER_CONFIRMATION_REQUESTED` is removed entirely.

- **D3 — AdvisoryStatus authority = advisory-bff; dashboard-bff projects it.**
  advisory-bff derives `inFlightCount` over its projected `DecisionReadModel` rows
  (recompute-on-change via a bounded per-tenant `tenantId-index` query), materializes
  `AdvisoryStatus` (+ `__version`), emits `ADVISORY_STATUS_UPDATED` (it already does).
  dashboard-bff drops its `accumulate` and projects that announced aggregate
  (P3-from-authoritative-aggregate) via `projectVersioned`.

- **L2 write = single writer.** sfn-callback's compliance handler stops setting
  `status` for L2 — it records only `complianceResult` + `authorityLevel`. The SF
  `UpdateItem.waitForTaskToken` is the sole writer of `AWAITING_CONFIRMATION` (+ token
  + version). L1 `APPROVED` stays terminal in sfn-callback as today.

- **inFlightCount redefinition (approved behavior change).** `inFlightCount` is
  redefined as *the count of `DecisionReadModel` rows in a non-terminal status*
  (`PENDING`/`AWAITING_CONFIRMATION`). Because the `decisionId` is generated inside the
  SF (post-trigger, `States.UUID()`), the pre-packet "agents-running" window (~30-60s)
  has no per-decision row and is **no longer counted**. This replaces two drift-prone,
  mutually-inconsistent accumulators with one accurate-by-construction metric. The
  badge will not tick up during the agent phase — accepted by the user.

## Target architecture

```
decision-workflow-ctrl (sole writer of the DecisionPacket aggregate, stamps __version)
  AssemblePacket           create  : ADD __version (=1), status=PENDING*, explanation, proposedTrades …
  sfn-callback (compliance) update : ADD __version, complianceResult, authorityLevel,
                                     status=APPROVED (L1) | BLOCKED ; (L2: NO status write)
  SF RequestUserConfirmation       : aws-sdk:dynamodb:updateItem.waitForTaskToken →
                                     ADD __version, status=AWAITING_CONFIRMATION, taskToken
  sfn-callback (user response) update : ADD __version, status=CONFIRMED|REJECTED, userDecision …
        │  DynamoDB Streams NewImage (full row, incl. __version + taskToken)
        ▼  changeDataCapture()  →  DECISION_PACKET_CREATED | DECISION_PACKET_UPDATED
        │
        ├─► advisory-bff  : projectVersioned('DecisionReadModel', subject, {version: subject.__version})  [P1]
        │                   recompute inFlightCount over DecisionReadModel rows → AdvisoryStatus (+__version)
        │                   → emits ADVISORY_STATUS_UPDATED                                                [P3]
        │
        └─► dashboard-bff : (advisory→investor adapter forwards ADVISORY_STATUS_UPDATED)
                            projectVersioned('AdvisoryStatus', subject, {version})                         [P3]

* status vocabulary unified so the snapshot is projected verbatim (no field remap);
  plan reconciles the producer's create status (INITIATED↔PENDING).
```

## Deliverables

**decision-workflow-ctrl (producer)**
- Stamp `__version` (atomic `ADD`) on all three write paths: AssemblePacket create,
  sfn-callback `update()` (compliance + user-response), SF `UpdateItem`. Define the
  producer-side version-stamping convention (the event-processor `update`/create path
  must support the atomic increment; the SF state uses raw ASL).
- Convert `RequestUserConfirmation` to `aws-sdk:dynamodb:updateItem.waitForTaskToken`;
  remove `USER_CONFIRMATION_REQUESTED` emission + event type.
- sfn-callback compliance handler: drop the L2 `status` write (keep complianceResult +
  authorityLevel).
- Reconcile the create status vocabulary so advisory-bff can project `status` verbatim.
- IAM: grant the SF execution role `dynamodb:UpdateItem` on the DWC State table.

**advisory-bff (consumer)**
- Replace `decision-packet-created.ts` + `decision-status-changed.ts` with one
  transform projecting `DECISION_PACKET_CREATED` + `DECISION_PACKET_UPDATED` via
  `projectVersioned('DecisionReadModel', subject, {version})`.
- Drop ingress subscriptions to `DECISION_APPROVED`, `DECISION_BLOCKED`,
  `USER_CONFIRMATION_REQUESTED`; delete the `attribute_exists` band-aid, the Bug-E
  ignore-`UPDATED` workaround, and the L2 no-op.
- `inFlightCount`: recompute over `DecisionReadModel` rows on each projection; write
  `AdvisoryStatus` (+`__version`) + emit `ADVISORY_STATUS_UPDATED`. Delete the two
  `accumulate` writers (trigger +1, packet-created −1) and the 7 trigger subscriptions
  if they serve no other purpose (verify in plan).
- Add `read-model-ownership.ts`: `DecisionReadModel → Projection<'P1'>`,
  `AdvisoryStatus → Projection<'P3'>`.

**dashboard-bff (consumer)**
- Drop the `advisory-status.ts` `accumulate`; project `ADVISORY_STATUS_UPDATED` via
  `projectVersioned('AdvisoryStatus', subject, {version})`.
- Register `AdvisoryStatus → Projection<'P3'>` in `read-model-ownership.ts` (resolves
  the w2 carry-over).
- Wire the advisory→investor cross-domain forwarding of `ADVISORY_STATUS_UPDATED`
  (mirror the existing forwarding that feeds dashboard-bff's current accumulate).

## Testing / validation

- `event-processor:typecheck` — the ownership tags make `accumulate` on a `Projection`
  typename, or a command write to a `Projection`, fail to compile.
- Unit: advisory-bff (collapsed projection transform; version-guard/stale-drop;
  inFlightCount derivation), decision-workflow-ctrl (`decision-state-machine.test.ts`
  new CustomState ASL; `sfn-callback.test.ts` L2-no-status + `__version`;
  `service.stack.test.ts` IAM grant; AssemblePacket `__version` init), dashboard-bff
  (AdvisoryStatus projection).
- Integration: advisory-bff version-guard + stale-drop projection + token round-trip;
  DWC `__version` stamping; dashboard-bff AdvisoryStatus projection.
- Deploy `--services=decision-workflow-ctrl,advisory-bff,dashboard-bff` + scoped e2e:
  advisory-flow Playwright (L1 auto-approve **and** L2 confirm path) + the decision/
  new-investor e2e scenarios. Confirm the L2 confirm/reject still resumes the SF
  (taskToken round-trip through the projected row).

## Out of scope

- investor-bff `CashBalance` P1 + command-row confirmation — **w4**.
- Externally-settled Deposit/Withdrawal/Order ownership + intent events — **w5**.
- Governance/freeze enforcement layers 3+4 (skills, audits, CI lint) — **w6**; only the
  advisory-bff + dashboard-bff `ReadModelOwnership` registrations for the rows this
  workstream migrates land here.
- Live-push transport for advisory/decision rows — rebuilt on the clean read model
  afterward.
- Event sourcing on the write side — program-wide out of scope.
- Re-architecting the L1/L2 authority split or the compliance↔decision-workflow
  task-token handshake beyond emitting one authoritative versioned snapshot. If
  consolidating the status path turns out to need an aggregate-owner promotion (spec
  §Command-side escalation rule), that surfaces as a decision, not silent expansion.

## Residual risks (for the plan)

- **Producer-side `__version` stamping path.** The event-processor `update()` intent
  and the repository create must do the atomic `ADD __version`. w0 added only the
  consumer `projectVersioned`; confirm/extend the producer write path (or stamp in the
  repository) so all three write paths increment consistently.
- **Cross-domain forwarding of `ADVISORY_STATUS_UPDATED`.** Verify the advisory→investor
  adapter rule + dashboard-bff subscription; mirror the existing trigger-event
  forwarding that feeds today's accumulate.
- **Status vocabulary unification.** Pick one vocabulary (likely align the producer's
  create status to what the UI/GraphQL `WorkflowStatus` enum expects) so the projection
  stays a pure full-row copy with no field remap.
- **inFlightCount recompute cost.** A bounded `tenantId-index` query per projection;
  acceptable, but confirm the query stays bounded (decisions per tenant) and never
  scans / never `FilterExpression`s on a GSI key attribute.
