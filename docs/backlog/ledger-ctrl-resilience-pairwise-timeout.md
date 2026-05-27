---
id: ledger-ctrl-resilience-pairwise-timeout
status: parking
type: bug
notes: "order-agnostic pairwise resilience test exceeded 300s budget — suspect shared-dev DDB-stream backlog slowing reducer"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# ledger-ctrl resilience pairwise test exceeded 300s budget

`services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:239` — "DEPOSIT_DETECTED then ORDER_FILLED vs reverse → same final snapshot" — timed out at 300_000 ms on retry 1 of the 2026-05-27 run.

## Symptom

```
ledger-ctrl resilience: order-agnostic pairwise DEPOSIT_DETECTED then ORDER_FILLED vs reverse → same final snapshot
RETRY 1
Exceeded timeout of 300000 ms for a test.
```

## Workaround applied 2026-05-27

`ledger-ctrl.resilience.integration.test.ts:328` — bump test timeout 300_000 → 480_000.

## Hypothesis

Per commit `d27d2e99` (2026-05-12) the entire resilience suite was measured at 381.6s after the dead-time-sleep removal. The 2026-05-27 run's full file wall-clock was **1588s** — a 4× regression. The individual test budget held in 2026-05-12 but no longer.

Reducer Lambda (DDB Stream consumer with batch size 100, 5s window, bisect-on-error, 3 retries) is the likely choke point. Suspect:

1. Shared dev DDB table accumulating LedgerEntry rows from prior runs creates a stream backlog the reducer drains slowly.
2. Reducer Lambda is reserved-concurrency=1 (or similar) and being starved by parallel test runs against the same table.
3. Recent ledger-ctrl refactors (`a95fdf35` snapshot-publisher Lambda, `9c7eface` saveSnapshot method) changed reducer write path; perf may have regressed.

## Cheapest next step

```bash
AWS_PROFILE=nestfolio-dev aws logs filter-log-events \
  --log-group-name /aws/lambda/dev-ledger-ctrl-reducer \
  --start-time $(($(date +%s%3N) - 86400000)) \
  --filter-pattern "Duration" \
  --query 'events[*].message' | head -50
```

Compare p50/p99 duration over time. If the reducer's per-batch duration has crept up >2×, that's the regression to fix — not the test timeout.

Also: check the reducer's IteratorAge metric in CloudWatch. A growing IteratorAge means the reducer can't keep up with stream events.

## Out of scope

`ledger-ctrl resilience: order-agnostic full shuffle` (3 events shuffled, lines 333+) was not on the 2026-05-27 failure list, but uses the same reducer code path and would benefit from the same investigation.
