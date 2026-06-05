# WS-4 — Dashboard generating + failed decision-cycle reflection

**Date:** 2026-06-05
**Backlog:** `dashboard-generating-failed-reflection`
**Umbrella:** `docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md` (§6 + §7.3 test 2)
**Type:** feature (cross-service: advisory-bff + dashboard-bff + dashboard-mfe + e2e)
**Status:** design — awaiting review

---

## 1. Problem & context

The `advisory-generating-failed-ux` mini-program gave `/advisory` a correct signal
for the two missing decision-cycle states — **generating** (a cycle is running, no
decision yet) and **failed** (a cycle ended without producing a decision) — via a
version-guarded status on the `DecisionReadModel` row (WS-1 emits
`DECISION_CYCLE_STARTED`/`FAILED`; WS-2 projects `GENERATING`/`FAILED`; WS-3 renders
the spinner/error UI on `/advisory`).

The **dashboard shows none of this.** Its only advisory signal is the
`advisory-alert-bar`, which means *"N decisions ready to review"* and renders only
when `pendingDecisionsCount > 0`. That count is recomputed from
`IN_FLIGHT_STATUSES = ['PENDING', 'AWAITING_CONFIRMATION']`
(`advisory.repository.ts:105`), which deliberately **excludes** `GENERATING` and
`FAILED`. So during a ~30–60 s generation the dashboard is silent, and on failure it
stays silent — the user gets no feedback on `/dashboard` while `/advisory` shows a
spinner then an error. WS-4 closes that gap so feedback is **consistent across both
surfaces.**

The pre-WS3 second e2e test (`advisory-generating-state.spec.ts`, currently
`test.skip` "dashboard alert bar appears…") encodes the removed accumulate model
(`DEPOSIT_DETECTED` → increment). WS-4 retargets it to the reachable path.

---

## 2. Decisions (resolved 2026-06-05)

Two sub-design decisions, both resolved via AskUserQuestion:

1. **Dashboard UX → distinct indicator.** A separate, self-contained
   advisory-cycle-status banner (generating spinner / failed error). The
   `advisory-alert-bar` is **unchanged** — each surface element keeps one semantic
   meaning (in-progress vs. failed vs. ready-to-review). This mirrors the `/advisory`
   spinner+error split and is a liftable "async-operation status banner" pattern.
2. **Signal path → extend `ADVISORY_STATUS_UPDATED`.** advisory-bff's existing
   post-commit recompute also derives the generating/failed signal from
   `DecisionReadModel` rows and writes it on the **same** `AdvisoryStatus` aggregate
   row (recompute, not accumulate; atomic `__version`). dashboard-bff projects the
   new fields onto its P3 row. Reuses the existing carrier + `onDashboardUpdate`
   subscription + `investor-adpt` forwarding — **no new event, subscription, or
   adapter rule.** This is the canonical read-model-ownership "extend the
   authoritative aggregate" pattern.

```
DecisionReadModel row mutation (GENERATING / FAILED / PENDING / packet)
        │ CDC → DDB stream
        ▼
advisory-bff advisory-status-projector  (recompute, atomic ADD #__version :1)
   writes AdvisoryStatus row:
     pendingDecisionsCount  (existing — PENDING/AWAITING_CONFIRMATION COUNT)
     generatingCount        (NEW — # of GENERATING rows)
     failedCount            (NEW — # of FAILED rows)
     oldestGeneratingAt     (NEW — min createdAt of GENERATING rows, or null)
        │ CDC → ADVISORY_STATUS_UPDATED (whole row = subject)
        │ advisory-bus → investor-adpt → investor-bus (unchanged forwarding)
        ▼
dashboard-bff advisory-status.ts  (projectVersioned, version-guarded on __version)
   → AdvisoryStatus P3 row → getDashboard / onDashboardUpdate
        ▼
dashboard-mfe advisory-cycle-status component (distinct banner) + client staleness tick
```

---

## 3. advisory-bff changes (producer aggregate)

### 3.1 Repository — `src/repositories/advisory.repository.ts`
Add a derivation method alongside `countInFlightDecisions` (leave that one as-is):

