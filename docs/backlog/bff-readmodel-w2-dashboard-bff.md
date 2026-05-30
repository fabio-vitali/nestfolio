---
id: bff-readmodel-w2-dashboard-bff
status: shipped
rank: 2
type: refactor
requires_deploy: true
out_of_scope:
  - "Live-push transport for the dashboard rows — the deferred dashboard-live-push-portfolio-summary / -position-snapshots items; rebuilt on the clean read model afterward (spec §Out of scope)."
  - "advisory DecisionPacket versioned snapshots + retiring the advisory-bff attribute_exists band-aid — that is workstream 3."
  - "investor-bff CashBalance P1 + command-row confirmation — workstream 4."
  - "Externally-settled Deposit/Withdrawal ownership + intent events — workstream 5 (cross-domain, last)."
  - "Governance/freeze enforcement layers 3+4 (skill/audit/CI drift checks) — workstream 6; only the dashboard-bff typename registration in ReadModelOwnership lands here."
  - "Re-sourcing AdvisoryStatus from advisory-owned decision rows beyond what dashboard-bff can compute today — deeper decision-row ownership is workstream 3; here AdvisoryStatus becomes a P3 derived aggregate over rows dashboard already projects."
notes: "Workstream 2 of bff-read-model-materialization-redesign: dashboard-bff P1 projections for PortfolioSummary/PositionSnapshot/InvestorSnapshot from authoritative snapshots; AdvisoryStatus count → P3; delete dead SimulationSummary/StreamSnapshot. Dissolves structural-zeros + totalValueCents double-count. Unblocks the deferred dashboard-live-push-* transport items."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: docs/superpowers/plans/2026-05-30-bff-readmodel-w2-dashboard-bff.md
topic_memory: [project_read_model_redesign.md]
validation_gate: |
  Shipped 2026-05-30 on branch worktree-bff-readmodel-w2-dashboard-bff (commits 6cedf2d3..HEAD).
  PortfolioSummary + PositionSnapshot migrated to version-guarded P1 projectVersioned from the
  authoritative ledger snapshot (cashBalanceCents/positionCount structural zeros + totalValueCents
  double-count dissolved by construction); ReadModelOwnership registers both P1 + Activity P2;
  dead SimulationSummary/StreamSnapshot writers deleted; driftPercent + `|| 0` read-resolver
  papering removed (bff schema/resolver + dashboard-mfe KPI card).
  - Unit: dashboard-bff 50/50, dashboard-mfe 75/75; `pnpm nx affected -t test,lint --base=origin/main` green.
  - Deploy: `deploy.sh sandbox --prefix=dev --services=dashboard-bff` exit 0.
  - Integration: `dashboard-bff:test-integration` 24/24 across both files, 2 consecutive runs, no flakes
    (projection math verified: 80000 + 10*$160*100 = 240000 @ __version 42; 50000 + 20*$320*100 = 690000).
  - Scoped e2e (deployed dev): `e2e-feature-tests withdraw-cash` 1/1 (68s) — only Jest scenario routing
    through deployed dashboard-bff. Playwright happy-path (KPI-card UI surface) intentionally not run
    per closing-phase rule + user decision; pure-projection render path, low risk.
  Carry-overs: InvestorSnapshot→P1 deferred to w4, AdvisoryStatus→P3 deferred to w3 (both documented in
  their dossiers + unregistered); orphan-position-on-sell filed (dashboard-position-orphan-on-sell).
---

# Workstream 2 — dashboard-bff

Materialize dashboard read rows as proper P1/P3 projections, dissolving the
structural-zero + double-count bug faces by construction.

## Scope / deliverables
- `PortfolioSummary`, `PositionSnapshot`, `InvestorSnapshot` → P1 versioned
  projections (`projectVersioned`) from authoritative ledger/investor snapshots,
  full-row writes that fix the `cashBalanceCents`/`positionCount` structural
  zeros and the `totalValueCents` double-count (no more `accumulate`).
- `AdvisoryStatus` in-flight count → P3 derived aggregate (computed over
  owned/authoritative rows — not `accumulate`d across disparate trigger events).
- Delete the dead `SimulationSummary` / `StreamSnapshot` writers (no callers).
- Register dashboard-bff typenames in `ReadModelOwnership`.

## Done
dashboard rows are P1/P3; structural-zero + double-count bugs gone; the `|| 0`
read-resolver papering removed; `event-processor:typecheck` + integration green;
deploy + scoped dashboard e2e green. This clears the way for the deferred
`dashboard-live-push-portfolio-summary` / `-position-snapshots` transport items.

## Rollout context
Rank 2 (see spec §"Decomposition"). See [[project_read_model_redesign]].
