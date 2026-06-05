---
id: extract-shared-advisory-cycle-state-helper
status: active
rank: 1
type: refactor
notes: "Fold the duplicated advisory-cycle-state derivation + STALE_CYCLE_MS into one @nestfolio/ui helper used by advisory-mfe + dashboard-mfe."
references: []
out_of_scope:
  - "Changing the 6-minute STALE_CYCLE_MS value itself — extract verbatim, do not retune."
  - "The dashboard transport/materialization residuals (dashboard-live-push-portfolio-summary, dashboard-live-push-position-snapshots, advisory-status-recompute-monotonic-version) — independent backlog items."
  - "advisory-mfe reconcile()/subscription plumbing + the get-pending-decisions.fn.js PENDING_STATUSES keep-in-sync note — untouched."
  - "Any new generating/failed product behavior — this is a behavior-preserving extraction (single-cycle case identical; the multi-concurrent-cycle staleness semantic is intentionally unified onto the dashboard's oldest-fresh rule)."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Extract shared advisory-cycle-state derivation into @nestfolio/ui

WS-3 put the generating/failed/stale derivation + `STALE_CYCLE_MS = 6 * 60 * 1000`
in `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts:181-208`.
WS-4 (`dashboard-generating-failed-reflection`) adds a second consumer
(`apps/dashboard-mfe/src/app/stores/dashboard.store.ts` + the
`advisory-cycle-status` component) and deliberately **duplicates** the constant +
derivation with a keep-in-sync note rather than refactor shipped WS-3 code.

Rule-of-three: extract `deriveAdvisoryCycleState({ generatingCount, failedCount,
oldestGeneratingAt, pendingDecisionsCount, now })` → `{ generating, failed }` plus
the `STALE_CYCLE_MS` ceiling into `@nestfolio/ui` (a shared lib both MFEs already
import), then point both surfaces at it and delete the two copies.

**Promoted 2026-06-05** (user direction) to remove the keep-in-sync duplication
and the `/advisory`↔`/dashboard` staleness-ceiling drift risk it carries — a single
`STALE_CYCLE_MS` source so the two surfaces cannot silently diverge — per the
reusable-patterns objective, without waiting for a third consumer.

Cheapest next step: add the pure helper + unit test in `@nestfolio/ui`, then swap
the two call sites (the advisory-mfe swap is the only touch into shipped WS-3 code
and should be validated by its existing component unit + the `/advisory`
Playwright scenario).
