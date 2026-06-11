---
id: portfolio-rebalance-flow-spec-precomputation-stale
status: parking
type: bug
notes: "Pre-existing flow-spec drift surfaced 2026-06-11 while doing the advisory-agent-event-contract-coverage stop-emit doc-derivation. flows/portfolio-rebalance.flow.yaml documents the LEGACY per-cycle agent-invocation architecture that the precomputation rewrite REMOVED: Step 4a has investor-profile-ctrl `receives: ANALYZE_INVESTOR_PROFILE` and market-intelligence-ctrl `receives: ANALYZE_MARKET` (lines ~60-75), but ANALYZE_INVESTOR_PROFILE / ANALYZE_MARKET / INVESTOR_PROFILE_COMPLETED / MARKET_ANALYSIS_COMPLETED were DELETED (decision-workflow-ctrl card 'Removed (Task 11)'; IP/MI now precompute InvestorProfileSnapshot/MarketSnapshot out-of-cycle and the SF reads them via Direct DDB GetItem — they are no longer invoked per decision cycle). The CURRENT canonical advisory flow is flows/advisory-cycle.flow.yaml (post-precomputation, with SnapshotProjectorIngress + Direct EB->SF). So portfolio-rebalance.flow.yaml is broadly superseded, NOT just touched by stop-emit. Because it is already incoherent (describes a non-existent trigger path), the typed-subject workstream did NOT piecemeal-edit its stop-emitted-event lines (GOAL_INTERPRETATION_PRODUCED line ~66, MARKET_SIGNAL_DETECTED line ~75, PORTFOLIO_CONSTRUCTION_PROPOSED + REBALANCE_PLAN_PRODUCED line ~85) — those stopped events live inside steps that themselves no longer exist. Fix = a proper validate-flow / generate-flow-spec refresh of portfolio-rebalance against current code (or decide it is fully superseded by advisory-cycle and remove/redirect it). NOT caused by the typed-subject workstream; the precomputation rewrite left it stale. Promote during a flow-spec audit or when next relying on portfolio-rebalance.flow.yaml. (market-data-ingestion.flow.yaml + advisory-cycle.flow.yaml WERE updated by the typed-subject workstream — they were current.)"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# portfolio-rebalance.flow.yaml documents the removed pre-precomputation architecture

`flows/portfolio-rebalance.flow.yaml` predates the precomputation rewrite. Its Step 4a has
`investor-profile-ctrl receives: ANALYZE_INVESTOR_PROFILE` and
`market-intelligence-ctrl receives: ANALYZE_MARKET` — but those trigger events were **deleted**
(IP/MI now precompute snapshots out-of-cycle; the SF reads them via Direct DDB GetItem). The
current canonical advisory decision flow is `flows/advisory-cycle.flow.yaml`.

The typed-subject stop-emit workstream (`advisory-agent-event-contract-coverage`) deliberately did
**not** piecemeal-edit this spec's stopped-event `emits:` lines (`GOAL_INTERPRETATION_PRODUCED`,
`MARKET_SIGNAL_DETECTED`, `PORTFOLIO_CONSTRUCTION_PROPOSED`, `REBALANCE_PLAN_PRODUCED`) because they
sit inside steps that no longer exist in the code — editing them would be lipstick on a
superseded flow.

## Fix

Run `validate-flow portfolio-rebalance` (or `generate-flow-spec`) to re-derive it against current
code, OR decide it is fully superseded by `advisory-cycle.flow.yaml` and remove/redirect it. The
stop-emitted telemetry events fall out naturally once the spec is re-derived from current code.
