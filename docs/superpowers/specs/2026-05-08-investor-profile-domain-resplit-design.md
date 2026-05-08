# Design: InvestorProfile domain resplit — Mandate as sibling aggregate, policy in compliance, 3-tier event topology

**Date:** 2026-05-08
**Status:** Spec — pending user review before writing-plans.
**ACTIVE workstream:** see `docs/BACKLOG.md` ACTIVE → `investor-profile-domain-resplit`.
**Supersedes:** `docs/backlog/update-operating-mode-mutation-rederivation-gap.md` (root cause not the missing mutation), `docs/backlog/cdc-envelope-omits-previous-subject.md` (folded in as prerequisite).
**Pivots from:** the 2026-05-04 InvestorProfile single-row collapse (`docs/superpowers/specs/2026-05-03-investor-profile-collapse-design.md`) — partially. The collapse correctly removed YAGNI scaffolding (plural Goals, version fields, OperatingModeRecord row) but over-collapsed by mixing two distinct domain concerns onto a single row + single carrier event. This spec resplits the parts that should not have been merged.

---

## 1. Goal

Eliminate the architectural class of bug surfaced by `update-operating-mode-mutation-rederivation-gap`: that an InvestorProfile field change can leave compliance-side guardrails stale, because compliance policy is denormalized into the user's row and re-broadcast over a generic carrier event.

Three concrete moves:

1. **Re-split Mandate as a sibling aggregate** of InvestorProfile (`sk='Mandate'` row), carrying only authority concerns (`mandateId, level, status, effectiveDate, revokedAt`). The 8 numeric guardrail fields leave the user-facing row entirely.
2. **Relocate `GUARDRAIL_TABLE`** from `services/investor/investor-bff/src/domain/guardrail-params.ts` → `services/advisory/compliance-ctrl/src/rules/guardrail-params.ts`. Policy lives where it is enforced. `MandateSnapshot` shape becomes `{operatingMode, level, status}`; thresholds derive at evaluation time.
3. **Introduce a 3-tier event topology** (carrier + semantic + lifecycle) via a new declarative `onFieldChange` extension to `libs/cdk-constructs`. Producer-side field-level diff fans out one CDC modify into the right semantic events alongside the existing carrier.

Side-effects (not the goal, but they fall out automatically):
- `updateOperatingMode(mode: OperatingMode!): InvestorProfile!` becomes a one-field UpdateItem JS resolver — no GUARDRAIL_TABLE bridging across TS/JS-resolver sandbox boundary.
- `updateMandate` mutation deleted (no UI consumer; conflicts with policy-in-compliance principle).
- `setOperatingMode` repo method (currently dead code at `investor-profile.repository.ts:182`) becomes the live write path.
- `MandateStatus` sibling row (CDC-routing optimization for revokeMandate) eliminated — `Mandate` row is the lifecycle row.
- `investor-ctrl`'s 40-line bespoke diff-detect handler (`event-listener.ts:191-230`) deleted — investor-ctrl subscribes to `OPERATING_MODE_CHANGED` + `GOAL_UPDATED` directly.
- `compliance-ctrl` drops its `INVESTOR_PROFILE_UPDATED` subscription — it doesn't care about goal/email/risk changes.
- `cdc-envelope-omits-previous-subject` parking-lot item resolves naturally — `previousSubject` propagation is required by the diff-emit feature.

## 2. Why now

**Premise:** the bug we picked up was not a missing mutation. It was the system telling us that policy and intent were entangled in the wrong domain.

Verified during planning (2026-05-08):

- **Frontend never reads the 8 numeric guardrails.** `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts:49-50` reads `operatingMode` + `mandateLevel` only. `apps/investor-mfe/.../go-live-wizard.component.ts` references mandate i18n keys, no numeric thresholds. The numeric guardrails on the GraphQL `Mandate` type are dead UI surface — they exist purely as a system-internal denormalization.
- **`updateMandate` mutation has no UI consumer.** Confirmed by grep of `apps/`. Today it accepts raw guardrail values with no mode awareness — a drift vector that lets `operatingMode=CONSERVATIVE` coexist with `mandate.maxSingleTradePercent=20%`.
- **Half-built `setOperatingMode` repo method exists.** `services/investor/investor-bff/src/repositories/investor-profile.repository.ts:182` writes only `operatingMode`, no guardrail re-derivation, zero callers. Smoking gun: someone started this design and the collapse went the opposite direction.
- **`INVESTOR_PROFILE_UPDATED` carrier has 4 consumers, each interested in different sub-fields:**
  - `dashboard-bff` → reads `goal`, `riskProfile`, `operatingMode` (snapshot rebuild)
  - `investor-ctrl` → reads `goal`, `operatingMode` (notification diff)
  - `compliance-ctrl` → reads `mandate.*`, `operatingMode` (MandateSnapshot projection)
  - `decision-workflow-ctrl` → trigger only (any change → re-cycle)
  Three of them inspect-and-diff the payload to figure out what they care about. compliance-ctrl re-projects MandateSnapshot every time goal or email changes. This is mixed-domain payload smell.

