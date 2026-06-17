---
id: operating-mode-authority-e2e-recommendation-fixture
status: queued
rank: 1
type: bug
epic: typed-test-fixtures
epic_role: core
notes: "operating-mode-authority e2e RECOMMENDATION_PROPOSED is co-wrong (flat detail, missing isInitialBuild/riskCategory) → compliance-ctrl rejects it → no ComplianceCheck → all 3 cases timeout (blocks e2e green)"
references:
  - apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
  - services/advisory/decision-workflow-ctrl/src/domain/contracts.ts
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# operating-mode-authority e2e RECOMMENDATION_PROPOSED co-wrong fixture (Bug-B class)

Surfaced 2026-06-17 while validating `onboarding-mandatelevel-contract-gap` (I ran
`operating-mode-authority` as a sibling confirmation). All 3 parametrized cases
(CONSERVATIVE→L2, BALANCED→L1, AGGRESSIVE→L1) FAIL with
`ComplianceCheck not found … within 120 s` — a timeout, not an assertion failure.
**Not caused by the mandateLevel change** (its `beforeEach` `waitForMandateSnapshot`
PASSES — the onboarding→Mandate→MandateSnapshot chain is fine; the break is purely the
synthetic RECOMMENDATION_PROPOSED → ComplianceCheck step).

## Root cause — the exact Bug-B co-wrong-fixture class the epic exists to kill
`operating-mode-authority.e2e.test.ts:142-164` emits RECOMMENDATION_PROPOSED as a **flat
`detail`** with identity inline (`tenantId`/`userId`) and a non-schema `riskScore: 5`,
**missing `isInitialBuild` and `riskCategory`**. The deployed compliance-ctrl parses the
subject via `parseSubject(payload, RecommendationProposedSchema)`, which (a) reads
`payload.subject` (the DRY envelope), not a flat detail, and (b) REQUIRES `isInitialBuild:
z.boolean()` + `riskCategory: z.string()` (`decision-workflow-ctrl/src/domain/contracts.ts:55-64`).
The malformed event fails the parse → compliance-ctrl throws NotRetryableError → no
ComplianceCheck row is ever written → the test's `waitForComplianceCheck` times out at 120 s.

This is the SAME class as Phase 0's **Bug B**, which was fixed ONLY for
`update-operating-mode.e2e.test.ts` (it now emits `subject: { … isInitialBuild: false,
riskCategory: 'BALANCED' … }, context: { tenantId, userId }` and is GREEN). The
`operating-mode-authority` fixture was never updated.

## Fix (cheapest next step)
Align `operating-mode-authority`'s emission to the proven-good `update-operating-mode` shape:
move the payload under `subject: {…}`, add `context: { tenantId, userId }`, drop the
non-schema `riskScore`, and add `isInitialBuild: false` + `riskCategory` (map per the test's
operating mode, e.g. CONSERVATIVE/BALANCED/AGGRESSIVE). Then re-validate the 3 cases against
deployed dev (no Bedrock — synthetic compliance path). This is exactly the co-wrong fixture
that the epic's typed `putEvent` migration of the e2e fixtures (Phase 1) would surface as a
compile error — hence a `core` member. Queued (not parking) per the e2e-gaps-queued rule:
the e2e suite is red on this scenario today.
