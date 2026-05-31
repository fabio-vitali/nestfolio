---
id: e2e-feature-advisory-fixtures-w3-contract
status: shipped
rank: 1
type: refactor
notes: "Synthetic Jest e2e advisory fixtures (withDecision) encode the pre-w3 producer-owned model; accept/reject-decision red post-w3. Rework for versioned producer-owned contract."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md, project_e2e_feature_tests.md]
validation_gate: "Simple lane on main (test-only; no deploy — services already carry the shipped w3 contract). nx affected -t test,lint --base=origin/main → 0 errors (lint clean; the 19 pre-existing no-explicit-any warnings in test/helpers/*.test.ts untouched). tsc --noEmit -p apps/e2e-feature-tests → clean (also removed a pre-existing latent TS6133 unused-`ctx` error in the onboarded() fixture, in-file). Scoped e2e GREEN against deployed dev: NODE_OPTIONS=--experimental-vm-modules NESTFOLIO_INTEG_PREFIX=dev pnpm jest --config apps/e2e-feature-tests/jest.config.js --runInBand --testPathPatterns 'advisory/(accept-decision|reject-decision|view-decision-explanation)' → 3 suites / 3 tests passed (accept-decision 125s, reject-decision 33s, view-decision-explanation 20s). first-decision excluded (uses withLiveDecision; unaffected by withDecision). NOTE: first scoped run was a quote-stripping false-green via the nx wrapper (the (a|b|c) regex hit /bin/sh subshell parsing and jest never ran); re-run direct via jest with quoted pattern."
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

## Shipped (2026-05-31)

Took **Fix option 1** (synthetic producer) — the dominant choice: option 2 (drive
the real SF + task-token loop) is redundant with the Playwright
`new-investor-happy-path` full-pipeline confirm coverage + `first-decision`
(`withLiveDecision`), and far more expensive/flaky.

- `apps/e2e-feature-tests/src/helpers/fixtures.ts` — `withDecision` now emits a
  **versioned** `DECISION_PACKET_CREATED` (`__version: 1`, `status: PENDING`,
  timestamps) so the post-w3 `decision-snapshot` transform's `projectVersioned`
  guard can evaluate and materialize the `DecisionReadModel` row. Added a
  reusable `emitDecisionSnapshot(eb, tenant, {…})` helper that models the
  producer (decision-workflow-ctrl) emitting a higher-versioned terminal
  snapshot; re-exported from `src/index.ts` with shared `DecisionTrigger` /
  `ProposedTrade` types.
- `advisory/accept-decision.e2e.test.ts` — confirm assertion changed from the
  stale `confirm.confirmDecision.status === 'CONFIRMED'` (the resolver is
  intent-only post-w3 and returns the PENDING readback row) to asserting the
  mutation ran; then emits a terminal `DECISION_PACKET_UPDATED` (v2/CONFIRMED)
  and re-queries → CONFIRMED. **Kept** the unique cross-service value
  (`ORDER_FILLED` → ledger `getPortfolio` VTI qty > 0) that the rewritten
  advisory-bff integration suite does NOT cover.
- `advisory/reject-decision.e2e.test.ts` — same pattern; terminal v2/REJECTED
  snapshot carries `rejectionReason`, read back via `getDecision`.
- `advisory/view-decision-explanation.e2e.test.ts` — **no body change**; the
  `withDecision __version:1` fix alone makes its `getDecision != null` poll pass.
- `first-decision.e2e.test.ts` — **unaffected** (uses `withLiveDecision`,
  driving the real pipeline); not in scope.

Mirrors the synthetic-producer pattern proven in
`services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`
(emit CREATED `__version:1` → emit UPDATED higher-`__version` terminal → mutation
asserts intent row + CDC). The version guard makes the CREATE→UPDATE sequence
order-safe by construction.
