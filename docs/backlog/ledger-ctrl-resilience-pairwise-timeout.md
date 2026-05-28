---
id: ledger-ctrl-resilience-pairwise-timeout
status: shipped
type: bug
notes: "Investigated 2026-05-28. Empirical evidence shows no reducer regression — the workaround timeout bump (d5e0152b) is the correct fix. Residual variance belongs to integration-deep-coldstart-flakes-post-trap-hardening (Case B)."
references:
  - "services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:239"
  - "docs/backlog/integration-deep-coldstart-flakes-post-trap-hardening.md"
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_resilience_testing.md
validation_gate: |
  CloudWatch evidence for reducer Lambda (dev-ledger-ctrl-ReducerFnB8BFD8FF-wCVIOafQsvir) over 14 days
  confirms NO reducer regression. Workaround (480s timeout) remains in effect via commit d5e0152b.
---

# ledger-ctrl resilience pairwise test exceeded 300s budget

`services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:239` — "DEPOSIT_DETECTED then ORDER_FILLED vs reverse → same final snapshot" — timed out at 300_000 ms on retry 1 of the 2026-05-27 run.

## Resolution 2026-05-28

The empirical evidence does not support a reducer-side regression. The workaround applied 2026-05-27 (commit `d5e0152b`, test-level timeout 300s → 480s) is the correct fix.

### Empirical measurements

Reducer Lambda config:
- Function: `dev-ledger-ctrl-ReducerFnB8BFD8FF-wCVIOafQsvir`
- Memory 512MB · Timeout 60s · Runtime nodejs24.x
- **Reserved concurrency: unreserved** (hypothesis (2) disproved)
- Event-source mapping: BatchSize=100, MaxBatchingWindow=5s, ParallelizationFactor=1

CloudWatch (14d, daily): Duration / IteratorAge / Invocations / Errors

| Date | Duration avg (ms) | Duration max (ms) | IteratorAge avg (ms) | IteratorAge max (ms) | Errors |
|---|---|---|---|---|---|
| 2026-05-14 | 154 | 594 | 2389 | 10765 | 0 |
| 2026-05-15 | 116 | 598 | 5269 | 104893 | 0 |
| 2026-05-17 | 74 | 579 | 2881 | 5980 | 0 |
| 2026-05-18 | 82 | 618 | 2782 | 8846 | 0 |
| 2026-05-19 | 137 | 545 | 2732 | 5924 | 0 |
| 2026-05-20 | 67 | 556 | 4104 | 51669 | 0 |
| 2026-05-21 | 55 | 591 | 3432 | 17200 | 0 |
| 2026-05-22 | 46 | 556 | 3260 | 10225 | 0 |
| 2026-05-24 | 138 | 616 | 3090 | 6284 | 0 |
| 2026-05-25 | 144 | 504 | 2695 | 5299 | 0 |
| 2026-05-26 | 54 | 591 | 3643 | 16690 | 0 |
| **2026-05-27** (failure day) | **125** | **582** | **1854** | **6153** | **0** |

The failure day was actually **one of the lower-lag IteratorAge days** in the window. Per-invocation Duration is stable around 45-150ms avg / 500-620ms max throughout. Errors=0 every day.

### Conclusions

1. **Hypothesis (3) — reducer code regression — disproved.** Duration didn't regress on the failure day.
2. **Hypothesis (2) — reserved-concurrency=1 starvation — disproved.** Reducer is unreserved.
3. **Hypothesis (1) — shared-dev DDB-stream backlog — partially supported but bounded.** IteratorAge spikes to >50s on rare days (2026-05-15 max 105s; 2026-05-20 max 52s) but the failure day itself was clean. The dominant cause of the 4× suite wall-clock regression is environmental noise outside the reducer (createIntegrationTestContext setup, EB rule propagation, OrphanReaper churn) — the same family already tracked under `integration-deep-coldstart-flakes-post-trap-hardening` (Case B at line 39 of that dossier).

The 480s test budget accommodates the observed variance; no code or CDK change is warranted in the reducer path.

### Side-finding (filed separately)

The `dev-ledger-ctrl-StateTable962DE04C-*` namespace currently contains 3 tables: 1 active (37,769 items, owned by CFN) + 2 orphans from 2026-04-03 deploys (0 items each, streams still enabled). The orphans don't cause the timeout (reducer ESM only subscribes to the active table's stream) but are real waste. Filed as `dev-ledger-ctrl-state-table-orphans`.

## Out of scope

- Touching `ParallelizationFactor` on the reducer ESM. Per-tenant ordering depends on PF=1; raising it risks reducer correctness.
- Per-test DDB cleanup. The active table accumulates 37k+ LedgerEntry rows; per-tenant queries are still fast (PK-scoped), and a full prune would cost a multi-hour scan.
- Restoring the 300s budget. The variance is environmental and unbounded; tightening would re-introduce the flake.
