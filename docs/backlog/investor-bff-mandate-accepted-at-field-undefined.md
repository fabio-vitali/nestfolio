---
id: investor-bff-mandate-accepted-at-field-undefined
status: queued
rank: 5
type: bug
notes: "Test mutation selects Mandate.acceptedAt; the field was deleted from schema in commit e283b5f5 (2026-05-08 resplit). Test fixture rot + stale TypeScript MandateStatus interface in src/domain/models.ts."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `Mandate.acceptedAt` deleted from schema; investor-bff test mutations + stale TS interface left behind

**Failing integration tests (`services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`):**

1. `AppSync mutations › should revoke mandate and flip Mandate row to REVOKED + emit MANDATE_REVOKED` — GraphQL error: `FieldUndefined: Field 'acceptedAt' in type 'Mandate' is undefined @ 'revokeMandate/acceptedAt'`.
2. `AppSync mutations › should reject double-revoke with InvalidState` — same FieldUndefined masks the InvalidState path.
3. `AppSync queries › should return composite InvestorProfile via getProfile` — `result.getProfile.mandate.status` returns `"ACTIVE"` (downstream effect of #1 — revoke didn't go through).

## Root cause

Verified 2026-05-11 via git history:

- **2026-05-04 commit `c47b8a5c`** — test added selecting `acceptedAt` against the then-current `MandateStatus` GraphQL type.
- **2026-05-08 commit `e283b5f5`** — InvestorProfile resplit deleted `MandateStatus`, `revokeMandate` return type changed to `Mandate!`. New `Mandate` type (`services/investor/investor-bff/src/schema.graphql:105-111`):
  ```graphql
  type Mandate {
    mandateId: ID!
    level: MandateLevel!
    status: MandateStatusValue!
    effectiveDate: String!
    revokedAt: String
  }
  ```
  No `acceptedAt`.
- **2026-05-08 commit `86e6090c`** — test suite realigned, but `acceptedAt` selections at lines 575, 583, 641 were missed.

Three leftover artifacts:
1. Three GraphQL mutations in the test still select `acceptedAt` (lines 575, 583, 641).
2. `services/investor/investor-bff/src/domain/models.ts:78-86` still defines a `MandateStatus` TypeScript interface with `acceptedAt` — no GraphQL type or resolver references it anymore.
3. No production consumer reads `acceptedAt` anywhere (grep clean across services + apps).

## Fix shape

1. Test: remove `acceptedAt` from the 3 selection sets.
2. Source: delete the stale `MandateStatus` interface in `domain/models.ts:78-86`.
3. No resolver or schema changes.

Surfaced 2026-05-11 during full-system test sweep. Same root pattern as rank 4 + rank 6 (post-ship test fixture rot).