The 2026-05-04 collapse's measured-by-event-count simplification (8 → 2) traded simpler topology for muddier semantics. This spec restores semantic clarity without re-introducing the 8-event sprawl: we land at 4 producer-side events with explicit roles.

## 3. Settled design decisions

### 3.1 (Q1) State shape — Mandate as sibling row

```
sk='InvestorProfile'  → tenantId, userId, email, goal, riskProfile,
                         accountMode, executionMode, operatingMode, mandateLevel
sk='Mandate'          → mandateId, level, status, effectiveDate, revokedAt
sk='Deposit#…' / 'Withdrawal#…' → unchanged
```

Note: `mandateLevel` (string enum: `ADVISORY` | `DISCRETIONARY`) is mirrored on the InvestorProfile row for read-side ergonomics — frontend wants `getProfile` to return it without a second Get/Query. This is a denormalization within the same aggregate root (one user), not across domains, so it doesn't have the same drift class as the guardrail denormalization. Source-of-truth is the Mandate row; investor-bff transforms (onboarding-completed, future updateMandateLevel) write both atomically via `transactWrite`.

The `MandateStatus` sibling row goes away. Its existence was a CDC-routing hack: `revoke-mandate.fn.js:7` notes "Targeting MandateStatus avoids spurious INVESTOR_PROFILE_UPDATED CDC". With the resplit, the Mandate row IS the lifecycle row — revoking writes there, CDC emits `MANDATE_REVOKED` directly.

### 3.2 (Q2) Policy locus — GUARDRAIL_TABLE in compliance-ctrl

```
services/advisory/compliance-ctrl/src/rules/guardrail-params.ts  ← NEW (moved)
services/investor/investor-bff/src/domain/guardrail-params.ts    ← DELETED
```

Compliance-ctrl's `RuleEngine.GuardrailEvaluator` calls `resolveGuardrailParams(snapshot.operatingMode)` at evaluation time. `MandateSnapshot` shape:

```ts
// libs/.../rule-engine.ts (today)
export interface MandateSnapshot {
  level: MandateLevel; status: 'ACTIVE' | 'REVOKED';
  monthlyTurnoverCapPercent: number; maxSingleTradePercent: number;
  equityRiskBandPercent: number; driftTriggerPercent: number;
  singleEtfConcentrationPercent: number; drawdownCircuitBreakerPercent: number;
  effectiveDate: string;
}

// after resplit
export interface MandateSnapshot {
  level: MandateLevel;
  status: 'ACTIVE' | 'REVOKED';
  operatingMode: OperatingMode;
  effectiveDate: string;
}
```

GuardrailEvaluator (today reads `snapshot.maxSingleTradePercent` etc. directly) is rewritten to:

```ts
const params = resolveGuardrailParams(snapshot.operatingMode);
if (proposed.singleTradePercent > params.maxSingleTradePercent) return BLOCKED;
// …
```

Investor-bff loses zero capability — it never enforced anything from the GUARDRAIL_TABLE; it only translated mode→numeric-fields for compliance to project from. That translation now happens inside compliance, where it always belonged.

### 3.3 (Q3) Event topology — 3 tiers

| Tier | Event | Fired when | Producer | Subscribers |
|---|---|---|---|---|
| **Carrier** | `INVESTOR_PROFILE_UPDATED` | Any field on InvestorProfile row mutated | investor-bff egress | dashboard-bff (snapshot rebuild), decision-workflow-ctrl (trigger) |
| **Carrier** | `INVESTOR_PROFILE_CREATED` | InvestorProfile row INSERT | investor-bff egress | dashboard-bff, decision-workflow-ctrl |
| **Semantic** | `OPERATING_MODE_CHANGED` | `operatingMode` field changed (modify) | investor-bff egress (via `onFieldChange`) | compliance-ctrl, investor-ctrl |
| **Semantic** | `GOAL_UPDATED` | `goal` sub-object changed (modify) | investor-bff egress (via `onFieldChange`) | investor-ctrl |
| **Lifecycle** | `MANDATE_ISSUED` | Mandate row INSERT | investor-bff egress | compliance-ctrl |
| **Lifecycle** | `MANDATE_REVOKED` | Mandate row modify with `status` → `REVOKED` | investor-bff egress | compliance-ctrl, investor-ctrl |

**Naming note.** `MANDATE_ACCEPTED` (today) is renamed to `MANDATE_ISSUED` to align with lifecycle semantics — "issued" is what the system does; "accepted" was a wizard-step name leaking into the event taxonomy. Per `feedback_no_deprecation.md` (dev sandbox disposable), no compatibility shim — clean rename across producer + adapter forwarding rules + consumer subscriptions in a single PR. Confirmed by user 2026-05-08.

