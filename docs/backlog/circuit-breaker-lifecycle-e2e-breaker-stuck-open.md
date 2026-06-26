---
id: circuit-breaker-lifecycle-e2e-breaker-stuck-open
status: queued
type: bug
rank: 3
notes: "scenario 14 circuit-breaker-lifecycle e2e: initiateDeposit returns SERVICE_TEMPORARILY_UNAVAILABLE (breaker OPEN) when the test expects it closed — root cause unconfirmed (state-leak vs throttle-storm collateral)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Circuit-breaker-lifecycle e2e: breaker stuck OPEN

## Evidence (E6 run of `dead-code-cleanup`, tip 41e72aa4)
`apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts:69` — scenario 14 ("disables gated mutations when breaker opens and re-enables when breaker closes"):
```
GraphQL errors: [{"path":["initiateDeposit"],"errorType":"SERVICE_TEMPORARILY_UNAVAILABLE","message":"This action is temporarily paused"}]
```
The breaker was OPEN when the test issued `initiateDeposit` (which it expects to succeed against a closed breaker). Untouched by the epic (CB lives in broker-alpaca-adpt; not changed/redeployed) → not an epic regression.

## Hypotheses (need root-cause before fixing)
1. **State-leak** — a prior scenario opened the breaker and the heal/close didn't run before this test (test isolation). Cross-ref [[integration-test-isolation-leaks]], [[ssm-override-warm-cache-test-isolation]].
2. **Throttle-storm collateral** — the same E6 run hit the Bedrock daily-token throttle ([[e2e-live-suite-exceeds-bedrock-daily-token-budget]]); if the breaker heal/close path depends on an agent or decision-cycle step that throttled, the breaker would never re-close. This would make the failure a symptom of the quota exhaustion, not an independent bug.

## Cheapest next step
On a non-throttled day, run scenario 14 in isolation and inspect the broker-alpaca-adpt breaker-state row before/after. If it passes solo, it is a suite-ordering / state-leak issue; if it fails solo, investigate the heal path.
