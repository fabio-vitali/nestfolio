---
id: yahoo-finance-mi-ctrl-subject-region-dead-code
status: parking
type: bug
notes: "MI-ctrl reads subject.region from YAHOO_FINANCE_UPDATED but producer schema has no region field"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures
epic_role: captured
---

# YAHOO_FINANCE_UPDATED subject.region dead-code in market-intelligence-ctrl

## Evidence

`services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` line ~52:

```ts
const region = (subject.region as string | undefined) ?? process.env.AWS_REGION ?? 'us-east-1';
```

`YahooFinanceArticleSchema` (the real producer, `yahoo-finance-adpt/src/domain/contracts.ts`) has
fields `{ ticker, source, articles }` — no `region` field. The `subject.region` read is always
`undefined` against a conformant producer; the handler falls back to `process.env.AWS_REGION`.

Surfaced by typed-test-fixtures Phase 2 Task 7 when migrating MI-ctrl integration test fixtures
from `detail: { region, tickers }` to the real `YahooFinanceArticleSchema` subject. The fixtures
were passing `region` as a convenience field not present in the producer contract.

## Same pattern across all fast-tier feed handlers

All five fast-tier events (YAHOO_FINANCE_UPDATED, MARKETWATCH_UPDATED, SEC_8K_FILED,
FRED_INDICATORS_UPDATED, ALPHA_VANTAGE_NEWS_UPDATED) share the same `runMarketAgent` handler
which reads `subject.region ?? process.env.AWS_REGION`. None of these producers carry `region`
on the subject — all fall back to env var. The dead-code read is harmless but misleading.

## Cheapest next step

Remove the `subject.region` read from `runMarketAgent` in
`services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` and use
`process.env.AWS_REGION ?? 'us-east-1'` directly. No contract change needed — all producers
are already conformant. Update the unit test stubs if they mock `subject.region`.
