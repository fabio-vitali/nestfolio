---
id: happy-path-go-live-badge-stuck-sim
status: queued
type: bug
rank: 5
notes: "new-investor-happy-path e2e now red at the go-live step (step 11): after confirmGoLive the dashboard execution-mode badge stays 'sim' (dashboard.badge.sim) — execution-mode-live never appears within 60s. Unmasked 2026-06-16 by the decision-wedge fix (step was previously unreachable). Separate subsystem (dashboard-bff InvestorSnapshot.executionMode → badge / WSS), NOT caused by the decision fix. Now the top blocker for nestfolio-e2e green."
references:
  - apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
  - apps/nestfolio-e2e/src/pages/go-live.page.ts
  - services/investor/dashboard-bff/src/transforms/investor-snapshot.ts
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_decision_workflow_stuck.md
validation_gate: null
---

# new-investor-happy-path go-live step: execution-mode badge stuck on `sim`

Surfaced 2026-06-16 by `happy-path-decision-sf-waitfortasktoken-wedge`. Fixing the decision
wedge let the `apps/nestfolio-e2e` `new-investor-happy-path` journey reach **step 11 (go-live)
for the first time** — it had always been blocked at the decision step before, so the go-live
UI assertion (added by `go-live-agent-wiring-and-emission`) has **never actually been exercised
via Playwright**. It fails:

```
Step 11 "investor goes live from simulation"
  expect(locator('[data-testid="execution-mode-live"]')).toBeVisible()  // 60s
  → element(s) not found; page snapshot shows the badge generic "dashboard.badge.sim"
```

So after `confirmGoLive`, the dashboard execution-mode badge stays **SIM** and never flips to
**LIVE** within 60s.

## What this is NOT

- **Not** caused by the decision-wedge fix. The badge is driven by dashboard-bff's
  `InvestorSnapshot.executionMode` projection of `INVESTOR_PROFILE_UPDATED` — a service that was
  neither changed nor deployed by that workstream. The decision fix only touched advisory-bff +
  DWC + the PE/AN/compliance ingress identity reads.
- **Not** a go-live *backend* break: go-live is independently green via the Jest `go-live-switch`
  e2e (the simulation→live switch + `GO_LIVE_CONFIRMED` chain works server-side).
- **Not** (evidence-wise) a 60s-timing flake: the badge is definitively `sim` at the timeout, and
  the step has no prior green run to regress from.

## Likely root cause (to confirm)

The CDC/push chain the test comments assert:
`InvestorProfile MODIFY → INVESTOR_PROFILE_UPDATED → dashboard-bff InvestorSnapshot.executionMode='live'
→ onDashboardUpdate WSS push → badge re-render`. The break is somewhere in:
1. dashboard-bff's `investor-snapshot.ts` not projecting `executionMode='live'` from the go-live
   `INVESTOR_PROFILE_UPDATED` (does that event carry the new mode?), OR
2. the `@aws_subscribe` broadcast not delivering the executionMode change to the mounted dashboard
   (the [[feedback-appsync-subscribe-filter-args]] class — filter arg must be on the mutation
   response + publisher selection), OR
3. the badge component not re-binding on the pushed InvestorSnapshot.

## Cheapest next steps

1. Read the page snapshot / trace from the failing run, then check the dashboard-bff
   `InvestorSnapshot` row for a go-live tenant on dev: did `executionMode` flip to `live` in DDB?
   - flipped in DDB but badge stayed sim → WSS-push / badge-binding gap (UI side).
   - stayed `sim` in DDB → the `INVESTOR_PROFILE_UPDATED` go-live projection never set it (producer/projection side).
2. Confirm whether the go-live `INVESTOR_PROFILE_UPDATED` subject/context actually carries the new
   `executionMode`, and whether dashboard-bff's investor-snapshot transform reads it.

Related: `dashboard-portfolio-summary-live-push-e2e-scenario`, `dashboard-bff-awaiting-confirmation-activity-gap`
(both dashboard-bff live-push coverage). Likely sibling to whatever those reveal.
