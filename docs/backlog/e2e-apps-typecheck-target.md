---
id: e2e-apps-typecheck-target
status: parking
type: tooling
notes: "The two e2e apps (apps/e2e-feature-tests, apps/nestfolio-e2e) have NO `typecheck` nx target (only test/lint/e2e), unlike the 14 services/libs that do. So a shared-contract rename that breaks e2e SPECS is not caught by the cumulative branch typecheck — it slips to the expensive E6 run. Spun out 2026-06-22 as the out-of-epic-scope residual of F-21 (ship-and-merge-mechanics): the in-scope skill-side gate (cumulative typecheck on shared-surface touch) shipped in backlog-skills-hardening; this app-tooling half is orthogonal to that epic's skill-workflow scope. Promote when touching e2e-app tooling or doing a typecheck-coverage sweep."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typecheck-diagnostics-masking
epic_role: core
---

# Add a `typecheck` target to the e2e apps

## Problem

`apps/e2e-feature-tests` and `apps/nestfolio-e2e` expose only `test-e2e-features`/`e2e`/`e2e-ui` + `lint`
targets — **no `typecheck`**. The 14 services/libs that carry a `typecheck` target are covered by the
`/backlog-next-epic` E4.3 cumulative-branch-typecheck gate (F-21), but the e2e apps are not, so a
shared-contract rename (e.g. `quantity → amountCents`) that breaks an e2e *spec* compiles-clean at the
member boundary and only fails at the expensive E6 Playwright/Jest-e2e run — exactly the late-surfacing
the F-21 gate was meant to prevent.

## Fix sketch

Add a standard `typecheck` target (matching the 14 existing `project.json` definitions — `tsc --noEmit`
over the project's `tsconfig`) to both e2e apps, ensuring their spec files are in the typecheck program.
Then the F-21 gate's `nx run-many -t typecheck -p <branch-affected>` naturally covers e2e specs too.

## Why parked (not in backlog-skills-hardening)

This is **e2e-app tooling**, not `/backlog-next-epic`/`/backlog-next` skill-workflow logic — the same
scope line that homed F-1/F-2/F-3 (deploy-tooling) outside the skills epic. The skill-side gate (F-21a)
shipped with `ship-and-merge-mechanics`; this app-side half is its orthogonal residual.
