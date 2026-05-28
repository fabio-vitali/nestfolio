---
id: happy-path-pendingcount-wss-decrement-race
status: active
type: bug
notes: "new-investor-happy-path Step 8 WSS counter assertion races real DECISION_APPROVED -1 within 30s; post-2026-05-09 inc/dec semantics broke the monotonic-up invariant."
references:
  - path: apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
    anchor: L138-L162
  - path: services/investor/dashboard-bff/src/transforms/advisory-status.ts
  - path: services/investor/dashboard-bff/src/handlers/event-listener.ts
  - path: services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts
  - path: apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
out_of_scope:
  - Modifying the existing AdvisoryStatus pendingDecisionsCount inc/dec semantics (counter stays as-is; assertion target moves to Activity).
  - Live-push for PortfolioSummary or PositionSnapshot — separately filed as dashboard-live-push-portfolio-summary and dashboard-live-push-position-snapshots.
  - Refactoring dashboard-publisher.ts beyond adding the new Activity broadcast entry.
  - Investigating sub-100ms DOM render coalescing of the pendingDecisionsCount value — moot once the assertion target moves to the append-only Activity row.
  - Touching the sister fixture injectAdvisoryBffTriggerEvent (different surface — advisory-bff).
  - Adding a new getRecentActivity-style query surface; the existing query stays as the on-mount loader.
spec: docs/superpowers/specs/2026-05-28-activity-live-broadcast-design.md
plan: null
topic_memory: []
validation_gate: null
---

# new-investor-happy-path Step 8 WSS counter assertion races real DECISION_APPROVED decrement

## Failure 2026-05-28

`pnpm nx run nestfolio-e2e:e2e` on commit `323a9ed0` (clean main, deployed dev): 3/4 PASS, 1/4 FAIL — `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:15`, Step "decision pipeline triggers + WSS live-update verified":

```
Expected: >= 3
Received:    2
Timeout 30000ms exceeded while waiting on the predicate
  at apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:153
```

Failing call: `dashboard.waitForPendingDecisionsAtLeast(baseline + 1, 30_000)` after `injectDashboardBffTriggerEvent`.

## Empirical timeline (DDB, dev account 771924376645)

Tenant `e2e-1779972329707-12b274f3`, table `dev-dashboard-bff-StateTable962DE04C-QF8GBOPXCZMO`:

| Time (UTC)   | Event                                 | Counter |
| ------------ | ------------------------------------- | ------- |
| 12:47:38     | DEPOSIT_DETECTED (real EUR, onboarding capital) | 0→1     |
| 12:47:53     | DEPOSIT_DETECTED (real USD, Step 7)   | 1→2     |
| 12:48:03     | DEPOSIT_DETECTED (synthetic inject)   | 2→**3** |
| 12:48:10     | DECISION_APPROVED (real pipeline)     | 3→**2** |
| 12:48:11     | USER_CONFIRMATION_REQUESTED           | 2       |
| 12:48:33     | test 30s timeout                      | 2       |

Final `AdvisoryStatus.pendingDecisionsCount = 2`. Counter held at 3 for ~7s only; WSS frame and/or Angular signal coalescing meant `.alert-text` never rendered "3" to the DOM within that window.

## Root cause

`services/investor/dashboard-bff/src/transforms/advisory-status.ts` increments on 7 trigger events (`MANDATE_ISSUED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`) and decrements on `DECISION_APPROVED` / `DECISION_BLOCKED`. This inc/dec semantics shipped 2026-05-09 in workstream [[advisory-empty-state-pending-decisions-count]]. The happy-path Step 8 assertion (`baseline + 1` within 30s) was written under the prior monotonic-up semantics, where the counter only increased on `USER_CONFIRMATION_REQUESTED`. Post-shipped, any real decision completion within the 30s window cancels the synthetic's increment — which is the normal case here, since Step 7's deposit drives a real pipeline that finishes in ~30–60s and overlaps the inject window.

**Not** maxVms saturation (different failure mode — see [[playwright-rebalance-real-agents-maxvms-remediation]], shipped 2026-05-27).
**Not** WSS subscription dropped — activity feed and counter decrements both arrive in real time per DDB.
**Not** the Bug A/D/E layer in advisory-bff ([[new-investor-happy-path-pending-at-decision-confirm]], shipped 2026-05-24).
**Not** the `injectAdvisoryUpdate` cleanup ([[delete-deprecated-inject-advisory-update-fixture]], shipped) — different fixture, `injectDashboardBffTriggerEvent` is the in-use one and is not deprecated.

## Fix direction (needs brainstorming before plan)

The WSS-proof assertion needs a monotonic observable that doesn't race with pipeline completions. Three candidates:

1. **Anchor on the synthetic's `Activity#<eventId>` row.** Activity rows are append-only — no decrement race. Either subscribe via `onDashboardUpdate` (the publisher would need an `Activity` broadcast entry — not currently present per `dashboard-publisher.ts`) or read the row via a deterministic getter. This keeps the proof clean: one synthetic event in, one specific row out.
2. **Use a counter-immune sentinel.** Have the inject path mutate a monotonic field (e.g. `lastRecommendationAt` timestamp) so the assertion compares timestamps. Reopens the design question that [[delete-deprecated-inject-advisory-update-fixture]] closed.
3. **Sequence the inject after the real pipeline's decrement.** Wait for the Step 7 deposit's `DECISION_APPROVED` activity row before injecting. Counter is then stable at the value-after-decrement, and the synthetic's +1 won't race.

Option 1 is the cleanest end-to-end WSS proof. Option 3 is the smallest test-side change but lengthens the test runtime by the pipeline duration.

## Cheapest next step

Brainstorm the three options in a short spec, then a single-file edit to `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:138-162`. No production code change required.