```ts
/** Cycle-lifecycle signals for the AdvisoryStatus aggregate. Queries this tenant's
 *  GENERATING/FAILED DecisionReadModel rows (status + createdAt only), paginating. */
readonly deriveCycleSignals = this.log('deriveCycleSignals', async (
  tenantId: string,
): Promise<{ generatingCount: number; failedCount: number; oldestGeneratingAt: string | null }> => {
  // tenantId-index Query, KeyCondition tenantId + __typename='DecisionReadModel',
  // FilterExpression #status IN ('GENERATING','FAILED'),
  // ProjectionExpression '#status, createdAt', paginated over LastEvaluatedKey.
  // Tally generatingCount / failedCount; oldestGeneratingAt = min(createdAt) over GENERATING.
});
```

The GENERATING/FAILED row cardinality per tenant is tiny (≤ a handful), so loading
their `status`+`createdAt` is cheaper than three separate `Select: COUNT` passes.

### 3.2 Projector — `src/handlers/advisory-status-projector.ts`
In the per-tenant recompute loop, call `deriveCycleSignals(tenantId)` alongside
`countInFlightDecisions(tenantId)` and write all four fields in the existing
`update('AdvisoryStatus', …, { add: { __version: 1 } })`:

```ts
const inFlightCount = await repo.countInFlightDecisions(tenantId);
const { generatingCount, failedCount, oldestGeneratingAt } = await repo.deriveCycleSignals(tenantId);
await executor.execute(
  update('AdvisoryStatus',
    { tenantId, inFlightCount, generatingCount, failedCount, oldestGeneratingAt },
    { add: { __version: 1 }, overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' } }),
  ctx,
);
```

The atomic-version + loop-guard reasoning in the projector's header comment is
unchanged and still applies (the new fields ride the same row write).

### 3.3 No event/Egress change
`AdvisoryStatus` already maps `insert|modify → ADVISORY_STATUS_UPDATED`
(`service.stack.ts:44`). CDC serialises the whole row, so the three new fields appear
in the `ADVISORY_STATUS_UPDATED` subject with no Egress edit. `investor-adpt`
forwards the event verbatim — unchanged.

---

## 4. dashboard-bff changes (consumer projection + GraphQL)

### 4.1 Transform — `src/transforms/advisory-status.ts`
Read the three new subject fields and project them onto the P3 `AdvisoryStatus` row
(still `projectVersioned`, version-guarded on `__version`):

