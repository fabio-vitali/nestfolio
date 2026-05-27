---
id: playwright-rebalance-after-weight-drift-detector
status: parking
type: tooling
notes: "Re-add Playwright rebalance coverage on top of a real organic trigger once weight-drift-detector ships. Deleted 2026-05-27 in playwright-rebalance-real-agents-maxvms-remediation as speculative coverage of a not-yet-built production feature."
references:
  - path: docs/backlog/weight-drift-detector.md
  - path: docs/backlog/playwright-rebalance-real-agents-maxvms-remediation.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# playwright-rebalance-after-weight-drift-detector

## Promotion trigger
Promote to QUEUED when weight-drift-detector ships (status: shipped). At that point the production code can emit PORTFOLIO_DRIFT_DETECTED from a real path (e.g., second deposit changes weights enough → detector fires → DWC SF starts → rebalance decision). Until then this is parking per backlog rule 8 (parking entries carry unmet trigger language).

## What to do when promoted
Most likely shape: extend journeys/new-investor-happy-path.spec.ts with a second-deposit + wait-for-organic-rebalance arm, rather than re-introducing a scenarios/ file with synthetic injection. Matches the journeys/scenarios philosophy in apps/nestfolio-e2e/CLAUDE.md.

But the actual shape is a design decision for that future workstream — this is just a placeholder.

## Original test location (deleted)
- File: apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts
- Fixture: apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts
- Last seen at SHA: `3db7e1b0575be93964add38b5ee4e26b6bcf7770`
- Deleted by commit: `a2ef6918`

## Related
- Blocked by: weight-drift-detector
- Origin: playwright-rebalance-real-agents-maxvms-remediation
