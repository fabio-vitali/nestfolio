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
epic: typed-test-fixtures-leftovers
epic_role: core
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

The mismatch is **backwards from the note above**: the SEC-EDGAR producer (`sec-edgar-adpt`)
correctly emits `body: filing.content` (field name `body` on `SecFilingSchema`). The PE-ctrl
consumer (`kb-ingestion-handler.ts`) reads `subject.content` — a field that does NOT exist on
`SecFilingSchema`. Because `subject.content` is always `undefined` for a real SEC event (there is
no `preSignedUrl` fallback either), the handler falls through to:

```ts
throw new Error(`No content or preSignedUrl in ${ctx.eventType} event`);
```

Consequence: **SEC→KB ingestion is effectively broken in production.** Every
`SEC_PROSPECTUS_UPDATED` / `SEC_10K_UPDATED` event causes the KB-ingestion Lambda to throw,
the pipeline retries, and ultimately the SQS message goes to DLQ. No ETF prospectus or 10-K
content ever reaches `FundKB`. The portfolio-engine agent therefore has an empty knowledge base.

The resilience test asserted `expect(true).toBe(true)` (pass unconditionally), so the bug was
invisible at the test layer. The test has been converted to `it.skip` referencing this finding.

## Cheapest next step

Align the field name. Two options (pick one):

1. **Fix the consumer** — change `kb-ingestion-handler.ts` line 22 from `subject.content` to
   `subject.body` (matches `SecFilingSchema`). Simpler; producer is already correct.
2. **Fix the producer** — rename `SecFilingSchema.body` to `content` in `sec-edgar-adpt/src/domain/contracts.ts`
   and update the emitter in `event-listener.ts`. Ripples to every consumer and the typed publisher.

Option 1 is the one-line fix. File: `services/advisory/portfolio-engine-ctrl/src/handlers/kb-ingestion-handler.ts`
— change `if (subject.content)` → `if (subject.body)` and `content = subject.content as string`
→ `content = subject.body as string`.
