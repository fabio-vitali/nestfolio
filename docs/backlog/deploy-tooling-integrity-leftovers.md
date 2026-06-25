---
id: deploy-tooling-integrity-leftovers
status: parking
type: epic
notes: "detect-deploy accuracy theme (re-clustered 2026-06-25 from the deploy-tooling-integrity leftovers bucket per its own re-home note): detect-deploy-needed.mjs produces wrong deploy verdicts — it reverse-reaches THROUGH test-only libs (over-fan-out) and lacks a scripts/ Tier-0 rule (over-deploy default). Theme epic, 2 members."
done_when: "Each detect-deploy-needed.mjs accuracy gap is resolved or dropped so the resolver's deploy verdicts match reality — the test-lib reverse-reach over-fan-out and the missing scripts/ Tier-0 classification; all members shipped or dropped."
scope: "Accuracy gaps in the detect-deploy-needed.mjs deploy-classification resolver that produce wrong deploy verdicts: (1) the true-affected resolver reverse-reaches THROUGH test-only libs (test-contracts / test-support / integration-testing), so a single real service src change fans out to the whole ~27-service closure (the traversal side; the shipped detect-deploy-fanout-and-empty-services fixed only the seed side); (2) TIER0 lacks a scripts/ rule, so top-level scripts/ changes hit the conservative unknown-path deploy=true default and must be agent-overridden every close."
out_of_scope:
  - "Anything load-bearing for the deploy-tooling-integrity done_when — by construction none of these are: that epic's test-lib clause is the CHANGE/seed-exclusion (satisfied by detect-deploy-fanout-and-empty-services), whereas this residue is the orthogonal real-change-traversal-through-test-libs side."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# detect-deploy accuracy (ex deploy-tooling-integrity leftovers)

Root cause: the `detect-deploy-needed.mjs` deploy-classification resolver emits **wrong deploy
verdicts** in two ways. Originally this file was the auto-spun-out leftovers bucket of the
`deploy-tooling-integrity` delivery epic (shipped 2026-06-22, 4 core members terminal + the
`(investor|execution|ledger)-contract-emission` CDC e2e green); its body invited a `backlog-themes`
re-home "onto a detect-deploy / true-affected-resolver tooling theme." That re-clustering happened
2026-06-25: the orphan `detect-deploy-scripts-tier0` shares the same root cause and joins here, turning
the provenance bucket into a proper detect-deploy-accuracy theme.

Both members produce a wrong verdict, but in opposite directions — one **over-fans-out** (a real src
change reverse-reaches through test-only libs to the whole closure) and one **over-deploys** (an
unclassified `scripts/` path defaults to deploy=true). Neither was load-bearing for the shipped
`deploy-tooling-integrity` done_when (the epic's test-lib clause is the seed/CHANGE side, satisfied by
`detect-deploy-fanout-and-empty-services`; the CDC INIT guard was a proven no-op in deployed dev).

Members (derived from `epic:` pointers):
- `detect-deploy-test-lib-reverse-reach-fanout` (traversal reverse-reaches THROUGH test-only libs → over-fan-out to ~27 services)
- `detect-deploy-scripts-tier0` (TIER0 lacks a `/^scripts\//` rule → top-level `scripts/` changes hit the conservative unknown-path deploy=true default)
