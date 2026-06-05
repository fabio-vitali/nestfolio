---
id: dashboard-portfolio-summary-live-push-e2e-scenario
status: parking
type: tooling
notes: "No e2e scenario asserts dashboard KPI cards update live (no refresh) after a deposit/fill. dashboard-live-push-portfolio-summary shipped the transport but its delivery is only unit-covered; integration doesn't cover AppSync broadcast, so the live path has zero end-to-end assertion."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Dashboard PortfolioSummary live-push e2e scenario

`dashboard-live-push-portfolio-summary` (shipped 2026-06-05) wired the AppSync
broadcast of `PortfolioSummary` KPI cards over the existing `onDashboardUpdate`
channel. The transport is covered by **unit** tests only:
- `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts` — broadcast fires + mapImage shape.
- `apps/dashboard-mfe/test/app/stores/dashboard.store.spec.ts` — LWW `setPortfolioSummary`.
- `apps/dashboard-mfe/test/app/dashboard/dashboard-container.component.spec.ts` — live frame applied + reconnect backfill.

There is **no end-to-end assertion** that a real deposit/fill makes the dashboard
KPI cards (`totalValueCents` / `cashBalanceCents` / `positionCount`) update
**without a manual refresh**. `apps/e2e-feature-tests` has no dashboard live-push
scenario (grep: only `funding/fund-account`, `account/circuit-breaker-lifecycle`,
`helpers/fixtures` mention deposit/portfolio), and dashboard-bff integration tests
cover projection/materialization, NOT AppSync `@aws_subscribe` delivery (that needs
the WSS harness — see parking item `wss-subscription-test-harness-test-support`).

This is a **new-coverage gap**, not a red suite — the e2e suite passes today — so it
parks (LATER) per the e2e-gaps litmus (suite-fails-today → queued; coverage gap →
parking).

Cheapest path once picked up: either (a) a Playwright `apps/nestfolio-e2e` scenario
that deposits, then asserts the KPI card text changes without a reload (real WSS),
or (b) the Jest `apps/e2e-feature-tests` analogue once `wss-subscription-test-harness-test-support`
lands. Pairs with the rank-2 `dashboard-live-push-position-snapshots` transport item
— a single scenario could assert both KPI + holdings live-update after one fill.
