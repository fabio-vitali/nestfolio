# Advisory in-flight state projection — design

**Backlog:** `advisory-empty-state-pending-decisions-count`
**Status:** ACTIVE
**Date:** 2026-05-09
**Type:** design

## 1. Problem

The advisory MFE renders a misleading empty state ("No pending decisions") when a decision is being computed by the agent pipeline. The bug surfaced 2026-05-02 during a Pattern B Step 9 e2e gate and was patched test-side via `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` Step 8 wait.

Investigation traced the issue to a system-level gap: the "Step Functions agent pipeline running" state lives only in SF execution state and is not projected into any BFF read model. Both `advisory-bff` (`services/advisory/advisory-bff/src/transforms/decision-packet-created.ts:19`) and `dashboard-bff` (`services/investor/dashboard-bff/src/transforms/advisory-status.ts:11`) increment their counters only on `DECISION_PACKET_CREATED`, which is emitted at the END of the 30–75s pipeline. During the pipeline window neither BFF can render "we're working on it."

The 30–75s lag described in the original ticket is a fixture artefact (`apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts:34` mutates dashboard-bff state via a backdoor without firing real events). In production both projections advance together at PACKET_CREATED — sub-second race only — but the deeper issue is real.

## 2. Principle

This design follows the [BFF state completeness principle](../../../memory/feedback_bff_state_completeness.md):

> Every meaningful system state must be represented in a BFF read model, delivered via GraphQL subscription, and survive a page refresh.

The "decision being computed" state is meaningful. It must be projected into the BFFs that serve the MFEs which need to render it (advisory-mfe, dashboard-mfe).

## 3. Approach

**Subscribe both BFFs to the 7 trigger events that already start the SF.** No new domain events needed — the trigger events are already federated to advisoryBus (and most of them to investorBus) and are the cleanest existing signal that a decision is in flight.

Trigger events (canonical list from `services/advisory/decision-workflow-ctrl/src/domain/events.ts:TRIGGER_EVENT_TYPES`):

1. `INVESTOR_PROFILE_CREATED`
2. `INVESTOR_PROFILE_UPDATED`
3. `PORTFOLIO_DRIFT_DETECTED`
4. `ORDER_FILLED`
5. `ORDER_REJECTED`
6. `ORDER_CANCELLED`
7. `DEPOSIT_DETECTED`

