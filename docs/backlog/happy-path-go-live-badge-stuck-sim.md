---
id: happy-path-go-live-badge-stuck-sim
status: shipped
type: bug
notes: "new-investor-happy-path e2e now red at the go-live step (step 11): after confirmGoLive the dashboard execution-mode badge stays 'sim' (dashboard.badge.sim) — execution-mode-live never appears within 60s. Unmasked 2026-06-16 by the decision-wedge fix (step was previously unreachable). Separate subsystem (dashboard-bff InvestorSnapshot.executionMode → badge / WSS), NOT caused by the decision fix. Now the top blocker for nestfolio-e2e green."
references:
  - apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
  - apps/nestfolio-e2e/src/pages/go-live.page.ts
  - services/investor/dashboard-bff/src/transforms/investor-snapshot.ts
out_of_scope:
  - "A live-delivery WSS e2e harness that asserts the @aws_subscribe broadcast reaches the badge without a reload — no WSS test harness exists (same gap as portfolio-summary; tracked by wss-subscription-test-harness-test-support / dashboard-portfolio-summary-live-push-e2e-scenario). Validation here is the existing nestfolio-e2e step-11 Playwright assertion + dashboard-bff/dashboard-mfe/ui unit + scoped integration + deploy-schema smoke."
  - "Other dashboard surfaces' live-push (AdvisoryStatus / PortfolioSummary / Activity / PositionSnapshot) — already shipped."
  - "Re-litigating the channel topology — settled by Approach A (2026-05-29 brainstorming, reaffirmed in the 2026-06-13 position-snapshots design): scalar/singleton summary surfaces ride the shared Dashboard channel; keyed collections get dedicated channels. InvestorSnapshot is a singleton, so it rides the shared publishDashboardUpdate/onDashboardUpdate channel — NOT a new dedicated channel."
  - "Amending the stale Out-of-scope claim in 2026-06-13-dashboard-live-push-position-snapshots-design.md ('InvestorSnapshot … already shipped on the Dashboard channel') — historical design doc; the false assumption is the root cause but the doc is not rewritten here."
  - "dashboard-bff-awaiting-confirmation-activity-gap — separate dashboard-bff activity-feed item."
spec: docs/superpowers/specs/2026-06-16-investor-snapshot-live-push-design.md
plan: docs/superpowers/plans/2026-06-16-investor-snapshot-live-push.md
topic_memory:
  - project_decision_workflow_stuck.md
validation_gate: |
  Shipped 2026-06-16 (worktree branch worktree-happy-path-go-live-badge-stuck-sim).
  Fix: InvestorSnapshot rides the shared publishDashboardUpdate/onDashboardUpdate
  channel (Approach A — singleton summary surface). Commits: 03f48aa6 (dashboard-bff
  broadcaster + resolver + schema), 0899a128 (store guarded setInvestorSnapshot),
  3157b7b7 (mfe subscription + service + container onFrame), 75ccaadc (service card).
  - Unit: dashboard-publisher 19/19, dashboard.store 42/42, dashboard-container 13/13;
    affected `nx run-many -t test,lint -p dashboard-bff,dashboard-mfe` GREEN (63 tests).
  - Deploy: dev-dashboard-bff UPDATE_COMPLETE — AppSync GraphQLSchema (new
    InvestorSnapshotInput + investorSnapshot arg), publishDashboardUpdateFn resolver,
    DashboardBroadcaster/Publisher Lambda; investor-web shell redeployed (new
    dashboard-mfe bundle). Log /tmp/deploy-dashboard-bff-2.log.
  - Integration: dashboard-bff 21/21 GREEN against deployed dev.
  - E2E (the headline gate): nestfolio-e2e new-investor-happy-path 1 passed (3.3m),
    step 11 "investor goes live from simulation" → execution-mode-live visible (badge
    flips sim→live via real AppSync @aws_subscribe, no reload). Run ×1 per user choice
    (anti-flake 2nd pass not run — note for future regressions).
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

