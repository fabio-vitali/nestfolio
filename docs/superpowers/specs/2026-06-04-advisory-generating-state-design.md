# Advisory "generating" + "failed" decision-cycle UX

**Date:** 2026-06-04
**Backlog:** `advisory-generating-state-e2e-accumulate-model-stale`
**Type:** feature (cross-service, advisory domain)
**Status:** design — awaiting review

---

## 1. Problem & context

`apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts` encodes the
**removed pre-workstream-3 accumulate model**: it injects `DEPOSIT_DETECTED`
expecting advisory-bff / dashboard-bff to *increment* an in-flight counter. That
path is gone, so both tests are dead.

Investigation revealed the deeper issue: the advisory **"generating" UX is itself
non-functional** post-WS3.

- The only gate for both generating UI states (`decision-list.component.ts:39`
  banner, `:66` empty-state) is `displayedInFlightCount()`, which returns 0 unless
  `lastTriggerAt` is set and fresh — but **`lastTriggerAt` is never persisted**
  (the recompute projector writes only `{tenantId, inFlightCount}`).
- `inFlightCount` = `COUNT(DecisionReadModel rows in PENDING/AWAITING_CONFIRMATION)`,
  so it is structurally 0 during generation (no row exists yet).
- The DecisionPacket row is created at **SF step 7 (AssemblePacket), after the
  ~30–60 s agent pipeline** (`decision-state-machine.ts` steps 5–6). So during the
  whole generation window there is no row and **no signal at all** reaches
  advisory-bff. A user on `/advisory` sees "no advice yet" for up to a minute,
  then a decision appears unannounced; if the cycle fails, they see nothing.

**Goal:** give the advisory UI a correct, robust signal for the two missing
states — **generating** (a cycle is running, no decision yet) and **failed** (a
cycle ended without producing a decision) — and rewrite the e2e tests to assert
the now-working UX.

---

## 2. Approach (decided)

A correct generating signal must originate in **decision-workflow-ctrl at
cycle-start** (the only place that knows a cycle is running before the packet
exists). The signal is stored as a **version-guarded status on the
`DecisionReadModel` row** (not a fragile count/flag — that is the accumulate
anti-pattern the read-model program removed; a count leaks under at-least-once /
out-of-order delivery). The component renders rows by status, so the visible
decision **list stays clean** while `GENERATING`/`FAILED` rows drive the
spinner / error UI. This reuses the existing `DecisionReadModel`
subscription + `getPendingDecisions` query — **no new AdvisoryStatus fields, no
`@aws_subscribe` multi-point change.**

```
DWC SF start ──DECISION_CYCLE_STARTED(decisionId, __version:0)──▶ advisory-bff
                                                                   │ projectVersioned
                                                                   ▼ DecisionReadModel status=GENERATING (v0)
  agents run (~30-60s) ...
  success: AssemblePacket ──DECISION_PACKET_CREATED(__version:1)──▶ status=PENDING (v1)  [overwrites v0]
  failure: SF Catch       ──DECISION_CYCLE_FAILED(decisionId, __version:1)──▶ status=FAILED (v1)
  uncatchable States.Runtime failure: no event → UI staleness guard renders FAILED
```

The version guard makes this **order-agnostic + idempotent**: a late STARTED (v0)
arriving after the real decision (v1) is dropped (`#__version < :version`), so the
spinner never flickers over a completed decision.

---

## 2a. Decomposition into workstreams (mini-program)

This feature is too large for one workstream. It is decomposed into a curated
QUEUED set so that **draining QUEUED ⇒ the feature is complete** (mirroring the
read-model program). This spec is the design umbrella; each workstream below is a
backlog file referencing this spec.

