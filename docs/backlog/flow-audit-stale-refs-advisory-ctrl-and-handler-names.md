---
id: flow-audit-stale-refs-advisory-ctrl-and-handler-names
status: queued
type: refactor
rank: 4
notes: "Stale references surfaced by the 2026-06-14 flows-vs-code audit (orthogonal to the flow specs themselves — touches test comments + a service card only): 2 e2e tests still comment 'advisory-ctrl' (removed Spec 2) for what is now decision-workflow-ctrl; reconciliation-ctrl CLAUDE.md card names removed handlers reconcileHandler/alpacaSnapshotHandler (real code is a createHandlers factory). Doc/comment cleanup; likely partly auto-caught by service-card-drift-gate."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Stale advisory-ctrl comments + reconciliation-ctrl card handler names

Surfaced by the 2026-06-14 flows-vs-code audit. These touch test comments + a service card only —
**not** any flow spec — so they do not affect the regenerated `docs/data-flows/`. Filed for
completeness so "the flows + their surrounding artifacts carry no stale references."

## Evidence

- `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts` (comments ~35/103/117)
  and `.../rebalance-on-drift.e2e.test.ts` reference the removed `advisory-ctrl` service — should read
  `decision-workflow-ctrl` (advisory-ctrl was removed in Spec 2, 2026-04-30).
- `services/ledger/reconciliation-ctrl/CLAUDE.md` Handlers section names `reconcileHandler` /
  `alpacaSnapshotHandler`, but the real code uses an anonymous `createHandlers()` factory map
  (`src/handlers/event-listener.ts:167`) with inline per-event registration (cache-and-compare).

## Done

1. Update the two e2e test comments to `decision-workflow-ctrl`.
2. Regenerate the reconciliation-ctrl service card via `audit-service` — the just-shipped
   `service-card-drift-gate` Handlers diff likely already flags the stale handler names; reconcile
   through that gate so it stays green.
