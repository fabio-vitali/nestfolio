---
id: advisory-empty-state-pending-decisions-count
status: queued
rank: 3
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "UX bug — empty state shown when pendingDecisionsCount > 0 and list is lagging."
---

# `/advisory` shows empty state when `pendingDecisionsCount > 0` and the list query is empty

UX bug. Real users clicking the dashboard alert immediately can hit this when the agent pipeline (advisory-bff projection) lags the dashboard counter by 30–75s. Surfaced 2026-05-02 during Pattern B Step 9 e2e gate (Run 3 fail). Patched test-side via `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` Step 8 wait. Proper fix: when `dashboard.pendingDecisionsCount() > 0` AND `decisions().length === 0`, show a loading shimmer / "agent is generating recommendations…" instead of `advisory.list.emptyTitle`. Touch points: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts` template @if branches + read of dashboard count via shared store or fresh query. Promote when the test-side patch becomes load-bearing in CI or user-testing surfaces the empty-state confusion.
