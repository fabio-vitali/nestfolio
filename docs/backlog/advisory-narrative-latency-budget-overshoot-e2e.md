---
id: advisory-narrative-latency-budget-overshoot-e2e
status: parking
type: bug
notes: "Symptom of a larger architectural issue. Original framing (4% overshoot, bump budget) is wrong: actual regression is ~3x (p50 13s→49s) caused by 28s retry-sleep loop added in 4960a10d. Root-cause fix tracked in design item: inter-agent-state-handoff-sf-vs-memory."
references:
  - "apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts:113-115"
  - "apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts:130-132"
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

`apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts:43` sets `advisoryNarrative: 20_000`. The two narrative assertions at `first-decision.e2e.test.ts:113-115` and `reconciliation-correction.e2e.test.ts:130-132` use `toBeLessThan(advisoryNarrativeTrap.getLatencyBudget())`. Recent runs against deployed dev show actual latency ~21s for two scenarios — strict-less-than fails by ~4%. (Note: `rebalance-on-drift.e2e.test.ts:92` asserts portfolio-engine latency — 45s budget — and is unrelated to this bug.)

## Cheapest next steps

Two non-exclusive options:
1. Raise the default budget for `advisoryNarrative` from 20_000 → 25_000 (or use `AGENT_LATENCY_BUDGET_MS_ADVISORY_NARRATIVE` env override in CI/dev) if the higher p95 is acceptable.
2. Investigate the latency drift — Sonnet response-time variance vs Memory read overhead. Cross-check the eager-write refactor candidate (`advisory-narrative-ctrl-eager-write-refactor`) to see whether the 28s Memory retry loop is contributing to wall-clock the assertion measures.

## Investigation 2026-05-14 — root cause found

CloudWatch `AWS/Lambda Duration` for narrative ingress (filtered to invocations >5s = real narrative work):

| Day | p50 | p95 | n |
|---|---|---|---|
| 2026-05-06 | 13.5s | **21.2s** | 18 |
| 2026-05-08 | 14.2s | **22.8s** | 150 |
| 2026-05-09 | 46.1s | **57.0s** | 49 ← regression starts |
| 2026-05-13 | 49.5s | 56.4s | 39 |

**Cause:** commit `4960a10d` (2026-05-09 13:18) added a Memory-read retry loop in `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:55-63` with default delays `3000,5000,8000,12000` = up to **28s mandatory sleep** before the agent runs. Loop fires when AgentCore Memory's >40s eventual-consistency window means upstream `portfolio-engine` Memory writes haven't propagated to the narrative reader. Per the commit message, this is load-bearing — without retry, narrative gets empty input and emits empty trades.

**Why "bump the budget" is wrong:** the 4% overshoot in the original frame was a snapshot before the retry was added. After the retry, it's not 4% over budget — it's 3x. Bumping budget masks a real architectural regression in the inter-agent handoff path.

**Real fix tracked separately:** [[inter-agent-state-handoff-sf-vs-memory]] — design item to migrate the inter-agent ephemeral handoff (portfolio → narrative, etc.) off AgentCore Memory and onto Step Functions state, where it belongs. Long-term semantic memory (`searchLongTermMemory` calls) stays on AgentCore Memory.

This e2e-frame bug ships when that design ships. Parked until then.
