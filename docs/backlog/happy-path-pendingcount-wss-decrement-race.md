---
id: happy-path-pendingcount-wss-decrement-race
status: active
type: bug
notes: "REOPENED 2026-05-29 — the 2026-05-29 Activity-broadcast fix closed the decrement race but a residual remains: Step 8 still fails on first try / passes on rerun. Leading hypothesis: WSS subscription-establishment race with no feed backfill (onActivityUpdate frame dropped if broadcast fires before subscribe_success; feed never reconciles). Original symptom: WSS counter assertion raced real DECISION_APPROVED -1 within 30s; post-2026-05-09 inc/dec semantics broke the monotonic-up invariant."
references:
  - path: apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
    anchor: L138-L162
  - path: services/investor/dashboard-bff/src/transforms/advisory-status.ts
  - path: services/investor/dashboard-bff/src/handlers/event-listener.ts
  - path: services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts
  - path: apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
  - path: apps/dashboard-mfe/src/app/dashboard/dashboard-container.component.ts
    anchor: L162-L197
  - path: apps/dashboard-mfe/src/app/services/dashboard.service.ts
    anchor: L60-L94
  - path: apps/nestfolio-e2e/src/pages/dashboard.page.ts
    anchor: L56-L60
out_of_scope:
  - Modifying the existing AdvisoryStatus pendingDecisionsCount inc/dec semantics (counter stays as-is; assertion target moves to Activity).
  - Live-push for PortfolioSummary or PositionSnapshot — separately filed as dashboard-live-push-portfolio-summary and dashboard-live-push-position-snapshots.
  - Refactoring dashboard-publisher.ts beyond adding the new Activity broadcast entry.
  - Investigating sub-100ms DOM render coalescing of the pendingDecisionsCount value — moot once the assertion target moves to the append-only Activity row.
  - Touching the sister fixture injectAdvisoryBffTriggerEvent (different surface — advisory-bff).
  - Adding a new getRecentActivity-style query surface; the existing query stays as the on-mount loader.
spec: docs/superpowers/specs/2026-05-29-activity-feed-subscribe-before-query-design.md
plan: docs/superpowers/plans/2026-05-29-activity-feed-subscribe-before-query.md
topic_memory: []
validation_gate: |
  - nx affected -t test,lint --base=origin/main: GREEN (30 projects, 51 dashboard-bff unit tests pass with Activity dispatch logs)
  - dev-dashboard-bff deploy UPDATE_COMPLETE 2026-05-28T23:53:35 (CFN stack; DashboardPublisher Lambda + AppSync Schema both UPDATE_COMPLETE)
  - dev-investor-web deploy UPDATE_COMPLETE 2026-05-28T23:52:30 (CFN stack; investor-web shell + dashboard-mfe bundle redeployed)
  - dashboard-bff:test-integration: 21/21 GREEN on warm rerun (250s); first run had 1 pre-existing cold-start flake matching integration-deep-coldstart-flakes-post-trap-hardening; new T7 case "broadcasts publishActivityUpdate on DEPOSIT_DETECTED" passed both runs.
  - nestfolio-e2e:e2e run 1: 4/4 PASS (4.8m total; new-investor-happy-path 2.8m) — /tmp/pw-run-1.log
  - nestfolio-e2e:e2e run 2: 4/4 PASS (4.5m total; new-investor-happy-path 2.7m) — /tmp/pw-run-2.log
  - Final code review: APPROVED (no Critical/Important issues; minor items pre-existing parity)
  - Implementation: commits 61bff352..9725a528 (15 commits) on worktree-activity-live-broadcast
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

---

## REOPENED 2026-05-29 — residual after the Activity-broadcast fix

The 2026-05-28/29 fix (commits `61bff352..9725a528`, shipped) moved the Step 8
assertion off the racing `pendingDecisionsCount` counter onto the append-only
`Activity#<eventId>` row delivered via the new `onActivityUpdate` broadcast.
That correctly eliminated the **decrement race**. Validation passed 4/4 twice
(`/tmp/pw-run-1.log`, `/tmp/pw-run-2.log`).

**But the gate has since failed on first try and passed on rerun** (user
report, 2026-05-29). Per `feedback_flake_means_broken.md`, a rerun-pass after a
first-try fail means the system genuinely drops live Activity sometimes — it is
NOT a flake to wave away, and "cold start" is NOT an acceptable diagnosis (Node
Lambda cold starts are 200–1500ms and cannot produce a 30s-window miss —
`feedback_node_lambda_cold_starts.md`).

### Leading hypothesis (NOT yet reproduced — needs the failing-run evidence)

A **WSS subscription-establishment race with no feed backfill**, distinct from
the decrement race:

1. `dashboard-container.component.ts:162-165` — `ngOnInit` does
   `await loadDashboard()` **then** `subscribeToUpdates()` fire-and-forget. The
   AppSync/Amplify WS handshake (`connection_init` → `subscribe` →
   `subscribe_success`) takes real wall-clock time and is never awaited.
2. The test's only pre-inject barriers are `waitForLoaded()` (cta-deposit) and
   `waitForPendingDecisionsAtLeast(1)` — and the POM documents
   (`dashboard.page.ts:26-29`) that the latter passes off the initial
   `getDashboard` query, **not** a WSS frame. So the test reaches the inject
   (`spec.ts:152`) while `onActivityUpdate` may still be mid-handshake.
3. AppSync `@aws_subscribe` does **not** replay events published before the
   subscription registers. If `publishActivityUpdate` fires before
   `subscribe_success`, the frame is dropped.
4. The feed has **no reconciliation**: `getRecentActivity` is queried once at
   mount (`dashboard-container.component.ts:207`); thereafter the store only
   `addActivity` per live frame (`:193`). No refetch, no poll, no
   refetch-on-reconnect. With no reload in Step 8, the dropped row never reaches
   the DOM → `waitForActivityByEventId` times out at 30s (`spec.ts:153`).

"Cold" only widens the handshake-vs-broadcast window; it is not the cause.

### Why this is a product bug, not a test bug

Per `feedback_bff_state_completeness.md` and CLAUDE.md ("if the POM polls for
state a real user could not observe, the UI is the bug"): a real user whose
Activity event fires in the mount→subscribe gap, or across any transient WS
reconnect, silently loses that row until a manual refresh. The correct fix —
reconcile the feed (re-query + merge after `subscribe_success`, and on
reconnect) — fixes the user AND the test simultaneously. This is the
"handle eventual consistency gracefully" requirement, applied to the live feed.

### Out of scope for this residual

- Re-introducing the decrement-race counter assertion (already correctly retired).
- Broadening to PortfolioSummary / PositionSnapshot live-push (separate dossiers
  `dashboard-live-push-portfolio-summary`, `dashboard-live-push-position-snapshots`)
  — though the same reconcile-after-subscribe pattern likely applies and should be
  noted as a candidate generalisation.

### Next step

Brainstorm (`superpowers:brainstorming`) the reconcile design, then TDD: first
reproduce by capturing the attempt-1 failing run (`waitForActivityByEventId`
locator timeout at `spec.ts:153`) to confirm the hypothesis before any fix.
Candidate fix shape: after the activity subscription's first delivery / on
`subscribe_success`, re-run `getRecentActivity` and merge (dedupe by
`activityId`); add reconnect handling. Belongs in production code
(`dashboard-container.component.ts` / `dashboard.service.ts`), not the POM.
