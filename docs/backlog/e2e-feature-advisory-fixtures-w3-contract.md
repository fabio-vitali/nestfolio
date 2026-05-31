---
id: e2e-feature-advisory-fixtures-w3-contract
status: queued
rank: 4
type: refactor
notes: "Synthetic Jest e2e advisory fixtures (withDecision) encode the pre-w3 producer-owned model; accept/reject-decision red post-w3. Rework for versioned producer-owned contract."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md, project_e2e_feature_tests.md]
validation_gate: null
---

# e2e-feature advisory fixtures — align with the w3 producer-owned/versioned contract

After `bff-readmodel-w3-advisory-decision-packet` shipped, the synthetic Jest e2e
advisory scenarios in `apps/e2e-feature-tests/src/advisory/` fail against deployed dev
because their shared fixture encodes the **pre-w3** model. This is NOT a product defect —
the real production path is proven GREEN by the Playwright `new-investor-happy-path`
journey (full SF + versioned projection) and the rewritten advisory-bff integration
suite on deployed dev. It is the synthetic Jest harness that is now stale.

## Root cause (verified 2026-05-31)
`apps/e2e-feature-tests/src/helpers/fixtures.ts` `withDecision()` (lines 31–51) publishes
a synthetic `DECISION_PACKET_CREATED` to advisory-bff that:
1. carries **no `__version`** — w3's `decision-snapshot` projects via
   `projectVersioned(…, { version: subject.__version })`; with `version: undefined`
   the executor's guard `attribute_not_exists(pk) OR attribute_not_exists(#__version)
   OR #__version < :version` cannot evaluate, so **no DecisionReadModel row materializes**
   → `accept-decision.e2e.test.ts:47` (the `getDecision != null` poll) times out (~97s).
2. assumes the **confirm resolver writes the terminal status onto the projection row**.
   w3 made confirm/reject intent-only (they write only `UserConfirmation`/`UserRejection`
   + emit `USER_CONFIRMED`/`USER_REJECTED`); the terminal status now arrives only via the
   producer's (decision-workflow-ctrl) versioned snapshot. In the synthetic path there is
   no real DWC `DecisionPacket` row + SF behind the injected decision, so nothing drives
   the row to CONFIRMED/REJECTED. The assertions `confirm.confirmDecision.status ===
   'CONFIRMED'` (accept:69) and `reject.rejectDecision.status === 'REJECTED'` (reject:60)
   no longer hold.

## Affected scenarios
- `advisory/accept-decision.e2e.test.ts` (RED — materialization timeout + stale assertion)
- `advisory/reject-decision.e2e.test.ts` (same class; not re-run after the accept failure)
- `advisory/view-decision-explanation.e2e.test.ts` + `advisory/first-decision.e2e.test.ts`
  likely only need the row to materialize (add `__version` to `withDecision`) — verify.

## Fix options (decide in the workstream)
1. **Minimal/safe:** add `__version: 1` to `withDecision()` so rows materialize again
   (unblocks the non-confirm scenarios), then rewrite accept/reject to the w3 synthetic
   model: confirm/reject → assert the `UserConfirmation`/`UserRejection` intent row +
   `USER_CONFIRMED`/`USER_REJECTED` CDC, then publish a synthetic terminal
   `DECISION_PACKET_UPDATED` (higher `__version`, status CONFIRMED/REJECTED) to model the
   producer's snapshot, then re-query → terminal status. (Mirrors the rewritten
   advisory-bff integration suite; somewhat redundant with it.)
2. **Fuller:** drive the real producer — seed decision-workflow-ctrl's `DecisionPacket`
   row + run the SF so confirm closes the real task-token loop. Heavier; intersects the
   known sandbox pipeline-trigger gap ([[project_pipeline_trigger_gap]]).

Cost note: `accept-decision` `beforeEach` runs real `onboarded()` (onboarding LLM) →
each iteration is ~100s+ and incurs real Bedrock cost; budget reruns deliberately
([[feedback_e2e_cost_conscious]]).

See [[project_read_model_redesign]] (w3) + [[project_e2e_feature_tests]].
