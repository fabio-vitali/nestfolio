---
id: e2e-fixtures-test-stale-detail-envelope-assertion
status: queued
type: bug
rank: 2
notes: "apps/e2e-feature-tests fixtures.test.ts asserts the old flat detail:{} EB envelope, but the fixtures now emit the DRY {context, subject} envelope — 2 stale-assertion failures unrelated to any service."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# e2e fixtures.test.ts asserts the old `detail:{}` envelope, fixtures emit `{context, subject}`

## Evidence (E6 run of `dead-code-cleanup`, tip 41e72aa4 — pre-existing, unchanged file on the branch)
`apps/e2e-feature-tests/test/helpers/fixtures.test.ts`:
- `:89` (`funded`) expects `detail: {cashBalanceCents, tenantId, userId}` — received `{context:{tenantId,userId}, subject:{cashBalanceCents, snapshot:{…}}}`.
- `:115` (`withDecision`) expects `detail: {confirmationRequired, tenantId, trigger}` — received `{context:{tenantId}, subject:{…full decision packet…}}`.

The fixtures in `src/helpers/fixtures.ts` were migrated to the DRY `{context, subject}` EB envelope (the typed/DRY-subject program), but this helper unit test still asserts the pre-migration flat `detail:{}` shape. Fails identically on `main` (file is unchanged on the epic branch) → confirmed pre-existing drift, NOT an epic regression.

## Fix
Update the two `expect(eb.putEvent).toHaveBeenCalledWith(...)` assertions to the `{context, subject}` envelope shape the fixtures actually emit. Related DRY-subject residue themes: [[dry-subject-identity-cleanup]], [[typed-subject-fixtures-program-residue]], [[untyped-fixture-contract-drift]].
