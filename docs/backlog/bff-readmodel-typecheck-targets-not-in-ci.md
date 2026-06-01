---
id: bff-readmodel-typecheck-targets-not-in-ci
status: queued
rank: 8
type: tooling
notes: "Per-service typecheck nx targets (the read-model ownership trip-wire) are not invoked by any CI workflow nor nx targetDefaults — they only fire when run by hand."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# Read-model ownership typecheck targets are not wired into CI

Surfaced during w4 ([[bff-readmodel-w4-investor-bff]]) code review.

The read-model ownership trip-wire (a `@ts-expect-error` type-test compiled by an
isolated `tsconfig.type-test.json`) is exposed per service as an nx `typecheck`
target: `investor-bff:typecheck`, `dashboard-bff:typecheck`, plus the library's
`event-processor:typecheck`. But **nothing in CI runs them**:

- The GitHub workflows run only `nx affected -t lint` and `-t test`.
- `nx.json` `targetDefaults` has no `typecheck` entry, so `nx affected -t typecheck`
  isn't part of any gate.
- ts-jest runs with `diagnostics: false` and ESLint is not type-aware, so a wrong
  intent×typename call is caught by NOTHING in CI.

Net: the ownership enforcement only fires when a dev runs the target by hand or
when the `/backlog-next` validation gate runs it explicitly (which is how w1–w4
shipped). The trip-wire is load-bearing only by convention, not mechanically.

This belongs to w6 governance/freeze (enforcement layer 4: "CI lint") and/or
`ci-pipeline-bring-up` (the CI pipeline has never produced a green run). Cheapest
fix once CI is green: register `typecheck` in `nx.json targetDefaults` and add a
`pnpm nx affected -t typecheck --base=origin/main` step to the PR workflow.