The decisionId does not yet exist when these fire — `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:331-333` mints it via `States.UUID()` inside the SF entry state. So advisory-bff cannot key a placeholder by decisionId; it stores a tenant-scoped counter aggregate (mirroring dashboard-bff's existing `AdvisoryStatus` pattern).

## 4. Architecture

```
                 ┌─────────────────────────────┐
                 │  Trigger event arrives on   │
                 │  advisoryBus + investorBus  │
                 │  (via existing adapters)    │
                 └──────────┬──────────────────┘
                            │ T+0
            ┌───────────────┼───────────────┬──────────────┐
            ▼               ▼               ▼              ▼
       advisory-bff   dashboard-bff   decision-       (existing
       (Ingress)      (Ingress)       workflow-ctrl    consumers)
            │               │           SF starts
            │               │
            ▼               ▼
       AdvisoryStatus  AdvisoryStatus
       inFlightCount += 1   pendingDecisionsCount += 1
            │               │
            ▼               ▼
       DDB stream     DDB stream
            │               │
            ▼               ▼
       AppSync mutation  AppSync mutation
       publishAdvisoryStatusUpdate  publishDashboardUpdate
            │               │
            ▼               ▼
       advisory-mfe   dashboard-mfe
       generating banner  alert bar
       (refresh-safe via  (refresh-safe via
        getAdvisoryStatus) getDashboard)
```

`T+30–75s` later, `DECISION_PACKET_CREATED` fires:
- advisory-bff: writes `DecisionReadModel` row + decrements `inFlightCount` (-1)
- dashboard-bff: nothing (counter already at +1 from trigger)

`Decision approved/blocked`:
- dashboard-bff: decrements `pendingDecisionsCount` (-1)
- advisory-bff: removes the row from "pending" view

## 5. Backend changes — Phase 1 (advisory-bff)

### 5.1 Ingress subscriptions

`services/advisory/advisory-bff/src/service.stack.ts:22-28` — extend `eventTypes:`

```ts
import { TRIGGER_EVENT_TYPES } from '@nestfolio/decision-workflow-ctrl/events';

eventTypes: [
  // existing 5
  DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
  DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
  ComplianceEventTypes.DECISION_APPROVED,
  ComplianceEventTypes.DECISION_BLOCKED,
  DecisionWorkflowEventTypes.USER_CONFIRMATION_REQUESTED,
  // new — mirrors decision-workflow-ctrl SF triggers
  ...TRIGGER_EVENT_TYPES,
],
```

The coupling to `TRIGGER_EVENT_TYPES` is single-sourced: if decision-workflow-ctrl changes its trigger list, advisory-bff follows automatically via the import.

### 5.2 New transform `transforms/decision-trigger-received.ts`

```ts
import { accumulate, update, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const decisionTriggerReceived = (
  uow: UnitOfWork<BusEvent<{ tenantId: string }>>,
): WriteIntent[] => {
  const { tenantId } = uow.event.context;
  const overrides = { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' };
  return [
    accumulate('AdvisoryStatus', { field: 'inFlightCount', increment: 1, overrides }),
    update('AdvisoryStatus', {
      lastTriggerAt: uow.event.timestamp,
      updatedAt: uow.event.timestamp,
    }, { overrides }),
  ];
};
```

`update`'s signature (verified at `libs/event-processor/src/intents/update.ts:3-12`) is `update(typename, updates, options?)` where `options` carries `overrides`, `condition`, `removes`, etc.

Register the transform for all 7 trigger events in `services/advisory/advisory-bff/src/handlers/event-listener.ts`.

### 5.3 Modify `transforms/decision-packet-created.ts`

Change return type from `WriteIntent | undefined` to `WriteIntent[] | undefined`. Append a counter decrement:

```ts
return [
  record('DecisionReadModel', { ...currentRow }, {
    pk: `Decision#${p.tenantId}#${p.decisionId}`,
    sk: 'DecisionReadModel',
  }),
  accumulate('AdvisoryStatus', {
    field: 'inFlightCount',
    increment: -1,
    overrides: { pk: `T#${p.tenantId}`, sk: 'AdvisoryStatus' },
  }),
];
```

The existing skip-empty-payload defence is preserved — when neither explanation nor proposedTrades is present, the transform returns `undefined` (no row written, no decrement). The orphaned +1 increment is then cleared by the client-side staleness clamp (§6.4) within 5 minutes.

### 5.4 Egress eventTypes

`services/advisory/advisory-bff/src/service.stack.ts:33-44` — add:

```ts
'AdvisoryStatus': {
  insert: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
  modify: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
},
```

Add `ADVISORY_STATUS_UPDATED` to `services/advisory/advisory-bff/src/domain/events.ts` `AdvisoryBffEventTypes`.

### 5.5 CDC publisher (`handlers/decision-publisher.ts`)

Add a second broadcast entry alongside `DecisionReadModel`:

```ts
const PUBLISH_ADVISORY_STATUS_UPDATE = `
  mutation PublishAdvisoryStatusUpdate(
    $tenantId: ID!
    $inFlightCount: Int!
    $lastTriggerAt: String
    $updatedAt: String!
  ) {
    publishAdvisoryStatusUpdate(
      tenantId: $tenantId
      inFlightCount: $inFlightCount
      lastTriggerAt: $lastTriggerAt
      updatedAt: $updatedAt
    ) {
      tenantId
      inFlightCount
      lastTriggerAt
      updatedAt
    }
  }
`;

broadcasts: {
  DecisionReadModel: { /* existing */ },
  AdvisoryStatus: {
    mutation: PUBLISH_ADVISORY_STATUS_UPDATE,
    whenChanged: ['inFlightCount', 'lastTriggerAt'],
    mapImage: (item) => ({
      tenantId: extractTenantFromPk(String(item.pk ?? '')),
      inFlightCount: Number(item.inFlightCount ?? 0),
      lastTriggerAt: typeof item.lastTriggerAt === 'string' ? item.lastTriggerAt : null,
      updatedAt: String(item.updatedAt ?? new Date().toISOString()),
    }),
  },
},
```

Helper: `extractTenantFromPk(pk: string): string` — strips `T#` prefix.

### 5.6 GraphQL schema additions

`services/advisory/advisory-bff/src/schema.graphql`:

```graphql
type AdvisoryStatus @aws_cognito_user_pools @aws_iam {
  tenantId: ID!
  inFlightCount: Int!
  lastTriggerAt: String
  updatedAt: String!
}

extend type Query {
  getAdvisoryStatus: AdvisoryStatus
}

extend type Mutation {
  publishAdvisoryStatusUpdate(
    tenantId: ID!
    inFlightCount: Int!
    lastTriggerAt: String
    updatedAt: String!
  ): AdvisoryStatus! @aws_iam
}

extend type Subscription {
  onAdvisoryStatusUpdate(tenantId: ID!): AdvisoryStatus
    @aws_subscribe(mutations: ["publishAdvisoryStatusUpdate"])
    @aws_cognito_user_pools
    @aws_iam
}
```

