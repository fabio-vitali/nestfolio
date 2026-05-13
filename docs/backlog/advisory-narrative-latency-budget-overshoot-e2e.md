---
id: advisory-narrative-latency-budget-overshoot-e2e
status: queued
rank: 8
type: bug
notes: "2 of 3 narrative-latency e2e assertions overshoot ~4% over the 20s budget on the deployed dev pipeline."
references:
  - "apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts:113-115"
  - "apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts:92"
  - "apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts:43"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Advisory-narrative `gen_ai.invocation.latency_ms` budget overshoots in e2e gate

Surfaced 2026-05-10 in the validation_gate of `non-investor-profile-trigger-operating-mode-lookup` (30/33 PASS — 2 narrative-latency overshoots ~4% over budget). Not previously filed.

## Evidence

`apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts:43` sets `advisoryNarrative: 20_000`. The assertions at `first-decision.e2e.test.ts:113-115` and `rebalance-on-drift.e2e.test.ts:92` use `toBeLessThan(getLatencyBudget())`. Recent runs against deployed dev show actual latency ~21s for two scenarios — strict-less-than fails by ~4%.

## Cheapest next steps

Two non-exclusive options:
1. Raise the default budget for `advisoryNarrative` from 20_000 → 25_000 (or use `AGENT_LATENCY_BUDGET_MS_ADVISORY_NARRATIVE` env override in CI/dev) if the higher p95 is acceptable.
2. Investigate the latency drift — Sonnet response-time variance vs Memory read overhead. Cross-check the eager-write refactor candidate (`advisory-narrative-ctrl-eager-write-refactor`) to see whether the 28s Memory retry loop is contributing to wall-clock the assertion measures.

Promote alongside `circuit-breaker-feature-flags-ui-gating` (rank 1) and `host-runtime-config-json-regeneration-silently-optional` (rank 2) as part of the "make e2e green" workstream.
