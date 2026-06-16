---
id: flow-audit-stale-refs-advisory-ctrl-and-handler-names
status: shipped
type: refactor
closed: 2026-06-16
notes: "Stale references surfaced by the 2026-06-14 flows-vs-code audit (orthogonal to the flow specs themselves — touches test comments + a service card only): 2 e2e tests still comment 'advisory-ctrl' (removed Spec 2) for what is now decision-workflow-ctrl; reconciliation-ctrl CLAUDE.md card names removed handlers reconcileHandler/alpacaSnapshotHandler (real code is a createHandlers factory). Doc/comment cleanup; likely partly auto-caught by service-card-drift-gate."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: |
  Shipped 2026-06-16 (main 4892aa7a), Simple lane (comment + service-card doc
  only, no deploy). reconciliation-correction.e2e.test.ts: 3 comments that
  described the CURRENT PORTFOLIO_DRIFT_DETECTED path as flowing through the
  removed advisory-ctrl (Spec 2, 2026-04-30) rewritten to the real path —
  direct EB→Step Function trigger on decision-workflow-ctrl (verified against
  service.stack.ts:167 "Direct EB → SF" + TRIGGER_EVENT_TYPES). CORRECTION to
  the filed evidence: rebalance-on-drift.e2e.test.ts's lone advisory-ctrl
  mention (line 60) is a CORRECT historical "(advisory-ctrl was removed
  2026-04-30 in Spec 2.)" note whose surrounding comment already names
  decision-workflow-ctrl — left intact (swapping it would have made it falsely
  claim decision-workflow-ctrl was removed). reconciliation-ctrl/CLAUDE.md
  Handlers section: fabricated reconcileHandler/alpacaSnapshotHandler names
  replaced with the real createHandlers() factory + inline per-event
  cache-and-compare registration (event-listener.ts:167). CORRECTION to the
  filed guess: the service-card-drift gate did NOT flag this — extractHandlers
  diffs handler FILENAMES (entry: in the stack), not prose function names — so
  the stale names were invisible to it; gate confirmed green (0 drift) before
  and after. Verify: affected test+lint green (reconciliation-ctrl 41/41;
  e2e-feature-tests/nestfolio-e2e lint pass, pre-existing no-explicit-any
  warnings only); detect-deploy-needed=skip; card-drift gate green.
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
