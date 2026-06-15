---
id: c4-diagrams-stale-across-services
status: parking
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Pre-existing C4 diagram drift: regenerating from current code changes 16 services' c3 .d2 (e.g. broker-ctrl stale RouteOrderFn, fred-adpt stale fetch-trigger) — committed diagrams lag the CDK stacks. Surfaced 2026-06-15 by incident-escalation-path-b (whose own C4 regen was isolated to investor-ctrl/dashboard-bff/nestfolio.d2 to avoid bundling)."
---

# C4 diagrams are stale across ~16 services

## Evidence

Running `node tools/generate-c4-sources.mjs` from a clean tree on 2026-06-15 rewrote 18
`docs/architecture/c3/*.d2` files, but only 2 (investor-ctrl, dashboard-bff) corresponded to
the active workstream's code change. The other 16 changed because the committed diagrams lag
their service.stack.ts:

- `c3/broker-ctrl.d2` — still renders a `route-order-fn: Lambda [RouteOrderFn]` node that no
  longer exists in the stack.
- `c3/fred-adpt.d2` — still renders a `fetch-trigger: Lambda [FetchTrigger]` + `schedule -> fetch-trigger`
  edge that no longer exists.
- 14 others: advisory-bff, alpha-vantage-adpt, broker-alpaca-adpt, decision-workflow-ctrl,
  execution-ctrl, investor-profile-ctrl, ledger-bff, ledger-ctrl, market-intelligence-ctrl,
  marketwatch-adpt, onboarding-bff, portfolio-engine-ctrl, sec-edgar-adpt, yahoo-finance-adpt.

## Why parking (not folded)

`incident-escalation-path-b` deliberately isolated its own C4 regen (kept only `nestfolio.d2` +
`c3/investor-ctrl.d2` + `c3/dashboard-bff.d2` + the 4 derived SVGs; reverted the 16 unrelated
files) to avoid bundling unrelated drift into a single-concern workstream. This drift is prior
unshipped diagram debt from other services' code changes — genuinely unrelated.

## Done

- Run both C4 stages (`generate-c4-sources.mjs` + `generate-c4-diagrams.mjs`) from a clean tree,
  commit the full regenerated set, visually verify the SVGs.
- Consider a `check-c4-drift` gate (mirroring `check-service-card-drift.mjs`) so the diagrams
  can't silently drift again.

Promote during an architecture-doc freshness sweep, or when next regenerating C4 for a feature.
