---
id: detect-deploy-accuracy
status: parking
type: epic
notes: "detect-deploy accuracy theme: detect-deploy-needed.mjs produces wrong deploy verdicts — it reverse-reaches THROUGH test-only libs (over-fan-out) and lacks a scripts/ Tier-0 rule (over-deploy default). Theme epic, 2 members. Renamed 2026-06-29 by backlog-themes from the provenance name `deploy-tooling-integrity-leftovers` (a coherent theme that had kept its leftovers shell-name; rename-in-place dissolved the last `*-leftovers` bucket)."
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

# detect-deploy accuracy

Root cause: the `detect-deploy-needed.mjs` deploy-classification resolver emits **wrong deploy
verdicts** in two ways. This theme began life as the auto-spun-out leftovers bucket of the
`deploy-tooling-integrity` delivery epic (shipped 2026-06-22, 4 core members terminal + the
`(investor|execution|ledger)-contract-emission` CDC e2e green); its body invited a `backlog-themes`
re-home "onto a detect-deploy / true-affected-resolver tooling theme." That re-clustering happened
2026-06-25 (the orphan `detect-deploy-scripts-tier0` shares the same root cause and joined), turning
the provenance bucket into a coherent detect-deploy-accuracy theme — but it kept its
`*-leftovers` shell name. A `backlog-themes` sweep **renamed it in-place** to `detect-deploy-accuracy`
on 2026-06-29 (rename-in-place disposition: the whole bucket already cohered as one theme, so it lives
on under the real name rather than dissolving into orphans), retiring the last lingering
`*-leftovers` bucket. Both members are **core** to this theme's done-definition.

Both members produce a wrong verdict, but in opposite directions — one **over-fans-out** (a real src
change reverse-reaches through test-only libs to the whole closure) and one **over-deploys** (an
unclassified `scripts/` path defaults to deploy=true). Neither was load-bearing for the shipped
`deploy-tooling-integrity` done_when (the epic's test-lib clause is the seed/CHANGE side, satisfied by
`detect-deploy-fanout-and-empty-services`; the CDC INIT guard was a proven no-op in deployed dev).

Members (derived from `epic:` pointers):
- `detect-deploy-test-lib-reverse-reach-fanout` (traversal reverse-reaches THROUGH test-only libs → over-fan-out to ~27 services)
- `detect-deploy-scripts-tier0` (TIER0 lacks a `/^scripts\//` rule → top-level `scripts/` changes hit the conservative unknown-path deploy=true default)