Subscription return type **nullable** per `services/advisory/advisory-bff/src/schema.graphql:30-38` (load-bearing — non-null modifier breaks AppSync subscription resolution).

Filter arg `tenantId` is present on the return type, mutation selection, and resolver response — satisfies the `feedback_appsync_subscribe_filter_args.md` invariant.

### 5.7 New JS resolvers

- `Query.getAdvisoryStatus.req.js` / `.res.js` — single-item Get on `pk=T#${ctx.identity.claims['custom:tenant_id']}, sk=AdvisoryStatus`. Returns `null` when absent. Cognito claim key is snake_case (`custom:tenant_id`).
- `Mutation.publishAdvisoryStatusUpdate.req.js` / `.res.js` — NONE data source; passes through args. Add `'publishAdvisoryStatusUpdate'` to `noneDataSource:` list at `service.stack.ts:52`.

## 6. Frontend changes — Phase 1 (advisory-mfe)

### 6.1 Component template state machine

`apps/advisory-mfe/src/app/decision-list/decision-list.component.ts:28-66` — replace four branches with five:

```html
@if (loading() && !loaded()) {
  <nf-loading-skeleton [count]="5" />
} @else if (error()) {
  <nf-empty-state ... errorTitle ... />
} @else if (decisions().length > 0) {
  <div class="decision-list">
    <h2>{{ i18n.t('advisory.list.title') }}</h2>
    @if (displayedInFlightCount() > 0) {
      <div class="generating-banner" data-testid="advisory-generating-banner">
        <span class="pi pi-spin pi-spinner"></span>
        {{ i18n.t('advisory.list.generatingMore', { count: displayedInFlightCount() }) }}
      </div>
    }
    <ul class="items">...</ul>
  </div>
} @else if (displayedInFlightCount() > 0) {
  <nf-empty-state
    icon="pi pi-spin pi-spinner"
    [title]="i18n.t('advisory.list.generatingTitle')"
    [message]="i18n.t('advisory.list.generatingHint')"
    data-testid="advisory-generating-state"
  />
} @else {
  <nf-empty-state
    icon="pi pi-chart-line"
    [title]="i18n.t('advisory.list.emptyTitle')"
    [message]="i18n.t('advisory.list.emptyHint')"
  />
}
```

(Verify `nf-empty-state` accepts `data-testid` and accepts a spinning icon class — adjust if needed.)

### 6.2 New signals

```ts
readonly inFlightCount = signal<number>(0);
readonly lastTriggerAt = signal<string | null>(null);

readonly displayedInFlightCount = computed(() => {
  const c = this.inFlightCount();
  if (c <= 0) return 0;
  const last = this.lastTriggerAt();
  if (!last) return 0;
  const ageMs = Date.now() - new Date(last).getTime();
  return ageMs < STALENESS_MS ? c : 0;
});

const STALENESS_MS = 5 * 60 * 1000;  // 5 min — covers 30-75s pipeline + buffer
```

### 6.3 `advisory.service.ts` additions

```ts
async getAdvisoryStatus(): Promise<AdvisoryStatusSnapshot | null>
subscribeToAdvisoryStatusUpdates(tenantId: string, onFrame: (s: AdvisoryStatusSnapshot) => void): void
unsubscribeFromAdvisoryStatusUpdates(): void
```

### 6.4 `ngOnInit` changes

Subscribe to BOTH `onDecisionListUpdate` and `onAdvisoryStatusUpdate` BEFORE running queries (R1 pattern, matches existing comment at `decision-list.component.ts:152-156`). Run `getPendingDecisions` + `getAdvisoryStatus` via `Promise.all`.

### 6.5 i18n keys

Add to `libs/shell/src/i18n/assets/en-GB.json` + `it-IT.json` under `advisory.list`:

```json
"generatingTitle": "Agent is generating recommendations…"
"generatingHint":  "This usually takes 30 to 75 seconds. The list will refresh automatically."
"generatingMore":  "Generating {count} additional recommendation(s)…"
```

## 7. Backend changes — Phase 2 (dashboard-bff + investor-adpt)

### 7.1 investor-adpt: forward PORTFOLIO_DRIFT_DETECTED

`services/investor/investor-adpt/src/service.stack.ts:95-101` — add to `fromLedgerEvents`:

```ts
const fromLedgerEvents = [
  InvestorIngestEventTypes.BALANCE_UPDATED,
  InvestorIngestEventTypes.PORTFOLIO_UPDATED,
  InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
  InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
  InvestorIngestEventTypes.LEDGER_PROCESSING_FAILED,
  InvestorIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,  // new
];
```

