---
id: advisory-generating-state-e2e-accumulate-model-stale
status: active
type: bug
notes: "advisory-generating-state.spec.ts (Playwright) encodes the removed pre-WS3 accumulate model (DEPOSIT_DETECTED -> count++); both tests are broken vs the current recompute architecture, and the generating-empty-state may be unreachable now."
references:
  - apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts
  - apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
  - apps/advisory-mfe/src/app/decision-list/decision-list.component.ts
out_of_scope:
  - "No change to advisory-bff / dashboard-bff backend behavior (inFlightCount recompute + pendingDecisionsCount P3 projection are correct as shipped); this is a test-correctness + UI-reachability workstream."
  - "No broadening to other nestfolio-e2e scenarios beyond advisory-generating-state.spec.ts and its two fixtures."
  - "No migration of the lone direct @aws-sdk/client-eventbridge import in inject-advisory-update.ts to the test-support wrapper (tracked separately: nestfolio-e2e-eventbridge-client-wrapper-migration)."
  - "No new production feature (e.g. a real count-before-row 'generating' signal) — if the empty-state is unreachable, resolve by re-targeting the test to the reachable state and/or removing dead UI, not by adding backend machinery."
spec: docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# advisory-generating-state.spec.ts encodes the removed accumulate model

Surfaced 2026-06-04 while shipping `advisory-status-recompute-monotonic-version`.
Both Playwright tests in `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts`
assume the **pre-workstream-3 accumulate model** where a `DEPOSIT_DETECTED` trigger
incremented an in-flight counter *before* any decision row existed. Workstream 3
removed that. The tests are broken against current code:

**Test 1 — "shows generating empty-state …"**
- Injects `DEPOSIT_DETECTED` to advisory-bff (`injectAdvisoryBffTriggerEvent`)
  expecting `AdvisoryStatus.inFlightCount` to increment.
- Current code: advisory-bff `event-listener.ts` handlers = `DECISION_PACKET_CREATED`,
  `DECISION_PACKET_UPDATED` only — no `DEPOSIT_DETECTED` handler. `inFlightCount`
  is recomputed by `advisory-status-projector.ts` as
  `countInFlightDecisions` = `COUNT(DecisionReadModel rows WHERE status IN IN_FLIGHT_STATUSES)`.
- A deposit creates no `DecisionReadModel` row → `inFlightCount` stays 0 →
  `waitForAdvisoryDecisionRow(allowInFlightOnly:true)` times out → test fails.

**Test 2 — "dashboard alert bar appears at trigger time via subscription"**
- Injects `DEPOSIT_DETECTED` to dashboard-bff (`injectDashboardBffTriggerEvent`)
  expecting `pendingDecisionsCount` to increment.
- Current code: dashboard-bff `event-listener.ts` routes `DEPOSIT_DETECTED` →
  `recentActivity` (activity feed). `pendingDecisionsCount` is now produced ONLY
  by the `advisory-status.ts` transform on `ADVISORY_STATUS_UPDATED` (P3 projection
  of advisory-bff's announced aggregate).
- A deposit never moves `pendingDecisionsCount` → `advisory-alert-bar` never
  appears → test fails.

## The design question (not just a test bug)

The `advisory-generating-state` empty-state (`decision-list.component.ts:66`)
renders when `displayedInFlightCount() > 0` **AND** `decisions()` is empty. Under
the recompute model, `inFlightCount > 0` implies a non-terminal `DecisionReadModel`
row exists — which `decisions()` would then list, rendering the generating
**banner** (`:40`) instead of the empty-state. So the empty-state may be
**architecturally unreachable** (the old `decision-trigger-received +1` gave a
count-before-row window; WS3 removed it). Open question to resolve before fixing
the test: is the generating-empty-state still a real reachable UX (e.g. a
counted-but-hidden status that `decisions()` filters out), or is it dead UI that
should be removed and the test rewritten to assert the banner?

## Cheapest next step

1. Determine what `decisions()` shows vs what `countInFlightDecisions` counts
   (status overlap) — settles the reachability question with evidence.
2. Rewrite fixtures to drive the real signals: inject a non-degraded
   `DECISION_PACKET_CREATED` (advisory-bff) / `ADVISORY_STATUS_UPDATED`
   (dashboard-bff) instead of `DEPOSIT_DETECTED`.
3. Re-target test 1's assertion to the actually-reachable state (banner vs
   empty-state), adjusting `decision-list.component.ts` only if the empty-state
   is confirmed dead.
4. Validate with scoped Playwright against deployed dev (UI-only assertions per
   the e2e charter).

Complex lane: architectural decision (generating-state semantics) + e2e
validation gate. Affects `nestfolio-e2e` green-ness → QUEUED, not parking.