**Carrier vs. semantic per consumer.** Decided per BFF-serves-MFE principle:
- `dashboard-bff` subscribes to **carrier**. The MFE asks for a snapshot; the BFF rebuilds it monomorphically from the full payload regardless of which field changed. Semantic events would force re-reads from DDB or fragile field-merge logic.
- `compliance-ctrl` subscribes to **semantic + lifecycle only** (`OPERATING_MODE_CHANGED` + `MANDATE_ISSUED` + `MANDATE_REVOKED`). Drops the `INVESTOR_PROFILE_CREATED/UPDATED` subscription — goal/email/risk changes don't affect compliance. Initial MandateSnapshot creation triggers on `MANDATE_ISSUED`, not on InvestorProfile insert.
- `investor-ctrl` subscribes to **semantic + lifecycle** (`OPERATING_MODE_CHANGED` + `GOAL_UPDATED` + `MANDATE_ISSUED` + `MANDATE_REVOKED`). Bespoke diff handler deleted.
- `decision-workflow-ctrl` subscribes to **carrier** (`INVESTOR_PROFILE_CREATED/UPDATED`). It uses these as triggers — any profile change re-cycles. Semantic events would be over-narrow.

### 3.4 (Q4) Producer-side diff — `onFieldChange` extension to declarative eventTypes

`libs/cdk-constructs/src/core/event-types.ts` today supports:

```ts
export type EventTypesMap = Record<EntityTypename, {
  insert?: EventName;
  modify?: EventName;
}>;
```

Extended to:

```ts
export type FieldPath = string;  // e.g. 'operatingMode', 'goal.objective'
export type ModifyEmission = EventName | {
  always?: EventName;
  onFieldChange?: Record<FieldPath, EventName>;
};
export type EventTypesMap = Record<EntityTypename, {
  insert?: EventName;
  modify?: ModifyEmission;
}>;
```

Investor-bff `service.stack.ts` declaration becomes:

```ts
eventTypes: {
  InvestorProfile: {
    insert: INVESTOR_PROFILE_CREATED,
    modify: {
      always: INVESTOR_PROFILE_UPDATED,
      onFieldChange: {
        operatingMode: OPERATING_MODE_CHANGED,
        goal: GOAL_UPDATED,
      },
    },
  },
  Mandate: {
    insert: MANDATE_ISSUED,
    modify: MANDATE_REVOKED,  // only one allowed transition: status → REVOKED
  },
  Deposit: { /* unchanged */ },
  Withdrawal: { /* unchanged */ },
},
```

The egress lambda's CDC pipeline (currently `libs/event-processor/src/pipelines/change-data-capture.ts`) is extended to:
1. Read NewImage and OldImage from the DDB Stream record (already does; OldImage is read but discarded today — see `unmarshal-stream.ts:19-22`).
2. Build the carrier event from NewImage as today.
3. For each `onFieldChange` entry, deep-equal-compare the field path between OldImage and NewImage. If changed, emit the semantic event with NewImage as subject AND OldImage as `previousSubject` (resolves `cdc-envelope-omits-previous-subject` parking-lot item).
4. Emit all events in a single `PutEvents` batch (carrier + semantic) — keeps producer atomicity.

**Field-path semantics:** dot-notation. `goal.objective` matches a change to that nested field. `goal` (no dot) matches any change inside the goal sub-object (deep-equal). Initial implementation supports top-level field names + one level of nesting; deeper paths added if needed.

**Consumer-side ordering:** EventBridge does not guarantee inter-event order. If a downstream consumer needs `OPERATING_MODE_CHANGED` to be processed before any subsequent `INVESTOR_PROFILE_UPDATED`, the consumer is responsible (idempotent handlers + last-write-wins by timestamp). For this workstream's consumers (compliance-ctrl, investor-ctrl): both are idempotent + state-keyed by tenant+user, so the existing patterns apply.

### 3.5 (Q5) Mutation surface

```graphql
# Today
type Mutation {
  updateGoal(input: GoalInput!): Goal!
  updateMandate(input: MandateInput!): Mandate!  # DELETE
  revokeMandate: MandateStatus!                   # retarget
  initiateDeposit(input: DepositInput!): Deposit!
  requestWithdrawal(input: WithdrawalInput!): WithdrawalRequest!
  requestAccountClosure: ClosureRequest!
  markNotificationRead(notificationId: ID!): Notification!
  updateFeatureFlag(...): FeatureFlag! @aws_iam
  publishDepositEvent(...): DepositEvent! @aws_iam
}

# After
type Mutation {
  updateGoal(input: GoalInput!): Goal!
  updateOperatingMode(mode: OperatingMode!): InvestorProfile!  # NEW
  revokeMandate: Mandate!                                       # retargeted return type
  initiateDeposit(input: DepositInput!): Deposit!
  requestWithdrawal(input: WithdrawalInput!): WithdrawalRequest!
  requestAccountClosure: ClosureRequest!
  markNotificationRead(notificationId: ID!): Notification!
  updateFeatureFlag(...): FeatureFlag! @aws_iam
  publishDepositEvent(...): DepositEvent! @aws_iam
}
```

**`type Mandate`** loses the 8 numeric guardrail fields:

```graphql
# Today (lines 105-118 of schema.graphql)
type Mandate {
  mandateId: ID!
  level: MandateLevel!
  status: MandateStatusValue!
  monthlyTurnoverCapPercent: Float!     # DROP
  maxSingleTradePercent: Float!          # DROP
  equityRiskBandPercent: Float!          # DROP
  driftTriggerPercent: Float!            # DROP
  singleEtfConcentrationPercent: Float!  # DROP
  drawdownCircuitBreakerPercent: Float!  # DROP
  rebalanceCadence: RebalanceCadence!    # DROP
  effectiveDate: String!
  revokedAt: String
}

# After
type Mandate {
  mandateId: ID!
  level: MandateLevel!
  status: MandateStatusValue!
  effectiveDate: String!
  revokedAt: String
}
```

**`type InvestorProfile`** unchanged in shape; `mandate: Mandate!` still resolves but reads from the sibling row in `get-profile.fn.js` (single AppSync pipeline resolver: Get InvestorProfile → Get Mandate → merge).

**`type MandateStatus`** removed entirely (no longer needed; revokeMandate returns the `Mandate` row directly).

`updateOperatingMode` JS resolver:

```js
// services/investor/investor-bff/src/graphql/js-function/update-operating-mode.fn.js
import { util } from '@aws-appsync/utils';
export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const mode = ctx.arguments.mode;
  if (!['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].includes(mode))
    util.error(`Invalid mode: ${mode}`, 'ValidationError');
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({
      pk: `InvestorProfile#${tenantId}#${userId}`,
      sk: 'InvestorProfile',
    }),
    update: {
      expression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :now',
      expressionNames: { '#ts': 'timestamp' },
      expressionValues: util.dynamodb.toMapValues({
        ':mode': mode,
        ':now': util.time.nowISO8601(),
      }),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;
}
```

No GUARDRAIL_TABLE in the JS resolver. No bridging across the TS/JS-sandbox boundary. The JS resolver only knows about user intent — policy is somewhere else's problem.

### 3.6 (Q6) revokeMandate retargeting

`revoke-mandate.fn.js` today writes to `sk='MandateStatus'`. After resplit:

```js
// retargeted
return {
  operation: 'UpdateItem',
  key: util.dynamodb.toMapValues({
    pk: `InvestorProfile#${tenantId}#${userId}`,
    sk: 'Mandate',
  }),
  update: {
    expression: 'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now',
    expressionNames: { '#status': 'status', '#ts': 'timestamp' },
    expressionValues: util.dynamodb.toMapValues({
      ':revoked': 'REVOKED', ':now': util.time.nowISO8601(),
    }),
  },
  condition: { expression: 'attribute_exists(pk) AND #status = :active',
                expressionNames: { '#status': 'status' },
                expressionValues: util.dynamodb.toMapValues({':active': 'ACTIVE'}) },
};
```

CDC fires `MANDATE_REVOKED` (not `INVESTOR_PROFILE_UPDATED`) — Mandate row is its own entity in the eventTypes map.

### 3.7 (Q7) Onboarding write fan-out

`onboarding-completed.ts` transform today does a 2-3-item `transactWrite`:
- Put InvestorProfile (composite, with mandate.* numeric guardrails)
- Put MandateStatus
- Put Deposit (conditional)

After resplit:
- Put InvestorProfile (lean — mandate.* numeric fields removed; mandateId + mandateLevel mirrored from the new Mandate row)
- Put Mandate (`{mandateId, level, status: 'ACTIVE', effectiveDate, revokedAt: null}`)
- Put Deposit (conditional)

CDC emits `INVESTOR_PROFILE_CREATED` + `MANDATE_ISSUED` + (conditional) `DEPOSIT_INITIATED`. compliance-ctrl picks up `MANDATE_ISSUED` and creates the initial MandateSnapshot. dashboard-bff picks up `INVESTOR_PROFILE_CREATED` and snapshots.

### 3.8 (Q8) Migration approach

Per `feedback_no_deprecation.md` + dev sandbox is disposable: **clean break, no dual-write, no shim, no compatibility flag**. Single PR/branch ships:
1. cdk-constructs `onFieldChange` extension (lib first; foundation).
2. investor-bff producer changes (state shape, transforms, schema, resolvers).
3. compliance-ctrl consumer changes (GUARDRAIL_TABLE, MandateSnapshot, subscriptions).
4. investor-ctrl + advisory-adpt + investor-adpt + decision-workflow-ctrl downstream alignment.
5. Test rewrites + doc updates.
6. Single deploy. E2E gate against deployed dev.

No data migration: dev sandbox redeploys are disposable. Existing onboarded users in dev get re-onboarded post-deploy or wiped (operator decision at deploy time).

## 4. Code surface (production)

### 4.1 libs/cdk-constructs

| File | Change |
|---|---|
| `src/core/event-types.ts` | Extend `EventTypesMap` with `ModifyEmission` discriminant supporting `{always, onFieldChange}`. |
| `src/core/egress.ts` | Wire diff-emit logic: read OldImage + NewImage, deep-equal field paths, emit semantic events alongside carrier in single PutEvents batch. |
| `libs/event-processor/src/pipelines/change-data-capture.ts` | Propagate `previousSubject` into envelope when emission is field-triggered. |
| `libs/event-processor/src/util/unmarshal-stream.ts` | Already reads OldImage; no change. |
| `test/core/event-types.test.ts` | Extend type-shape tests. |
| `test/core/egress.test.ts` | Add diff-emit cases: no-change → no semantic event; partial-change → only matched semantic events; full-change → all matched semantic events. |

### 4.2 services/investor/investor-bff

| File | Change |
|---|---|
| `src/schema.graphql` | Drop 8 numeric fields from `type Mandate`; drop `updateMandate` mutation; drop `type MandateStatus`; add `updateOperatingMode(mode: OperatingMode!): InvestorProfile!`; `revokeMandate: Mandate!`. |
| `src/graphql/js-function/update-mandate.fn.js` | DELETE. |
| `src/graphql/js-function/update-operating-mode.fn.js` | NEW (one-field UpdateItem). |
| `src/graphql/js-function/revoke-mandate.fn.js` | Retarget to `sk='Mandate'` row; add `status='ACTIVE'` condition. |
| `src/graphql/js-function/get-profile.fn.js` | Convert to a pipeline resolver: function 1 = Get `sk='InvestorProfile'`, function 2 = Get `sk='Mandate'`, response handler merges Mandate row into `result.mandate` of the profile. (Confirmed by user 2026-05-08 — Q2 of §8.) |
| `src/transforms/onboarding-completed.ts` | Drop `resolveGuardrailParams` import; drop guardrail-field expansion in InvestorProfile Put; replace MandateStatus Put with Mandate Put `{mandateId, level, status: 'ACTIVE', effectiveDate, revokedAt: null}`. |
| `src/repositories/investor-profile.repository.ts` | `setOperatingMode` becomes live. Remove `setMandateGuardrails` (or any direct field-set helpers used by deleted `updateMandate`). Add Mandate-row CRUD helpers; remove MandateStatus methods. |
| `src/domain/guardrail-params.ts` | DELETE (relocated). |
| `src/domain/models.ts` | Mandate type slimmed (remove 8 guardrail fields); Mandate becomes its own aggregate type. |
| `src/domain/events.ts` | Add `OPERATING_MODE_CHANGED`, `GOAL_UPDATED`, `MANDATE_ISSUED`. Remove `MANDATE_ACCEPTED` (renamed). |
| `src/service.stack.ts` | Use new `onFieldChange` declarative form on InvestorProfile; add Mandate entity to eventTypes map; remove MandateStatus. |
| `src/handlers/event-listener.ts` | No subscription change (still consumes USER_REGISTERED, etc.). Verify ONBOARDING_COMPLETED transform still wired. |

### 4.3 services/advisory/compliance-ctrl

| File | Change |
|---|---|
| `src/rules/guardrail-params.ts` | NEW — moved verbatim from investor-bff (8 guardrail fields × 3 modes). |
| `src/rules/rule-engine.ts` | `MandateSnapshot` shape: drop 8 numeric fields, add `operatingMode: OperatingMode`. |
| `src/rules/guardrail-evaluator.ts` | Derive thresholds via `resolveGuardrailParams(snapshot.operatingMode)` at evaluation time. |
| `src/rules/authority-resolver.ts` | If it reads guardrail fields — verify and rewrite. |
| `src/handlers/event-listener.ts` | Subscriptions: drop `INVESTOR_PROFILE_CREATED/UPDATED`. Add `MANDATE_ISSUED` (initial snapshot creation), `OPERATING_MODE_CHANGED` (re-derivation trigger). Keep `MANDATE_REVOKED`. processInvestorProfileEvent → processOperatingModeChange + processMandateIssued. |
| `src/repositories/compliance.repository.ts` | MandateSnapshot DDB shape. |
| `src/service.stack.ts` | Subscription list. |

### 4.4 services/investor/investor-ctrl

| File | Change |
|---|---|
| `src/handlers/event-listener.ts` | DELETE bespoke diff handler (lines 191-230). Add direct subscriptions to `OPERATING_MODE_CHANGED`, `GOAL_UPDATED`. Drop INVESTOR_PROFILE_UPDATED subscription. |
| `src/services/notification-lifecycle.service.ts` | Adapt event-type-keyed dispatch. |
| `src/service.stack.ts` | Subscription list. |

### 4.5 services/investor/dashboard-bff

| File | Change |
|---|---|
| `src/transforms/investor-snapshot.ts` | If reads `mandate.maxSingleTradePercent` etc., remove those reads. Keeps `INVESTOR_PROFILE_CREATED/UPDATED` subscription. |

### 4.6 cross-domain adapters + decision-workflow

| File | Change |
|---|---|
| `services/advisory/advisory-adpt/src/service.stack.ts` | Forward rules: add `OPERATING_MODE_CHANGED` + `MANDATE_ISSUED`; rename `MANDATE_ACCEPTED` → `MANDATE_ISSUED` if kept. |
| `services/advisory/advisory-adpt/src/domain/events.ts` | Event-name registry. |
| `services/investor/investor-adpt/src/domain/events.ts` | Existing `OPERATING_MODE_CHANGED` entry re-validates. |
| `services/advisory/decision-workflow-ctrl/src/domain/events.ts` | TRIGGER_EVENT_TYPES unchanged (carrier-based). |
| `services/advisory/decision-workflow-ctrl/src/service.stack.ts` | Verify subscriptions unchanged. |

## 5. Test surface (33 files)

### 5.1 Delete

- `services/investor/investor-bff/test/unit/domain/guardrail-params.test.ts` (moved to compliance-ctrl).
- `services/investor/investor-bff/test/unit/graphql/update-mandate.test.ts` (mutation gone).
- `apps/e2e-feature-tests/src/profile/update-mandate.e2e.test.ts` (mutation gone).

### 5.2 Add

- `services/advisory/compliance-ctrl/test/unit/rules/guardrail-params.test.ts` (moved).
- `services/investor/investor-bff/test/unit/graphql/update-operating-mode.test.ts` (new resolver).
- `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts` (end-to-end re-derivation: change mode, assert subsequent decision uses new thresholds).
- `libs/cdk-constructs/test/core/egress-on-field-change.test.ts` (new feature coverage).

### 5.3 Rewrite

**investor-bff:**
- `test/unit/transforms/onboarding-completed.test.ts` + `onboarding-completed-transform.test.ts` — assert Mandate row Put + InvestorProfile shape sans guardrails.
- `test/unit/repositories/investor-profile.repository.test.ts` — Mandate-row helpers; drop MandateStatus.
- `test/unit/graphql/revoke-mandate.test.ts` — assert UpdateItem on `sk='Mandate'`.
- `test/unit/graphql/get-profile.test.ts` — pipeline-resolver merge.
- `test/unit/handlers/event-listener.test.ts` — verify.
- `test/unit/transforms/user-registered.test.ts` — verify CDC commentary still accurate.
- `test/integration/investor-bff.integration.test.ts` — composite InvestorProfile + sibling Mandate row materialization, all AppSync mutations.

**compliance-ctrl:**
- `test/unit/event-listener.test.ts` — new subscription list, MANDATE_ISSUED handler.
- `test/unit/rule-engine.test.ts` — MandateSnapshot shape change.
- `test/unit/mandate-validator.test.ts` — uses new shape.
- `test/unit/guardrail-evaluator.test.ts` — eval-time threshold derivation.
- `test/unit/suitability-checker.test.ts` — uses new shape.
- `test/unit/authority-resolver.test.ts` — verify mode-aware behavior intact.
- `test/unit/compliance.repository.test.ts` — snapshot DDB shape.
- `test/integration/compliance-ctrl.integration.test.ts` — new event subscriptions, snapshot projection, rule engine.
- `test/integration/compliance-ctrl.resilience.integration.test.ts` — same.

**investor-ctrl:**
- `test/unit/event-listener.test.ts` — direct subscription dispatch (no diff).
- `test/unit/notification-lifecycle.service.test.ts` — direct event-type routing.
- `test/integration/onboarding-notification.integration.test.ts` — onboarding path through new event topology.

**dashboard-bff:**
- `test/unit/transforms/investor-snapshot.test.ts` — verify (likely no shape change).
- `test/unit/handlers/event-listener.test.ts` — verify subscription unchanged.
- `test/integration/dashboard-bff.integration.test.ts` — verify.

**advisory-adpt:**
- `test/unit/service.stack.test.ts` — forwarded event list.
- `test/integration/from-investor.integration.test.ts` — adapter forwarding new event types.

**decision-workflow-ctrl:**
- `test/unit/service.stack.test.ts` — verify subscriptions.
- `test/integration/decision-workflow-ctrl.integration.test.ts` — verify trigger paths.
- `test/integration/decision-workflow-ctrl.resilience.integration.test.ts` — verify.

**cdk-constructs:**
- `test/core/event-types.test.ts` — extended type shape.
- `test/core/egress.test.ts` — diff-emit cases.
- `test/core/ingress.test.ts` — verify (no change).

**E2E (apps/e2e-feature-tests):**
- `src/profile/revoke-mandate.e2e.test.ts` — assert MANDATE_REVOKED via Mandate row.
- `src/advisory/operating-mode-authority.e2e.test.ts` — verify path through OPERATING_MODE_CHANGED + new MandateSnapshot shape.
- `src/advisory/operating-mode-recommendation-shape.e2e.test.ts` — verify.
- `src/advisory/first-decision.e2e.test.ts` — likely unchanged.
- `src/helpers/fixtures.ts` — fixture builders for Mandate row + new event payloads.

## 6. Doc surface (28 files)

### 6.1 Architecture (canonical — must be updated atomically with code)

- `docs/architecture/SYSTEM-ARCHITECTURE.md` — event taxonomy section: add 3-tier model, list new events, deprecate old.
- `docs/architecture/SERVICE-INVENTORY.md` — investor-bff, compliance-ctrl, dashboard-bff, investor-ctrl, advisory-adpt, decision-workflow-ctrl, investor-adpt entries: event lists, subscription lists.

### 6.2 Data flows + flow specs

- `docs/data-flows/README.md` — event topology overview.
- `docs/data-flows/investor-onboarding.md` — onboarding write fan-out (new Mandate row).
- `docs/data-flows/advisory-cycle.md` — compliance gate (MandateSnapshot shape, GUARDRAIL_TABLE locality).
- `flows/investor-onboarding.flow.yaml` — flow spec: new event emissions.
- `flows/advisory-cycle.flow.yaml` — flow spec: compliance subscriptions.
- `flows/incident-escalation.flow.yaml` — flow spec: revoke path.

### 6.3 Per-service CLAUDE.md cards

- `services/investor/investor-bff/CLAUDE.md`
- `services/investor/investor-ctrl/CLAUDE.md`
- `services/investor/dashboard-bff/CLAUDE.md`
- `services/advisory/compliance-ctrl/CLAUDE.md`
- `services/advisory/advisory-adpt/CLAUDE.md`
- `services/advisory/decision-workflow-ctrl/CLAUDE.md`
- `services/investor/investor-adpt/CLAUDE.md`

### 6.4 Skills

- `.claude/skills/audit-domain/SKILL.md` — examples reference INVESTOR_PROFILE_UPDATED; update to reflect the new 3-tier topology (carrier + semantic + lifecycle) so future audits use this as a pattern, not the now-superseded carrier-only example. (Confirmed by user 2026-05-08 — Q3 of §8.)
- `.claude/skills/audit-e2e-test/SKILL.md` — same.

### 6.5 Backlog

- `docs/backlog/update-operating-mode-mutation-rederivation-gap.md` — closed as superseded (already done in this workstream's ACTIVE promotion).
- `docs/backlog/cdc-envelope-omits-previous-subject.md` — closed as folded-in (already done).

### 6.6 Memory (auto-memory)

- `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` — index entry update for `project_investor_profile_collapse.md` (description string reflects the resplit successor).
- `project_investor_profile_collapse.md` — extend with a "Resplit (2026-05-08)" successor section. Single dossier preserves workstream lineage; no split. (Confirmed by user 2026-05-08 — Q4 of §8.)
- `project_operating_mode.md` — update Phase 2 references.
- `project_event_wiring_gaps.md` — close out the relevant entry if any.

### 6.7 Historical specs/plans (mark superseded inline)

These do not need rewriting — add a top-of-doc "**Superseded by 2026-05-08-investor-profile-domain-resplit-design.md** for the parts noted below" note:
- `docs/superpowers/specs/2026-05-03-investor-profile-collapse-design.md` (partial — keeps the multi-row YAGNI removal; reverses the MandateStatus + carrier-only-event parts).
- `docs/superpowers/plans/2026-05-03-investor-profile-collapse-plan.md` (same).
- `docs/superpowers/specs/2026-05-03-investor-profile-collapse-deep-review.md` (same).
- `docs/superpowers/specs/2026-04-14-operating-mode-implementation-design.md` (event topology section partially superseded).
- `docs/superpowers/plans/2026-04-14-operating-mode-implementation.md` (same).
- `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md` (state-shape references).

## 7. Out of scope

- **Goal sub-aggregate split.** Goal stays nested on the InvestorProfile row. Same domain (investor intent), no policy translation, no cross-domain consumer reads sub-fields independently.
- **RiskProfile sub-aggregate split.** Same reasoning.
- **AccountMode / ExecutionMode lifecycle changes.** Stay as-is on InvestorProfile.
- **Mandate renewal / multi-active-mandate concurrency.** Out of scope. One-active-mandate-per-user model retained. Renewal would re-issue (`MANDATE_REVOKED` then `MANDATE_ISSUED`) within the same row.
- **Operating-mode Phase 2** (agent behavior changes, see `project_operating_mode.md`). Orthogonal — that work consumes the new `OPERATING_MODE_CHANGED` event but doesn't depend on this resplit shipping first.
- **Frontend UI changes for mandate display.** No UI exists for the 8 numeric guardrails; cleanup of GraphQL contract is internal-only.
- **Migration of staging or prod data.** Dev sandbox is disposable per `feedback_no_deprecation.md`. Staging/prod don't exist yet for this feature surface.
- **Performance benchmarking.** Onboarding gains one row in `transactWrite`, compliance loses ~6 numeric reads per snapshot — assumed cost-neutral; not measured.
- **RBAC / authority model changes.** `AuthorityResolver` continues to take MandateSnapshot + decision context as-is; only the snapshot's internal shape changes.
- **Real-money operating-mode changes.** Broker flows (broker-ctrl, broker-alpaca-adpt) don't subscribe to `mandate.*`; refactor remains compatible.
- **Generalising `onFieldChange` to N levels of nesting.** Initial implementation supports top-level + one-level nested paths (e.g. `goal.objective`). Deeper paths added on first concrete need.
- **Replacing GraphQL Mandate type with separate Authority + Guardrails types.** The `Mandate` type stays as the user-facing read shape; only its fields shrink. Frontend code change is zero (it never read the dropped fields).
- **Cross-language GUARDRAIL_TABLE codegen.** No need — the table now lives only in TS (compliance-ctrl); JS resolver doesn't reference it.
- **Re-introducing fine-grained per-field events for goal sub-fields.** `GOAL_UPDATED` fires on any goal sub-object change; consumers diff if they need precision. Avoided 8-event sprawl.

## 8. Resolved decisions (2026-05-08)

User confirmed all four recommendations on 2026-05-08:

1. **Q1 — Rename `MANDATE_ACCEPTED` → `MANDATE_ISSUED`.** Clean rename, no compat shim. Threaded through producer + adapter rules + consumers in a single PR. Reflected in §3.1, §3.3, §4.2 (events.ts), §4.6 (advisory-adpt forwarding rules).
2. **Q2 — `get-profile.fn.js` as pipeline resolver.** Two functions (Get InvestorProfile → Get Mandate) with merge in the response handler. Reflected in §3.5 and §4.2 (get-profile.fn.js entry).
3. **Q3 — Update `audit-domain` and `audit-e2e-test` skill examples.** They become canonical patterns for the new 3-tier topology. Reflected in §6.4.
4. **Q4 — Extend `project_investor_profile_collapse.md` with a "Resplit (2026-05-08)" section.** Single dossier preserves workstream lineage; no fresh `project_investor_profile_resplit.md`. Reflected in §6.6.

No remaining open questions blocking writing-plans.

## 9. Validation gate (for closing)

Workstream is shippable when:

1. `pnpm nx run-many -t test` GREEN across all 7 affected services + cdk-constructs lib.
2. `pnpm nx run-many -t test-integration --projects=investor-bff,compliance-ctrl,investor-ctrl,dashboard-bff,advisory-adpt,decision-workflow-ctrl` GREEN.
3. `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,compliance-ctrl,investor-ctrl,dashboard-bff,advisory-adpt,decision-workflow-ctrl,investor-adpt` deploys cleanly.
4. `pnpm nx run e2e-feature-tests:test-e2e-features` against deployed dev: all profile + advisory scenarios GREEN, including the new `update-operating-mode.e2e.test.ts` end-to-end re-derivation.
5. `pnpm nx run nestfolio-e2e:e2e` (Playwright UI) GREEN — onboarding + first-decision scenarios continue to work.
6. `node .claude/skills/backlog-lint/lint.mjs` GREEN — backlog state clean, MEMORY.md regenerated, BACKLOG.md regenerated.
7. Manual: `aws dynamodb scan --table-name dev-investor-bff-... --max-items 5` confirms Mandate row present + InvestorProfile row sans `mandate.*` numeric fields.
8. Manual: change a user's operatingMode via AppSync mutation, observe `OPERATING_MODE_CHANGED` event in CloudWatch, observe MandateSnapshot updated with new `operatingMode`, observe subsequent recommendation gated at new thresholds.

## 10. Risks

- **EventBridge inter-event ordering not guaranteed.** Consumer-side idempotency required; verified existing consumers are state-keyed + last-write-wins. Risk: low.
- **CDC envelope `previousSubject` adoption** could break existing consumers if they incidentally rely on the absence of the field. Verified zero consumers reference `previousSubject` today; new field is additive. Risk: very low.
- **GraphQL contract change** (drops 8 numeric fields from Mandate) is in principle breaking. Verified zero frontend code reads them. Risk: low; if surprises surface, fields can be re-added as deprecated for a deploy cycle.
- **`onFieldChange` deep-equal performance** on large nested objects. Mitigated: `goal` sub-object is small (~5 fields); diff-compare is O(fields). Risk: very low.
- **`MANDATE_ISSUED` rename** could miss a forwarding rule somewhere. Mitigated: full grep + tests. Risk: low.
- **Compliance re-projection misses** if `OPERATING_MODE_CHANGED` is not emitted (bug in `onFieldChange` diff). Mitigated: dedicated unit test for the diff-emit path; e2e test exercises end-to-end re-derivation. Risk: medium → low after tests in place.

## 11. Plan structure (writing-plans next)

Suggested phase ordering for plan-writing (out of scope for this spec, but informs the complexity estimate):

1. **Foundation (cdk-constructs)** — `onFieldChange` extension + tests. Independently shippable.
2. **Producer (investor-bff)** — state shape, transforms, schema, resolvers + tests.
3. **Policy relocation (compliance-ctrl)** — GUARDRAIL_TABLE move, MandateSnapshot shape, subscriptions + tests.
4. **Downstream alignment (investor-ctrl, advisory-adpt, decision-workflow-ctrl, dashboard-bff, investor-adpt)** — subscriptions + tests.
5. **E2E rewrites + doc updates + deploy + validation gate**.

Estimated 3-5 working days to ship safely with full test rewrites + doc updates. Single PR/branch, no feature flag, single deploy per the no-deprecation convention.
