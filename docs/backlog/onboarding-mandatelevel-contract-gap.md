---
id: onboarding-mandatelevel-contract-gap
status: shipped
rank: 1
type: bug
epic: typed-test-fixtures
epic_role: core
requires_deploy: true
notes: "ONBOARDING_COMPLETED drops mandateLevel → every e2e tenant forced to level=ADVISORY → update-operating-mode e2e stuck at L2 (blocks e2e green)"
references:
  - apps/e2e-feature-tests/src/helpers/fixtures.ts
  - services/investor/onboarding-bff/src/domain/schemas.ts
  - services/investor/investor-bff/src/transforms/onboarding-completed.ts
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
out_of_scope:
  - "Capturing mandateLevel in the onboarding wizard UI (no wizard phase selects a mandate level today; the agent does not emit one). This member only makes the subject field OPTIONAL + honored so fixtures/future producers CAN carry it."
  - "The broader typed-test-fixtures Phase 1 (Investor) migration of onboarding/investor fixtures to the typed putEvent API — that is a separate epic wave; this member is the production contract fix that the typed migration would have surfaced."
  - "dashboard-bff InvestorSnapshot.mandateLevel display field — unaffected; it already mirrors the investor-bff Mandate row."
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: |
  Shipped on branch worktree-onboarding-mandatelevel-contract-gap (impl commit 0b4ac1c8).
  - Contract: OnboardingCompletedRecordSchema gains optional mandateLevel (onboarding-bff/src/domain/schemas.ts); investor-bff onboarding-completed transform honors s.mandateLevel ?? 'DISCRETIONARY', removing the sole production tenantId.startsWith('e2e-') prefix-sniff.
  - Isolation safety (researched per user direction): the e2e- prefix's load-bearing job is prod-source CDC routing, keyed on 'integ-' in event-processor change-data-capture.ts:164 (fresh-tenant.ts swaps integ-→e2e-), NEVER on mandate level. Dropping the prefix-sniff touches no CDC/adapter/isolation path; production behavior unchanged (real tenants already defaulted DISCRETIONARY).
  - Unit (RED→GREEN): onboarding-bff domain/schemas 7/7; investor-bff transforms/onboarding-completed 9/9 (replaced the old 'e2e- → ADVISORY' test with explicit-honored + default-DISCRETIONARY cases).
  - Affected test+lint: pnpm nx run-many -t test,lint over 32 affected projects — "Successfully ran targets test, lint for 32 projects" (0 lint errors).
  - Deploy (dev sandbox, NX_DAEMON=false): dev-investor-bff + dev-onboarding-bff UPDATE_COMPLETE (onboarding-bff AgentCore a no-op — agent bundle content-identical; only its CDC-publisher Lambda updated).
  - Integration (NESTFOLIO_INTEG_PREFIX=dev): onboarding-bff 2/2; investor-bff 19/19 on rerun. First run had 1 failure (updateOperatingMode InvalidState) — characterized as a pre-existing eventual-consistency flake (seed-dependent test, no wait-for-Mandate-ACTIVE guard; passed at 33s on rerun vs 8s fail); mechanically unrelated to mandateLevel (resolver precondition checks profile existence + status=ACTIVE, neither touched). Filed separately.
  - E2E (the documented gate): update-operating-mode.e2e.test.ts GREEN (77.8s) — DISCRETIONARY mandate + AGGRESSIVE mode now resolves L1 (was unreachable under the forced-ADVISORY default).
  - Surfaced (filed, NOT fixed here — different contract): operating-mode-authority.e2e.test.ts is red because its synthetic RECOMMENDATION_PROPOSED emits a flat detail missing isInitialBuild/riskCategory (has non-schema riskScore) → deployed compliance-ctrl parseSubject(RecommendationProposedSchema) rejects it → no ComplianceCheck. Same Bug-B co-wrong-fixture class fixed for update-operating-mode in phase0; its beforeEach waitForMandateSnapshot PASSED, so the mandateLevel chain is fine.
---

# Onboarding fixture `mandateLevel` contract gap (forces e2e tenants to ADVISORY)

A co-wrong fixture surfaced during `typed-test-fixtures` Phase 0, after Bug B's `parseSubject`
fix unblocked the deeper assertion in `update-operating-mode.e2e.test.ts`. **Blocks that e2e from
going green**, hence `status: queued` (not parking) per the e2e-gaps-queued rule.

## Evidence (deployed-dev confirmed)
The failed run's ComplianceCheck row: `authorityLevel=L2`, `mandateSnapshot.level=ADVISORY`,
`status=ACTIVE`, `operatingMode=AGGRESSIVE`, `violations=[]`. The MandateSnapshot row: `level=ADVISORY`,
`operatingMode=AGGRESSIVE`, `__version=2`. So the operating-mode switch propagated correctly
(`operatingMode` flipped, row rewritten), but `AuthorityResolver` returned L2 on the
`mandate.level === 'ADVISORY'` branch (`services/advisory/compliance-ctrl/src/rules/authority-resolver.ts:22`).

## Root cause (the product chain is correct; the seed is wrong)
- `apps/e2e-feature-tests/src/helpers/fixtures.ts:97` puts `mandateLevel: 'DISCRETIONARY'` into the
  ONBOARDING_COMPLETED subject — but `OnboardingCompletedRecordSchema`
  (`services/investor/onboarding-bff/src/domain/schemas.ts:40-58`) has **no `mandateLevel` field**, so
  the transform's `parseSubject` strips it. The fixture field (and its "falls back to e2e-prefix
  default" comment) are **dead**.
- `services/investor/investor-bff/src/transforms/onboarding-completed.ts:23-24` then derives
  `Mandate.level` purely from the tenant prefix: `tenantId.startsWith('e2e-') ? 'ADVISORY' : 'DISCRETIONARY'`.
  Every `e2e-` tenant is forced to ADVISORY → `AuthorityResolver` returns L2 for ALL trades regardless
  of operatingMode. The `update-operating-mode` test's "DISCRETIONARY so authority depends on mode"
  premise is therefore false; its `expect(authorityLevel).toBe('L1')` is unreachable.
- `updateOperatingMode` (`graphql/js-function/update-operating-mode.fn.js`) correctly preserves `level`;
  OPERATING_MODE_CHANGED carries the full image; `projectMandateSnapshot` writes `level=subject.level`
  faithfully. **No product bug in the operating-mode → snapshot chain.**

## Fix (production — deferred from Phase 0 test-layer-only scope)
Add `mandateLevel: z.enum(['ADVISORY','DISCRETIONARY']).optional()` to `OnboardingCompletedRecordSchema`
and have `onboarding-completed.ts` honor `subject.mandateLevel ?? (prefix-default)`. Then the dead
fixture field becomes live and the e2e can reach L1. This is exactly the class of co-wrong fixture that
typing the onboarding/investor fixtures in the epic's **Phase 1 (Investor)** wave would surface as a
compile error — so this is a `core` member of `typed-test-fixtures`. Pairs with re-validating
`update-operating-mode` e2e to green after the fix.
