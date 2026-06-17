---
id: onboarding-mandatelevel-contract-gap
status: queued
rank: 1
type: bug
epic: typed-test-fixtures
epic_role: core
notes: "ONBOARDING_COMPLETED drops mandateLevel → every e2e tenant forced to level=ADVISORY → update-operating-mode e2e stuck at L2 (blocks e2e green)"
references:
  - apps/e2e-feature-tests/src/helpers/fixtures.ts
  - services/investor/onboarding-bff/src/domain/schemas.ts
  - services/investor/investor-bff/src/transforms/onboarding-completed.ts
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
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
