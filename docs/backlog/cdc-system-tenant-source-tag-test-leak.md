---
id: cdc-system-tenant-source-tag-test-leak
status: parking
type: bug
notes: "CDC source-tag (isTestTenant=integ- prefix) misses SYSTEM-tenant test events → they emit prod source, leak to prod consumers."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# changeDataCapture source-tag heuristic leaks SYSTEM-tenant test events to production consumers

Surfaced 2026-06-20 while fixing [[advisory-market-data-adapters-fetch-cdc-empty-buffer]] (the 5
advisory market-data adapters are GLOBAL/SYSTEM aggregates — their rows + CDC events carry
`context.tenantId='SYSTEM'`).

## Root cause
`libs/event-processor/src/pipelines/change-data-capture.ts` → `buildEntry()` chooses the emitted
EventBridge `Source` by:

```js
const isTestTenant = record.tenantId?.startsWith('integ-');
const source = isTestTenant
  ? `integration-test:${serviceName}`   // tagged so prod consumers' EB rules filter it out
  : `${busName}@${serviceName}`;         // production source
```

A `SYSTEM` tenant fails `startsWith('integ-')`, so **integration-test runs of SYSTEM-scoped
adapters emit `*_UPDATED` with the PRODUCTION source**, not `integration-test:<svc>`.

## Consequence
Within-advisory PRODUCTION consumers (e.g. `market-intelligence-ctrl` consuming
`YAHOO_FINANCE_UPDATED`) receive these test events as if they were production and fire their agents
on test data. This is the likely cause of the adjacent advisory agent-CDC anomalies noted in the
sibling bug (advisory-narrative-ctrl `NARRATIVE_FAILED` trap matched 2 events not 1;
portfolio-engine-ctrl `PORTFOLIO_COMPLETED` empty buffer). Real test-isolation hole.

## Why this is harder than the trap fix (and was split out)
The companion trap fix (let `EventBusTrap` observe SYSTEM-tenant events) made the 5 adapters' OWN
tests green, but does NOT fix this leak. At the egress publisher there is **no signal** that a
SYSTEM-tenant write came from a test vs production: the production scheduler ALSO emits
`tenantId='SYSTEM'`, so SYSTEM is test/prod-indistinguishable at the CDC layer. A fix needs a
different mechanism (e.g. a test-only source marker plumbed through the inbound envelope into the
row, or scoping SYSTEM-aggregate consumers' EB rules). Genuinely orthogonal to the trap bug and
affects OTHER services' tests — filed standalone.

## Cheapest next step
Decide where the test/prod discriminator should live for SYSTEM aggregates (inbound-envelope test
marker persisted on the row → read by `buildEntry`, vs consumer-side EB-rule scoping). Candidate
theme: cluster with the test-isolation family (`ssm-override-warm-cache-test-isolation`,
advisory-narrative-resilience-cdc-trap-miss) on the next `/backlog-themes` sweep.
