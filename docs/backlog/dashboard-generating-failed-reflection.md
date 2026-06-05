---
id: dashboard-generating-failed-reflection
status: active
rank: 4
type: feature
notes: "WS-4 of advisory-generating-failed-ux: the dashboard reflects generating + failed decision cycles (consistent feedback with /advisory). Opens with a small UX sub-design — distinct generating/failed indicator vs reusing advisory-alert-bar. Retargets the dashboard alert-bar e2e off the removed accumulate model."
references:
  - docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
  - services/investor/dashboard-bff/src/transforms/advisory-status.ts
  - apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts
  - apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
out_of_scope:
  - "The /advisory surface (WS-3, shipped) — WS-4 is dashboard-only."
  - "DWC cycle-event emission (WS-1) and advisory-bff DecisionReadModel projection (WS-2) — WS-4 consumes existing signals, does not change them."
  - "Post-packet failure surfacing (BLOCKED/REJECTED are existing decision statuses)."
  - "Migrating inject-advisory-update.ts off the direct @aws-sdk/client-eventbridge import (tracked: nestfolio-e2e-eventbridge-client-wrapper-migration)."
  - "Real full agent-pipeline e2e (use injected events for determinism + cost)."
spec: docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
plan: null
topic_memory: []
validation_gate: null
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
