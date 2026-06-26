---
id: yahoo-finance-mi-ctrl-subject-region-dead-code
status: active
type: bug
notes: "MI-ctrl reads subject.region from YAHOO_FINANCE_UPDATED but producer schema has no region field. Verification (2026-06-26) corrected the premise: the read is LIVE on the slow-tier MARKET_SNAPSHOT_REFRESH_TICK (scheduled-emitter emits subject.region; MarketSnapshotRefreshTickSchema requires it) — not dead, but redundant (always == env region). Resolved by finishing the region->RegionContext DRY migration (the tick is the lone holdout vs MarketSnapshotSchema's 2026-06-10 migration)."
references: []
out_of_scope:
  - "Multi-region semantics — single-region (us-east-1) deployment; ctx.region == env region everywhere, so this is behavior-preserving, not a multi-region enablement"
  - "The 5 fast-tier feed producer contracts (yahoo/marketwatch/sec/fred/alpha-vantage) — already region-less ('Global'); only their handler read changes from subject to ctx, with the env fallback kept"
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: dead-code-cleanup
epic_role: core
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
