---
id: sec-prospectus-pe-ctrl-fixture-contract-mismatch
status: parking
type: bug
notes: "PE-ctrl SEC_PROSPECTUS_UPDATED resilience fixtures used { filingId, content } vs real SecFilingSchema"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures
epic_role: captured
---

# SEC_PROSPECTUS_UPDATED fixture contract mismatch in portfolio-engine-ctrl resilience tests

## Evidence

`services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts`
(before Task 7 migration, lines ~194–203 and ~225–234):

```ts
// OLD (wrong) fixture:
detail: {
  filingId: filingIdA,
  content: 'Test prospectus content for resilience test',
}
```

Real producer schema `SecFilingSchema` (from `sec-edgar-adpt/src/domain/contracts.ts`):
`{ cik, issuer, formType, filingDate, accessionNumber, body, source: literal('sec-edgar'), fetchedAt }`

The fields `filingId` and `content` do not exist on the producer contract — they were
convenience fields invented for the test. Migrated by Task 7 to the real schema.

## Impact

The PE-ctrl `kb-ingestion-handler` reads `subject.body` (for `body: string` from `SecFilingSchema`)
to extract the prospectus text for KB ingestion. The old fixture's `content` field would have
arrived as `undefined` at the handler — the handler would produce a store intent with empty/missing
content. The resilience test only asserted `expect(true).toBe(true)` (pass unconditionally), so
the bug was invisible.

## Cheapest next step

Verify that `kb-ingestion-handler.ts` reads `subject.body` (not `subject.content`) and that the
new `SecFilingSchema` subject correctly populates the `body` field. The migration is already in
place; this note is to ensure the handler's field read aligns with the producer contract if a
future author re-examines this code path.

File: `services/advisory/portfolio-engine-ctrl/src/handlers/kb-ingestion-handler.ts` — check
`payload.subject.body` vs `payload.subject.content`.
