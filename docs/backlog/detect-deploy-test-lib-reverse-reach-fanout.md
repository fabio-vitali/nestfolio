---
id: detect-deploy-test-lib-reverse-reach-fanout
status: parking
type: tooling
notes: "detect-deploy resolver reverse-reaches THROUGH test-only libs, so a single real service src change fans out to all ~27 services (broker-ctrl → test-contracts → test-support → every service). Pre-existing; same root cause as the harness-lib seed fan-out."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: detect-deploy-accuracy
epic_role: core
---

# detect-deploy: prune test-only libs from the deploy-affected closure

The true-affected resolver used by `detect-deploy-needed.mjs` reverse-reaches **through test-only
libs** (`test-contracts`, `test-support`, `integration-testing`), which every service transitively
links for its integration tests. So a single real **service** `src/**` change explodes to the whole
~27-service closure:

```
broker-ctrl change → reverse-deps {execution-adpt, e2e-feature-tests, test-contracts}
  → test-contracts → test-support → every service
```

Measured 2026-06-22 against the live nx graph: `services/execution/broker-ctrl/src/x.ts` resolves to
all 27 services (and the **old** `affectedProjects(... type:'app').filter(root.startsWith('services/'))`
filter returned the same 27 — so this is **pre-existing**, NOT introduced by
`detect-deploy-fanout-and-empty-services`, which fixed the harness-lib **seed** + frontend halves only).

Same root cause as the harness-lib seed fan-out (`detect-deploy-fanout-and-empty-services`): **test
libs are never deployed yet sit in the deploy closure as reverse-reachability bridges.** That member
fixed the *seed* side (a test-lib change no longer seeds the resolver); this one is the *traversal*
side (a real change must not flow THROUGH test libs to unrelated services).

## Why captured (not core) of `deploy-tooling-integrity`

The epic `done_when` covers (a) test-only/harness-lib **change** exclusion and (b) frontend/lib
non-empty target — both satisfied by `detect-deploy-fanout-and-empty-services`. A real **service**
change over-fanning-out falsifies neither clause, so this rides along orthogonally.

## Fix (cheapest next step)

Prune deploy-inert (test/e2e) projects from the deploy-closure graph **locally** in
`resolveDeployServices` — e.g. build a deploy-scoped graph view that drops `test-support`,
`integration-testing`, `test-contracts`, and the e2e apps (and their edges) before running
`affectedProjects`. **Do NOT** change the shared `tools/affected-projects.mjs`: it must keep test
libs so `test-integration` affected-resolution (Step 6.2/6.4) still re-runs harness-dependent suites.
Needs a regression test (single service src change → just that service + its real cross-domain
contract importers, no test-lib bridge).
