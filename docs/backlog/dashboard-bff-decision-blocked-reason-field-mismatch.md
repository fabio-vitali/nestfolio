---
id: dashboard-bff-decision-blocked-reason-field-mismatch
status: parking
type: bug
notes: "dashboard-bff DECISION_BLOCKED fixture used `reason` absent from ComplianceCheckSchema; real producer emits violations[], consumer description degrades to decisionId"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: blocked-decision-reason-from-violations
epic_role: core
---

# dashboard-bff DECISION_BLOCKED `reason` field — latent contract mismatch

## Evidence

- **Producer schema**: `ComplianceCheckSchema` (compliance-ctrl `src/domain/contracts.ts`) has `violations: z.array(...)` and NO `reason` field.
- **Consumer read**: `recent-activity.ts` builds the Activity description as `p.reason ?? p.decisionId ?? 'unknown'`. On a real DECISION_BLOCKED event `p.reason` is always `undefined`, so the description degrades to the `decisionId` fallback.
- **Fixture assumption**: the integration test at `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts` sent `detail: { decisionId, reason: 'Integration test block' }` — the `reason` field was accepted by the consumer-owned all-optional `RecentActivitySchema` but does not appear on any real DECISION_BLOCKED subject.

## Root cause

`recent-activity.ts` predates the producer-owned `ComplianceCheckSchema` contract. When it was written, `reason` may have been on an older schema. After the producer schema settled on `violations[]`, the consumer's description path was never updated to extract a meaningful string from `violations[0].description`.

## Fix

In `recent-activity.ts`, update the DECISION_BLOCKED description to use `violations[0]?.description ?? subject.decisionId ?? 'unknown'` (or join all violation descriptions). The `reason` fallback in the description template can be removed or left as a dead fallback — but the field should be sourced from `violations`.

The fixture fix (migrating `reason` → proper `violations[]` field) was applied as part of typed-test-fixtures Phase 2 (Advisory) — see `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`.

## Cheapest next step

1. Open `recent-activity.ts` handler for DECISION_BLOCKED.
2. Replace `p.reason` in the description with `(p.violations as Array<{description:string}>)?.[0]?.description`.
3. Add a unit test in `transforms/recent-activity.test.ts` asserting the violation description is used.
