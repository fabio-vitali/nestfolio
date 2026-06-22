---
id: deploy-tooling-integrity-leftovers
status: parking
type: epic
notes: "Auto-spun-out when the deploy-tooling-integrity delivery epic shipped (2026-06-22) with all 4 core members terminal and the targeted CDC contract-emission e2e green. Holds the genuinely-orthogonal captured member for later re-clustering by backlog-themes."
done_when: "Each residual finding spun out of the deploy-tooling-integrity epic is resolved, dropped, or re-clustered by backlog-themes into a sharper root-cause theme; all members shipped or dropped."
scope: "The genuinely-orthogonal captured finding surfaced alongside the deploy-tooling-integrity program: the detect-deploy true-affected resolver reverse-reaches THROUGH test-only libs (test-contracts / test-support / integration-testing), so a single real service src change fans out to the whole ~27-service closure — the traversal side of the harness-lib fan-out (the shipped member detect-deploy-fanout-and-empty-services fixed only the seed side)."
out_of_scope:
  - "Anything load-bearing for the deploy-tooling-integrity done_when — by construction none of these are: that epic's test-lib clause is the CHANGE/seed-exclusion (satisfied by detect-deploy-fanout-and-empty-services), whereas this residue is the orthogonal real-change-traversal-through-test-libs side."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# deploy-tooling-integrity — residual findings (leftovers)

Auto-spun-out when the `deploy-tooling-integrity` delivery epic shipped (2026-06-22) with all 4 core
members terminal and the targeted `(investor|execution|ledger)-contract-emission` CDC e2e green (3
suites / 13 tests). This is the **captured** member that rode along for unified session context but is
**genuinely orthogonal** to the epic's `done_when` — confirmed by the close-time captured audit: the
epic's test-lib clause is satisfied by `detect-deploy-fanout-and-empty-services` (the seed/CHANGE side),
and member 1's CDC INIT guard was proven a no-op in deployed dev (0 throws across 21 CDC Lambdas), so
the epic's done-definition holds without this traversal-side fix.

This is a **holding bucket pending re-clustering** by `backlog-themes`. Run `backlog-themes` to
redistribute (this residue may re-home onto a detect-deploy / true-affected-resolver tooling theme).

Members (derived from `epic:` pointers):
- `detect-deploy-test-lib-reverse-reach-fanout`