```ts
const p = uow.event.subject; // { tenantId, inFlightCount, generatingCount, failedCount, oldestGeneratingAt, __version }
if (typeof p.__version !== 'number') return undefined;
return projectVersioned('AdvisoryStatus', {
  pendingDecisionsCount: p.inFlightCount,
  generatingCount: p.generatingCount ?? 0,
  failedCount: p.failedCount ?? 0,
  oldestGeneratingAt: p.oldestGeneratingAt ?? null,
}, { version: p.__version, overrides: { pk: `T#${p.tenantId}`, sk: 'AdvisoryStatus' } });
```

`?? 0` / `?? null` defends against an in-flight `ADVISORY_STATUS_UPDATED` emitted by
a not-yet-redeployed advisory-bff that omits the fields. Read-model ownership stays
P3 (same typename, same intent — only new fields).

### 4.2 GraphQL — `src/schema.graphql`
Add to **both** `type AdvisoryStatus` and `input AdvisoryStatusInput`:

```graphql
generatingCount: Int!
failedCount: Int!
oldestGeneratingAt: String
```

### 4.3 Resolvers + broadcaster (silent-drop rule)
The three fields MUST appear on the return type **and** the resolver response **and**
the publisher's mutation selection, or AppSync drops the broadcast
(`feedback_appsync_subscribe_filter_args`):
- `getDashboard` JS resolver: include the new fields when mapping the `AdvisoryStatus`
  row → response.
- `publishDashboardUpdate` JS resolver: pass the new `advisoryStatus` input fields
  through to the response.
- `dashboard-publisher.ts`: add the three fields to the `advisoryStatus` selection of
  the `publishDashboardUpdate` mutation it fires on `AdvisoryStatus` row mutation.

---

## 5. dashboard-mfe changes (distinct indicator + staleness)

### 5.1 Query fragment — `src/app/graphql/dashboard-bff.queries.ts`
Add `generatingCount`, `failedCount`, `oldestGeneratingAt` to
`AdvisoryStatusFields` (covers `GET_DASHBOARD` and `ON_DASHBOARD_UPDATE`).

### 5.2 Store — `src/app/stores/dashboard.store.ts` (owns the derivation)
- Extend the `AdvisoryStatus` interface with the three fields.
- Add a `now` state field + `setNow(ts: number)` method (driven by an interval in the
  container; settable directly in tests).
- Add computed signals `advisoryGenerating` / `advisoryFailed`, mirroring
  `decision-list.component.ts:184-208`:
  - `generatingFresh` = `generatingCount > 0` AND `oldestGeneratingAt` within
    `STALE_CYCLE_MS` of `now()`.
  - `advisoryGenerating` = `generatingFresh`.
  - `advisoryFailed` = `pendingDecisionsCount === 0` AND `!generatingFresh` AND
    (`failedCount > 0` OR (`generatingCount > 0` AND stale)).
- `hasAdvisoryAlerts` (alert bar) is unchanged (`pendingDecisionsCount > 0`).

The store is the single source of the derivation (not the component), because it
already holds `advisoryStatus` and the `now` tick — keeping the new component purely
presentational and trivially unit-testable.

### 5.3 New component — `src/app/dashboard/advisory-cycle-status.component.ts`
Purely presentational — `@Input() generating: boolean` and `@Input() failed: boolean`
(no derivation in the component):
- generating → `data-testid="dashboard-advisory-generating"` (spinner + title).
- failed → `data-testid="dashboard-advisory-failed"` (warning + retry hint).
- renders nothing when both are false.

`dashboard-container.component.ts` renders it near the KPI row (per the approved
mockup), above the main content, binding
`[generating]="store.advisoryGenerating()"` / `[failed]="store.advisoryFailed()"`.
The container owns a `setInterval` ticking `store.setNow(Date.now())` (period ≤
`STALE_CYCLE_MS`, e.g. the advisory-mfe's 30 s), cleaned up in the existing
`ngOnDestroy`.

### 5.4 Staleness constant (parity, no WS-3 scope creep)
Duplicate `STALE_CYCLE_MS = 6 * 60 * 1000` in dashboard-mfe with a
`// keep in sync with advisory-mfe decision-list.component.ts` note. A **parking
item** is filed to later extract a shared `deriveAdvisoryCycleState` + `STALE_CYCLE_MS`
into `@nestfolio/ui` (rule-of-three: advisory-mfe + dashboard-mfe) — out of scope
here to avoid touching shipped WS-3 code.

### 5.5 i18n
Add `dashboard.advisory.generatingTitle` and `dashboard.advisory.failedTitle` /
`dashboard.advisory.failedHint` (reuse the wording from `advisory.list.generating*`
/ `advisory.list.failed*`).

---

## 6. e2e retarget — `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts`

Replace `injectDashboardBffTriggerEvent` (the dead `DEPOSIT_DETECTED` injector) in
`inject-advisory-update.ts` with:

```ts
injectAdvisoryStatusUpdated(ctx, tenant, {
  pendingDecisionsCount?, generatingCount?, failedCount?, oldestGeneratingAt?, __version,
}): Promise<{ eventId }>
```

— emits `ADVISORY_STATUS_UPDATED` on the **investor** bus, source
`integration-test:dashboard-bff`, subject
`{ tenantId, inFlightCount, generatingCount, failedCount, oldestGeneratingAt, __version }`
(maps `pendingDecisionsCount` arg → `inFlightCount` subject field, matching the
transform). This injects the dashboard-bff projection input directly, exercising the
dashboard projection + render path (not advisory-bff's recompute — that is advisory-bff's
own unit/integration concern).