| WS | id | Scope (this spec §) | Rank |
|----|-----|--------------------|------|
| Design | `advisory-generating-failed-ux-design` | This spec + decomposition (shipped Doc-layer) | — |
| WS-1 | `advisory-dwc-cycle-lifecycle-events` | §3 — DWC emits STARTED/FAILED + WorkflowStatus + SF Catch | 1 |
| WS-2 | `advisory-bff-cycle-status-projection` | §4 — advisory-bff projects GENERATING/FAILED onto DecisionReadModel | 2 |
| WS-3 | `advisory-generating-state-e2e-accumulate-model-stale` | §5 + §7.3 (test 1) — advisory-mfe UI + staleness + /advisory e2e rewrite + dead-`lastTriggerAt` cleanup | 3 |
| WS-4 | `dashboard-generating-failed-reflection` | §6 + §7.3 (test 2) — dashboard reflects generating/failed + dashboard e2e retarget | 4 |

Build order is the rank order (WS-2 needs WS-1's events; WS-3 + WS-4 need WS-2's
statuses). WS-1 is independently deployable (events ignored until WS-2 consumes
them). Each WS runs its own spec-referenced plan → implement → deploy → validate
cycle via `/backlog-next`.

## 3. decision-workflow-ctrl changes

### 3.1 Status model — `src/domain/models.ts`
Extend `WorkflowStatus` with `'GENERATING'` and `'FAILED'`:
```ts
export type WorkflowStatus =
  | 'GENERATING'
  | 'PENDING'
  | 'AWAITING_CONFIRMATION'
  | 'APPROVED'
  | 'BLOCKED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'FAILED';
```

### 3.2 New events — `src/domain/events.ts`
```ts
DECISION_CYCLE_STARTED: eventName('DECISION_CYCLE_STARTED'),
DECISION_CYCLE_FAILED:  eventName('DECISION_CYCLE_FAILED'),
```