## ROOT CAUSE — CONFIRMED (2026-06-16, code-traced end-to-end)

The backend correctly flips the value; **there is no live-delivery path of `InvestorSnapshot`
to the mounted dashboard.** Both halves of the WSS surface (option 2 above) are simply absent.

Layer-by-layer evidence:

| Layer | Verdict |
| --- | --- |
| `confirmGoLive` → atomic `TransactWriteItems` flips `InvestorProfile.executionMode='live'` + bumps `__version` | ✅ works |
| Egress (`investor-bff/service.stack.ts`): `InvestorProfile` modify → `always: INVESTOR_PROFILE_UPDATED`; DRY subject `schema.parse(row)` carries `executionMode` (in `InvestorProfileUpdatedSchema`) + `__version` | ✅ works |
| `dashboard-bff/transforms/investor-snapshot.ts` → `projectVersioned('InvestorSnapshot', { executionMode:'live' })` into DDB | ✅ works |
| `getDashboard` query + `schema.graphql` return `executionMode`; badge (`dashboard-mfe/.../execution-mode-badge.component.ts`) binds `store.investorSnapshot()?.executionMode` | ✅ works |
| `dashboard-publisher.ts` broadcasters: `AdvisoryStatus`, `PortfolioSummary`, `Activity`, `PositionSnapshot` — **`InvestorSnapshot` ABSENT** | ❌ no broadcast |
| `ON_DASHBOARD_UPDATE` subscription selection: `portfolioSummary` + `advisoryStatus` only — **no `investorSnapshot`** (store comment: *"investorSnapshot has no live channel"*) | ❌ no client channel |
| Frontend `getDashboard` is `cache-first`, run **once** on mount, no poll/refetch | ❌ no refetch |

At go-live the dashboard mounts, runs its single `getDashboard` query which **races the CDC chain
and loses** (returns `simulation`), caches it 60s, and nothing pushes or refetches the flipped row.
The badge is frozen on `sim`. Genuine production UX bug (a real user staying on the dashboard sees
`sim` until a hard refresh) — the class E2E-UI assertions exist to catch
([[feedback-e2e-ui-assertions-only]], [[feedback-bff-state-completeness]]). Fix is the wiring, **not**
the POM timeout.

## Decision (recovered, not re-litigated): shared Dashboard channel

The user asked to stay consistent with the prior live-push channel-split refactoring. Recovered
**Approach A** from `2026-06-13-dashboard-live-push-position-snapshots-design.md` (lines 31–34,
carried forward from 2026-05-29 brainstorming):

> *scalars share the `Dashboard` channel; keyed collections get dedicated channels, mirroring `Activity`.*

`InvestorSnapshot` is a singleton per-tenant summary row (exactly like `PortfolioSummary` /
`AdvisoryStatus`, which already ride `publishDashboardUpdate` / `onDashboardUpdate`) → it rides the
**shared Dashboard channel**, NOT a new dedicated channel. This follows the `PortfolioSummary`
shared-channel template (`ed603eb2`→`dc1591df`) precisely.

Root irony: that same position-snapshots design's Out-of-scope claims *"InvestorSnapshot … already
shipped on the Dashboard channel"* — **false**; it never was, which is why this gap shipped silently.

## Fix shape (detail in the design + plan)

- **dashboard-bff:** `InvestorSnapshotInput` + `investorSnapshot` arg on `publishDashboardUpdate`
  (+ on the `DashboardUpdate` response type & resolver); register an `InvestorSnapshot` broadcaster
  in `dashboard-publisher.ts` gated `whenChanged` on the display fields (incl. `executionMode`),
  `mapImage` → `{ tenantId, investorSnapshot }`.
- **dashboard-mfe:** add `investorSnapshot { ...InvestorSnapshotFields }` to `ON_DASHBOARD_UPDATE`;
  merge the frame into the store's `investorSnapshot` signal in `subscribeToDashboardUpdates`.

Related: `dashboard-portfolio-summary-live-push-e2e-scenario`, `dashboard-bff-awaiting-confirmation-activity-gap`.
