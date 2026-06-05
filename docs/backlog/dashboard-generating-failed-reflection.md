---
id: dashboard-generating-failed-reflection
status: shipped
rank: 4
type: feature
notes: "WS-4 of advisory-generating-failed-ux: the dashboard reflects generating + failed decision cycles (consistent feedback with /advisory). Opens with a small UX sub-design — distinct generating/failed indicator vs reusing advisory-alert-bar. Retargets the dashboard alert-bar e2e off the removed accumulate model."
references:
  - docs/superpowers/specs/2026-06-05-dashboard-generating-failed-reflection-design.md
  - docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
  - services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts
  - services/investor/dashboard-bff/src/transforms/advisory-status.ts
  - apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts
  - apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
out_of_scope:
  - "The /advisory surface (WS-3, shipped) — WS-4 is dashboard-only."
  - "DWC cycle-event emission (WS-1) and advisory-bff DecisionReadModel projection (WS-2) — WS-4 consumes existing signals, does not change them."
  - "Post-packet failure surfacing (BLOCKED/REJECTED are existing decision statuses)."
  - "Migrating inject-advisory-update.ts off the direct @aws-sdk/client-eventbridge import (tracked: nestfolio-e2e-eventbridge-client-wrapper-migration)."
  - "Real full agent-pipeline e2e (use injected events for determinism + cost)."
spec: docs/superpowers/specs/2026-06-05-dashboard-generating-failed-reflection-design.md
plan: docs/superpowers/plans/2026-06-05-dashboard-generating-failed-reflection.md
topic_memory: []
validation_gate: |
  Shipped 2026-06-05 on branch worktree-dashboard-generating-failed-reflection
  (commits d7c5b4aa..15609863). WS-4 of advisory-generating-failed-ux.
  - Producer: advisory-bff deriveAdvisoryAggregate (single tenantId-index query →
    inFlight/generating/failed/oldestGeneratingAt; replaced countInFlightDecisions),
    projector writes all 4 on the atomic-__version AdvisoryStatus row.
  - Consumer: dashboard-bff advisory-status.ts projects the 3 new fields (P3,
    version-guarded, ?? defaults); schema AdvisoryStatus + AdvisoryStatusInput +
    getDashboard resolver + dashboard-publisher selection/mapImage/whenChanged.
  - dashboard-mfe: store derivation (advisoryGenerating/advisoryFailed + 6-min
    staleness tick), presentational advisory-cycle-status banner (distinct from the
    alert bar), container wiring, en-GB/it-IT i18n. setupComponentTest extended
    (overrideTemplate:null → real-template render) — backward-compatible, shell:test
    167/167.
  - Pre-existing bug found + fixed (bea504fe): getDashboard returned a keyless {}
    for a missing InvestorSnapshot → non-nullable updatedAt null → whole query
    errored; guarded on .sk like portfolioSummary. Regression test deferred:
    dashboard-getdashboard-missing-row-integration-test.
  Validation: nx affected -t test,lint green (35 projects); advisory-bff +
  dashboard-bff typecheck green; dashboard-mfe:build clean; dashboard-bff
  integration 21/21 (incl. the generating/failed projection assertion); scoped
  Playwright 'dashboard reflects generating, failed, then ready-to-review' 2x
  consecutive green vs deployed dev. Deployed: advisory-bff, dashboard-bff
  (+resolver fix), all 5 MFEs + host.
---

# WS-4 — dashboard generating + failed reflection

Part of the `advisory-generating-failed-ux` mini-program (design umbrella:
`docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md`, §6 + §7.3
test 2). Depends on WS-2 (rank 2) producing the generating/failed signal.

Opens with a small UX sub-design: the existing `advisory-alert-bar` means
"decisions ready to review", so reusing it for "generating" would mislead. Decide
between a **distinct dashboard generating/failed indicator** vs. extending the
alert bar, and how the signal reaches dashboard-bff (a separate generating/failed
count on `ADVISORY_STATUS_UPDATED`, or another path — the advisory-status P3
projection is the existing carrier).

Scope:
- dashboard-bff: carry + project the generating/failed signal (per the sub-design).
- dashboard-mfe: render the generating/failed indicator.
- Retarget the second e2e test in `advisory-generating-state.spec.ts`
  (`dashboard alert bar appears…`): replace the dead `DEPOSIT_DETECTED` injection
  (which never moved `pendingDecisionsCount`) with the reachable path
  (`ADVISORY_STATUS_UPDATED` → `pendingDecisionsCount` → alert bar), and add the
  generating/failed indicator assertion. Update `inject-advisory-update.ts`.
- Unit + scoped Playwright vs dev; deploy dashboard-bff + investor-web.