Unskip the third test and cover, UI-only on `onboardedPage.goto('/dashboard')`:
1. `{ generatingCount: 1, oldestGeneratingAt: <now>, __version: 1 }` →
   `dashboard-advisory-generating` visible.
2. `{ failedCount: 1, generatingCount: 0, pendingDecisionsCount: 0, __version: 2 }`
   (same tenant, higher `__version`) → `dashboard-advisory-failed` visible,
   `dashboard-advisory-generating` hidden.
3. `{ pendingDecisionsCount: 2, __version: 3 }` → `advisory-alert-bar` visible (the
   original reachable path the skipped test was written for).

Per the e2e charter: UI assertions only, delivered live via `onDashboardUpdate`.
Each `__version` strictly increases so the dashboard-bff version guard accepts each
injection in order.

---

## 7. Testing

### 7.1 advisory-bff unit
- `deriveCycleSignals`: GENERATING rows → `generatingCount` + `oldestGeneratingAt` =
  earliest; FAILED rows → `failedCount`; no cycle rows → `{0, 0, null}`.
- projector recompute: writes the four fields with the atomic `__version` increment.

### 7.2 dashboard-bff
- `advisory-status.ts` transform unit: maps the new subject fields; `?? 0`/`?? null`
  defaults when absent; drops when `__version` absent.
- read-model ownership type-test stays green (P3, no ownership change).
- integration: an injected `ADVISORY_STATUS_UPDATED` with the new fields materialises
  them on the row and broadcasts them.

### 7.3 dashboard-mfe component unit
- `generatingCount>0` fresh → generating banner; `failedCount>0` & no pending/generating
  → failed banner; stale GENERATING (`now` past ceiling) → failed banner; neither →
  nothing; alert bar unaffected.

### 7.4 e2e — §6 (2× consecutive green per the anti-flake charter).

---

## 8. Validation gate
- `nx affected -t test,lint --base=origin/main` green.
- Deploy `advisory-bff`, `dashboard-bff`, and `investor-web` (dashboard-mfe) to dev.
- Scoped Playwright `advisory-generating-state` vs deployed dev, 2× consecutive:
  generating + failed indicators render on `/dashboard`; alert bar renders on the
  `pendingDecisionsCount` path.

---

## 9. Out of scope
- The `/advisory` surface (WS-3, shipped) — WS-4 is dashboard-only.
- DWC cycle-event emission (WS-1) and advisory-bff `DecisionReadModel` projection
  (WS-2) — WS-4 consumes existing signals, does not change them.
- Post-packet failure surfacing (BLOCKED/REJECTED are existing decision statuses).
- Extracting the shared `deriveAdvisoryCycleState` + `STALE_CYCLE_MS` helper into
  `@nestfolio/ui` (filed as a parking item; rule-of-three not yet pressing).
- Migrating `inject-advisory-update.ts` off the direct `@aws-sdk/client-eventbridge`
  import (tracked: `nestfolio-e2e-eventbridge-client-wrapper-migration`).
- Real full agent-pipeline e2e (use injected events for determinism + cost).

## 10. Risks / known limitations
- **Stale FAILED indicator (parity with WS-3, not introduced here).** A lone old
  `FAILED` row with no pending/generating keeps the failed banner shown until the next
  cycle — identical behaviour on `/advisory` today. A future "dismiss/age-out failed
  state" improvement would address both surfaces; out of scope.
- **`failedCount` recompute is a count of current FAILED rows**, not a delta — safe
  under at-least-once/out-of-order delivery (pure function of rows + atomic
  `__version`), same guarantee as `pendingDecisionsCount`.
- **Field-absence during rollout.** An `ADVISORY_STATUS_UPDATED` from a not-yet-redeployed
  advisory-bff omits the new fields; the transform `?? 0`/`?? null` defaults keep the
  dashboard correct (no generating/failed shown) until advisory-bff redeploys. Deploy
  advisory-bff and dashboard-bff together.
- **Staleness divergence avoided.** Both surfaces apply the same `STALE_CYCLE_MS`
  ceiling client-side, so a stuck (uncatchable `States.Runtime`) cycle resolves to the
  failed state consistently on `/dashboard` and `/advisory`.
