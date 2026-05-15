---
id: scenario-12-rebalance-on-drift-missing-mandate-fixture
status: active
type: bug
notes: "e2e scenario 12 (rebalance-on-drift) fails: beforeEach fixtures [onboarded, funded, withHoldings] do not wait for MandateSnapshot projection before test body emits PORTFOLIO_DRIFT_DETECTED. SF LookupMandateSnapshot returns empty Item; $.Item.operatingMode.S JSONPath fails with States.Runtime. Reproduced 2026-05-16 (execution 6c4559d0). Applying dossier's proposed fix: add withLiveDecision() to beforeEach + drop stale advisory-ctrl from targetService."
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
validation_gate: null
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

## Why "queued" and not "active"

Single-file test fix; valid independent workstream but the architectural backlog-trap (rank 3) is higher value because it affects multiple scenarios and production behaviour.
