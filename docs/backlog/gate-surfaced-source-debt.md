---
id: gate-surfaced-source-debt
status: parking
type: bug
notes: "Pre-existing source violations surfaced when the runtime gate first fired: no-ddb-scan (4), no-ddb-seed (11), no-states-runtime-catch (1)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-gate-baseline-debt
epic_role: core
---

# Gate-surfaced source debt (content-ring invariants never previously enforced)

Firing the runtime pre-commit gate for the first time (`runtime-make-it-fire`) surfaced real, pre-existing
violations of content-ring invariants that existed only as **unwired** `tools/check-*.mjs` and never ran at
commit time — so the tree accreted debt. Diff-scoping means these no longer block unrelated commits, but a
whole-tree/`--on=merge` audit still flags them, and they are genuine. Root cause is shared: enforcement was
authored but not fired.

**`no-ddb-scan` — FilterExpression on a GSI key attribute (4):**
- `services/advisory/advisory-bff/src/repositories/advisory.repository.ts:79` — `__typename`
- `services/advisory/advisory-bff/src/repositories/advisory.repository.ts:134` — `__typename`
- `services/execution/broker-alpaca-adpt/src/repositories/transfer-mapping.repository.ts:37` — `tenantId`
- `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:231` — `tenantId`

**`no-states-runtime-catch` — a SF Catch/Retry on `States.Runtime` (1, uncatchable per `feedback_states_runtime_uncatchable`):**
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:721`

**`no-ddb-seed-in-integration` — DdbSeedFixture / direct PutItem in integration tests (11):**
- `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:14,170` (DdbSeedFixture)
- `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts:14,190` (DdbSeedFixture)
- `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts:430` (PutItem)
- + 6 more — run `node tools/check-no-ddb-seed-in-integration.mjs` for the full list.

**Cheapest next step:** run each `tools/check-*.mjs` for the current list, then remediate per rule (GSI query + BatchGet instead of FilterExpression; Choice-on-isPresent instead of `States.Runtime` Catch; fixtures via events/mutations instead of DDB seeding — all per existing `feedback_*` dossiers). Candidate for a `backlog-themes` cluster with any other enforcement-debt orphans.


## Baseline ratchet installed (2026-07-04, runtime-seam-probe)

The item start-gate made this debt BLOCKING for every workstream (global invariants ride all gates
whole-scope), so a baseline-exclusion ratchet was installed: every current violation site is listed in
its check's sidecar (`tools/{ddb-scan,ddb-seed,states-runtime,unsafe-cast,agent-result-fallback}-exclusions.json`),
each entry annotated with this item's id. **Expanded inventory at baseline:** no-ddb-scan 4 (3 files),
no-ddb-seed 11 (6 files), no-states-runtime-catch 1, **no-unsafe-casts 125 (72 files — newly inventoried,
much larger than first filed)**, no-agent-result-fallback true-positives (post-narrowing baseline, see
`no-agent-result-fallback-check-overbroad`).

**Removal contract (binding):** fixing a file ⇒ DELETE its exclusion entry in the same commit, so the
check re-covers it. This item is done only when all five sidecars carry zero entries tagged with this id.