### 3.3 SF emission — `src/constructs/decision-state-machine.ts`
- **STARTED:** a fire-and-forget `CustomState` putEvents (`arn:aws:states:::events:putEvents`,
  no task token) inserted right after `UnpackTriggerEnvelope`, before
  `ParallelProjections`. `decisionId` is already `$.decisionId` (the trigger
  event's id). Detail = standard envelope; `subject = { decisionId, tenantId,
  status: 'GENERATING', __version: 0 }`; `context` from SF state. Source matches
  the SF's existing putEvents convention (`serviceName`).
- **FAILED:** add an SF `Catch` (on `ParallelProjections`, `InvokePortfolioEngine`,
  `InvokeAdvisoryNarrative`, `AssembleDecisionPacket`) → a fire-and-forget
  putEvents state emitting `DECISION_CYCLE_FAILED`; `subject = { decisionId,
  tenantId, status: 'FAILED', __version: 1 }`; then terminate (Fail). Scope:
  **pre-packet** failures only (no DecisionPacket row yet) — post-packet outcomes
  (`BLOCKED`/`REJECTED`) are existing decision statuses, unchanged.
- **Uncatchable `States.Runtime`** failures (per `feedback_states_runtime_uncatchable`)
  cannot emit FAILED; they are covered by the UI staleness guard (§5.3). Document
  this limitation inline.

### 3.4 Event publication
Register `DECISION_CYCLE_STARTED` / `DECISION_CYCLE_FAILED` for cross-service
delivery the same way DWC publishes its other SF events (advisoryBus). They are
**SF-emitted direct events**, not CDC (no row exists at emit time). Confirm the
Ingress/Egress wiring path the existing SF events use and mirror it.

---

## 4. advisory-bff changes

### 4.1 Ingress subscriptions — `src/service.stack.ts`
Add `DECISION_CYCLE_STARTED`, `DECISION_CYCLE_FAILED` to the Ingress `eventTypes`
(alongside `DECISION_PACKET_CREATED/UPDATED`).

### 4.2 Handler/transform — project status onto the DecisionReadModel row
Add a transform (e.g. `src/transforms/decision-cycle-status.ts`) wired in
`event-listener.ts` for both new types. It projects a **minimal** versioned row:
```ts
// DECISION_CYCLE_STARTED → GENERATING (v0); DECISION_CYCLE_FAILED → FAILED (v1)
projectVersioned('DecisionReadModel', {
  decisionId: p.decisionId,
  tenantId: p.tenantId,
  status: p.status,            // 'GENERATING' | 'FAILED'
  createdAt: p.timestamp,
  updatedAt: p.timestamp,
}, {
  version: p.__version,        // 0 for STARTED, 1 for FAILED
  overrides: { pk: `Decision#${p.tenantId}#${p.decisionId}`, sk: 'DecisionReadModel' },
});
```
- `DecisionReadModel` stays `Projection<'P1'>` (no read-model-ownership change —
  same typename, same `projectVersioned` intent; only new status *values*).
- The existing `decision-snapshot.ts` (content packet) is unchanged; its
  degraded-drop defense stays. A content `DECISION_PACKET_CREATED` (v1) cleanly
  overwrites the `GENERATING` (v0) row via the version guard.
- The minimal GENERATING/FAILED projection omits `explanation`/`proposedTrades`;
  ensure the projected row is valid for `getPendingDecisions` (status + ids
  present). Out-of-order safety is the version guard.

---

## 5. advisory-mfe changes

### 5.1 Surface GENERATING/FAILED rows — `get-pending-decisions.fn.js` + mirror
Add `'GENERATING'` and `'FAILED'` to the status `IN (...)` filter (and to
`DecisionListComponent.PENDING_STATUSES`, the mirror, per its keep-in-sync note),
so these rows reach the component via the existing query + `onDecisionUpdate`
subscription.

### 5.2 Component routing — `decision-list/decision-list.component.ts`
Replace the dead `displayedInFlightCount()`/`lastTriggerAt`/`inFlightCount`
generating logic with **status-derived** rendering off `decisions()`:
- `realDecisions` = rows whose status ∉ {GENERATING, FAILED} → the list.
- `generating` = any row with status `GENERATING` (and not stale, §5.3).
- `failed` = a recent `FAILED` row when there is no active generation and no real
  decisions → error state.
- Render: real decisions → list; `generating` → spinner (banner when the list is
  non-empty, full empty-state `data-testid="advisory-generating-state"` when
  empty); `failed` → new `data-testid="advisory-failed-state"` error
  ("We couldn't generate your advice — please try again."). Keep the existing
  `advisory-generating-banner` / `advisory-generating-state` testids.
- Remove `getAdvisoryStatus()` dependence for generating (keep it only if still
  used elsewhere; otherwise drop the now-dead `inFlightCount`/`lastTriggerAt`
  wiring from this component).

### 5.3 Staleness guard (uncatchable-failure fallback)
A `GENERATING` row older than a max-cycle ceiling (derived from `AGENT_BUDGETS` +
margin, e.g. 3 min; reuse the existing `STALENESS_MS` pattern) with no transition
renders as `failed` rather than spinning forever. This covers `States.Runtime`
failures that emit no `DECISION_CYCLE_FAILED`.

### 5.4 i18n
Add `advisory.list.failedTitle` / `advisory.list.failedHint` (reuse existing
`generatingTitle`/`generatingHint`).

---

## 6. dashboard-bff — reflect generating + failed (in scope, WS-4)
The dashboard must also tell the user a cycle is generating / has failed, so the
feedback is consistent across `/dashboard` and `/advisory`. The existing
`advisory-alert-bar` semantically means "decisions ready to review", so reusing it
for "generating" would be misleading. WS-4 opens with a small UX sub-design:
**a distinct generating/failed indicator on the dashboard vs. extending the
alert bar.** Signal source: advisory-bff already announces its aggregate via
`ADVISORY_STATUS_UPDATED` (P3 → dashboard `pendingDecisionsCount`); WS-4 decides
whether to carry a separate generating/failed count on that announcement or
surface it another way. WS-4 also retargets the second e2e test (§7.3).

---

## 7. Testing

### 7.1 advisory-bff unit (`test/unit/...`)
- `DECISION_CYCLE_STARTED` → `projectVersioned('DecisionReadModel', status=GENERATING, version=0)`.
- `DECISION_CYCLE_FAILED` → `status=FAILED, version=1`.
- A content `DECISION_PACKET_CREATED` (v1) overwrites a prior GENERATING (v0);
  a late STARTED (v0) after a real decision (v1) is dropped (version guard).

### 7.2 advisory-mfe component unit
- GENERATING row, empty list → `advisory-generating-state` visible.
- GENERATING row + real decisions → `advisory-generating-banner` visible, list shows only real decisions.
- FAILED row, no generation, no decisions → `advisory-failed-state` visible.
- Stale GENERATING (older than ceiling) → `advisory-failed-state` (timeout).

### 7.3 e2e rewrite — `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts`
Replace the `DEPOSIT_DETECTED` injection. New fixtures inject the real signals on
the advisory bus scoped to advisory-bff:
- inject `DECISION_CYCLE_STARTED` → `/advisory` shows `advisory-generating-state`.
- inject `DECISION_CYCLE_FAILED` (same decisionId) → `/advisory` shows `advisory-failed-state`.
- inject a content `DECISION_PACKET_CREATED` → the decision appears in the list and
  the spinner clears.
UI-only assertions (per the e2e charter). Update/replace
`inject-advisory-update.ts`.

**Second test (dashboard alert-bar) — retargeted (not removed).** Its current
premise (`DEPOSIT_DETECTED` → dashboard-bff increments `pendingDecisionsCount`) is
dead — dashboard-bff routes `DEPOSIT_DETECTED` to the activity feed, and
`pendingDecisionsCount` now comes only from the `ADVISORY_STATUS_UPDATED` P3
projection. Retarget `injectDashboardBffTriggerEvent` to inject a real
`ADVISORY_STATUS_UPDATED` (subject `{ tenantId, inFlightCount: 1, __version }`)
scoped to dashboard-bff → `pendingDecisionsCount > 0` → `advisory-alert-bar`
visible via the `onDashboardUpdate` subscription. This tests the genuinely
reachable dashboard path and keeps the subscription-delivery coverage the test
was written for.

---

## 8. Validation gate
- `nx affected -t test,lint --base=origin/main` green.
- Deploy `decision-workflow-ctrl`, `advisory-bff`, and `investor-web`
  (advisory-mfe) to dev.
- Scoped Playwright `advisory-generating-state` vs deployed dev: generating +
  failed states render; spinner clears on the content packet.

---

## 9. Out of scope
- Post-packet failure surfacing (BLOCKED/REJECTED are existing decision statuses).
- Migrating `inject-advisory-update.ts` off the direct `@aws-sdk/client-eventbridge`
  import (tracked: `nestfolio-e2e-eventbridge-client-wrapper-migration`).
- Real full agent-pipeline e2e (use injected events for determinism + cost).
- Any AdvisoryStatus read-model field additions (the row-backed approach avoids them).

## 10. Risks / open points
- **Version ladder.** STARTED=0, FAILED=1, content packet seeds at 1. FAILED and
  content-CREATE are mutually exclusive (pre-packet failure ⇒ no packet), so the
  v1 overlap never materializes; document the invariant. Verify the DecisionPacket
  CDC actually emits `__version:1` on insert as `decision-snapshot` consumes.
- **Uncatchable `States.Runtime`** failures rely on the UI staleness guard, not an
  event — acceptable, documented.
- **Stuck GENERATING** with neither a packet nor a FAILED event (e.g. SF lost) is
  also covered by the staleness guard.
- Confirm the SF direct-event publication path (source/envelope) matches existing
  DWC SF events so advisory-bff's Ingress `$or` accepts them.