Add `PORTFOLIO_DRIFT_DETECTED` to `services/investor/investor-adpt/src/domain/events.ts` `InvestorIngestEventTypes`.

### 7.2 dashboard-bff: extend ingress subscriptions

`services/investor/dashboard-bff/src/service.stack.ts:27-43` — add 4 events:

```ts
InvestorIngestEventTypes.ORDER_FILLED,
InvestorIngestEventTypes.ORDER_REJECTED,
InvestorIngestEventTypes.ORDER_CANCELLED,
InvestorIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
```

(`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `DEPOSIT_DETECTED` are already present.)

### 7.3 dashboard-bff: rewrite `transforms/advisory-status.ts`

Current logic (`services/investor/dashboard-bff/src/transforms/advisory-status.ts:11-32`):

```
DECISION_PACKET_CREATED  → +1
USER_CONFIRMATION_REQUESTED  → +1   (pre-existing double-count bug)
DECISION_APPROVED  → -1
DECISION_BLOCKED   → -1
```

New logic:

```
INVESTOR_PROFILE_CREATED   → +1
INVESTOR_PROFILE_UPDATED   → +1
PORTFOLIO_DRIFT_DETECTED   → +1
ORDER_FILLED               → +1
ORDER_REJECTED             → +1
ORDER_CANCELLED            → +1
DEPOSIT_DETECTED           → +1
DECISION_APPROVED          → -1
DECISION_BLOCKED           → -1
```

Field name `pendingDecisionsCount` is preserved (no schema change). Semantics shift from "decisions awaiting user review" to "any in-progress decision (in-flight or awaiting review)." This is a positive side-effect — closes the pre-existing USER_CONFIRMATION_REQUESTED double-count.

The `lastRecommendationAt` and `lastDecisionStatus` fields keep their current update logic (still set on PACKET_CREATED / APPROVED / BLOCKED). They remain "last decision status" semantics.

### 7.4 dashboard-mfe — no code change

`apps/dashboard-mfe/src/app/dashboard/advisory-alert-bar.component.ts` already shows when `pendingDecisionsCount > 0`. The semantic shift is invisible at the component level. The user simply sees the alert appear earlier (at trigger time) and disappear at APPROVED/BLOCKED.

Optional: update i18n string `advisory.pendingDecisions` to a label that reads naturally for both phases ("Pending advisory decisions" works as-is). No-op at the code level — included in the spec only for documentation.

## 8. Edge cases

| # | Scenario | Outcome | Mitigation |
|---|----------|---------|------------|
| E1 | `DECISION_PACKET_CREATED` arrives before trigger transform processes | advisory-bff: counter briefly -1; trigger arrives → 0. Row is in list anyway (PACKET wrote it). | None needed — banner just doesn't show |
| E2 | SF fails to start after trigger arrives | advisory-bff: counter stuck at +1. dashboard-bff: same. | Client-side `lastTriggerAt` staleness clamp (5 min) for advisory. dashboard: counter rebalances on next decision. SF 72h timeout bounds the worst case. |
| E3 | Trigger event delivered twice (SQS at-least-once) | Both counters +2, only -1 from PACKET → ends at +1 | Drift accepted; rebalances on next decision. Optional `seenTriggerEventIds` set is out of scope. |
| E4 | Multiple decisions simultaneously | Counters accumulate correctly | Banner shows N — designed for it |
| E5 | Existing decision N pending, decision N+1 starts | List shows N row + inline banner "+1 generating" | Designed-for branch |
| E6 | Cross-domain trigger latency (DEPOSIT_DETECTED via execution-adpt) | Adapter adds ~100ms; PACKET is 30-75s later anyway | No realistic race |
| E7 | Defence-in-depth skip on empty PACKET payload | `decision-packet-created.ts` returns undefined; counter NOT decremented | Counter cleared by client-side staleness clamp within 5 min. Covered by E2. |
| E8 | Onboarding flow triggers INVESTOR_PROFILE_CREATED → SF starts → counter +1 | User is on `/onboarding`, not `/advisory` — banner invisible | Acceptable. After onboarding, banner shows correctly if user navigates to /advisory. |

## 9. Test plan

### 9.1 Unit tests

- New: `services/advisory/advisory-bff/test/unit/transforms/decision-trigger-received.test.ts` — 7 cases (one per trigger event), unknown event returns undefined, returns array of 2 intents per trigger
- Modified: `services/advisory/advisory-bff/test/unit/transforms/decision-packet-created.test.ts` — assert returns `[record, accumulate(-1)]`; skip-empty-payload preserved
- Modified: `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts` — `AdvisoryStatus` insert/modify fires `PUBLISH_ADVISORY_STATUS_UPDATE` with correct mapped image
- Modified: `services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts` — 7 trigger events each +1; APPROVED/BLOCKED -1; PACKET_CREATED + USER_CONFIRMATION_REQUESTED no longer increment

### 9.2 Integration tests

`services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`:
- Emit DEPOSIT_DETECTED → poll → `AdvisoryStatus` row `inFlightCount=1`
- Emit DEPOSIT_DETECTED then DECISION_PACKET_CREATED → counter back to 0, `DecisionReadModel` row exists
- Emit two triggers, one PACKET → counter=1
- Subscribe to `onAdvisoryStatusUpdate` → emit trigger → frame received with `inFlightCount=1`

`services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`:
- Emit DEPOSIT_DETECTED → poll → `AdvisoryStatus` row `pendingDecisionsCount=1`
- Emit DEPOSIT_DETECTED then DECISION_APPROVED → counter back to 0
- Existing scenarios assert PACKET_CREATED no longer increments

`services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts`:
- Emit PORTFOLIO_DRIFT_DETECTED on ledgerBus → assert it appears on investorBus

### 9.3 E2E tests

Replace `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts` backdoor with a **real** EventBridge trigger event injection (e.g., emit DEPOSIT_DETECTED on advisoryBus + investorBus via the existing test EB client). The fixture becomes a thin trigger-emitter rather than a state-mutation backdoor.

Update `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` — optionally add an early-exit check on `getAdvisoryStatus.inFlightCount > 0` (banner appears) before the existing `getPendingDecisions` poll. Out of scope: removing the wait entirely.

New Playwright scenario in `apps/nestfolio-e2e/`:
- Trigger a decision (e.g., deposit)
- Navigate to `/advisory` immediately (within 2s of trigger)
- Assert `[data-testid=advisory-generating-state]` is visible
- Wait for PACKET_CREATED
- Assert `[data-testid=advisory-decision-list]` replaces the generating state
- Assert dashboard alert bar appears at trigger time (Phase 2 verification)

### 9.4 Flow specs

Files in `flows/*.flow.yaml` referencing advisory-bff or dashboard-bff projection should add:
- The new ingress subscriptions
- `publishAdvisoryStatusUpdate` mutation
- `onAdvisoryStatusUpdate` subscription

Run `validate-flow` skill against affected flow specs.

## 10. Out of scope

1. Idempotent trigger counting via `seenTriggerEventIds` set. Drift accepted; rebalances on next decision.
2. Server-side TTL or scheduled job to reset stuck counters. Phase 1 = client-side staleness clamp; Phase 2 = rebalance-on-next-decision.
3. Adding `lastDecisionStatus`, `lastRecommendationAt` etc. to advisory-bff's `AdvisoryStatus` (mirror dashboard-bff fully). Phase 1 ships only `inFlightCount` + `lastTriggerAt`.
4. Removing `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` Step 8 wait — separate cleanup PR after the in-flight UX is verified in production.
5. Onboarding flow optimization — INVESTOR_PROFILE_CREATED triggers SF and increments counter; user is on `/onboarding` so banner is invisible. Acceptable.
6. dashboard-mfe i18n update — `advisory.pendingDecisions` label already reads naturally for both semantics.
7. New events / changes to `DecisionWorkflowEventTypes`. The Option F path (emit `DECISION_PROCESSING_STARTED` from SF entry) was rejected in favour of subscribing to existing trigger events.

## 11. Validation gate

- `pnpm nx test advisory-bff dashboard-bff investor-adpt` (unit) — pass
- `pnpm nx run-many -t test-integration -p advisory-bff,dashboard-bff,investor-adpt` — pass
- `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff,dashboard-bff,investor-adpt` — succeeds
- `pnpm nx run e2e-feature-tests:test-e2e-features` (NESTFOLIO_INTEG_PREFIX=dev) — green incl. fixture rewrite
- `pnpm nx run nestfolio-e2e:e2e` — green incl. new "generating state on /advisory" scenario, dashboard-alert-at-trigger-time scenario
- Manual dev smoke: trigger decision via `/advisory` action → land on `/advisory` within 2s → observe generating empty-state → observe transition to row when PACKET fires → dashboard alert appears at trigger time
- `node .claude/skills/backlog-lint/lint.mjs --fix` clean after status flip to shipped

## 12. Open questions

None — all three pre-spec verifications resolved during design (see section 7.1, 7.2 deltas grounded in code).
