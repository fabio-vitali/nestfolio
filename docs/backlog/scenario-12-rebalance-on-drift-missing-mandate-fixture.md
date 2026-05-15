---
id: scenario-12-rebalance-on-drift-missing-mandate-fixture
status: shipped
type: bug
notes: "Fixed 2026-05-16. beforeEach now ends with withLiveDecision() so the natural MANDATE_ISSUED → projection → MANDATE_SNAPSHOT_CREATED chain completes before the test body emits PORTFOLIO_DRIFT_DETECTED. Also dropped the stale 'advisory-ctrl' from targetService (removed in Spec 2 2026-04-30). e2e re-run passed in 148s (previously failed at 240s timeout)."
references:
  - apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts
  - apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
out_of_scope:
  - "Changing the SF LookupMandateSnapshot to tolerate missing operatingMode (would mask a real propagation failure)"
  - "Restoring advisory-ctrl to satisfy stale test comment (advisory-ctrl removed in Spec 2, 2026-04-30)"
spec: null
plan: null
topic_memory:
  - project_e2e_feature_tests.md
  - project_investor_profile_collapse.md
validation_gate: "scenario 12 (rebalance-on-drift.e2e.test.ts) passed in 148s against deployed dev on 2026-05-16. Previously failed at the 240s waitForGraphQL timeout (SF execution 6c4559d0 errored at LookupMandateSnapshot with empty Item, JSONPath $.Item.operatingMode.S failure). The withLiveDecision() addition drives the first decision cycle to completion so the MandateSnapshot projection materialises before the drift event fires; the SF then finds the row and proceeds through the 4-agent pipeline."
---

# scenario-12 rebalance-on-drift: missing MANDATE_ISSUED fixture

## Context

Run on 2026-05-15 against deployed dev (post agent-pipeline-task-token-timeout-observability ship, commit 03d05b6f). Scenario 11 (`first-decision`) **passed** in 159s. Scenario 12 (`rebalance-on-drift`) **failed** at 240s `waitForGraphQL` timeout. `getDecisionHistory` returned exactly one item (`trigger=MANDATE_SNAPSHOT_CREATED, status=PENDING`) but never the expected `trigger=PORTFOLIO_DRIFT_DETECTED` decision.

## Root cause

SF execution for `PORTFOLIO_DRIFT_DETECTED` (run `87f7377c-42b1-aba7-b423-02aea03d6458`) reached `LookupMandateSnapshot` and `TaskSucceeded` (DDB getItem returned). The next step's JSONPath `$.Item.operatingMode.S` failed with `States.Runtime`:

```
The JSONPath '$.Item.operatingMode.S' specified for the field 'operatingMode.$'
could not be found in the input '{"SdkHttpMetadata":...
```

The DDB response had no `Item` field (empty result wrapped in the SDK envelope), so the JSONPath extraction failed.

Why empty? The test sets up the tenant with `[onboarded(), funded(), withHoldings()]` — none of those fixtures publish `MANDATE_ISSUED`, so the `mandate-projector` (in `decision-workflow-ctrl`) never materialises a `MandateSnapshot` row for this tenant. The subsequent `PORTFOLIO_DRIFT_DETECTED` SF trigger has no MandateSnapshot to read.

Compare scenario 11 (`first-decision.e2e.test.ts:41`) which uses `withLiveDecision()` — that fixture publishes `MANDATE_ISSUED` and the projection runs before the decision pipeline triggers. Scenario 11 works because of this; scenario 12 doesn't because the fixture is shaped for a pre-Phase-A world.

## Evidence

- SF arn: `arn:aws:states:us-east-1:771924376645:execution:dev-decision-workflow-ctrl-decisionstatemachine:87f7377c-42b1-aba7-b423-02aea03d6458_a22913a7-dd0e-cdcb-bc74-3627b5353141`
- Failed at: `#8 ExecutionFailed error=States.Runtime`
- Input excerpt: `{"id":"integ-...","type":"PORTFOLIO_DRIFT_DETECTED","subject":{"tenantId":"e2e-1778880847261-...","driftPercent":12.5,"positionsOutOfBand":[...]}}`
- Stale test comment in `rebalance-on-drift.e2e.test.ts:45–47`: "advisory-ctrl (subscribes via its own ingress and publishes the DecisionPacket...)" — advisory-ctrl was removed 2026-04-30 in Spec 2. The `targetService: ['advisory-ctrl', 'decision-workflow-ctrl']` works (helper fans out per-service entries) but the comment is misleading. Cleanup advisory: drop `'advisory-ctrl'` from the array — only `'decision-workflow-ctrl'` is needed.

## Proposed fix (when this is started)

1. In `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` `beforeEach`, add a `withLiveDecision()` step (or equivalent that emits `MANDATE_ISSUED`) AFTER `onboarded()` and BEFORE the drift trigger.
2. Wait for the resulting `MANDATE_SNAPSHOT_CREATED` decision to surface (this is the pre-condition).
3. Then emit `PORTFOLIO_DRIFT_DETECTED` and assert a second decision appears with that trigger.
4. Remove `'advisory-ctrl'` from `targetService` array (and update the stale comment).

## Ship (2026-05-16)

Applied the dossier's proposed fix verbatim:

- `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts`:
  - Imported `withLiveDecision`.
  - Appended `withLiveDecision()` to the `beforeEach` fixtures list (after `onboarded`/`funded`/`withHoldings`). Raised `beforeEach` timeout from 240s → 300s to fit the first decision cycle.
  - Dropped `'advisory-ctrl'` from `targetService` and rewrote the stale comment (advisory-ctrl was removed 2026-04-30 in Spec 2).

Validation: scenario 12 passed in 148s against deployed dev. Previous run (same commit, no fix) failed at the 240s timeout — SF execution `6c4559d0` errored at `LookupMandateSnapshot` with empty Item + JSONPath failure on `$.Item.operatingMode.S`, exactly as the dossier described.
