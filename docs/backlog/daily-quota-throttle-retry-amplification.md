---
id: daily-quota-throttle-retry-amplification
status: parking
type: refactor
notes: "The 'quota errors are retryable' resilience design treats Bedrock daily-budget throttles like transient ones, so futile SQS-redrive + agent retries amplify the throttle count (1,789 in one hour) with no chance of recovery same-day."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: agent-runtime-latent-correctness
epic_role: core
---

# Daily-quota Bedrock throttles are retried like transient throttles (futile amplification)

## Evidence (E6 run of `dead-code-cleanup`, 2026-06-26)
The agentcore-invocation-resilience design made Bedrock `ThrottlingException` retryable so SQS can redrive transient per-second throttles. But a **tokens-per-day** throttle (`Too many tokens per day, please wait before trying again`) is NOT recoverable within the same day — every redrive + in-agent retry re-hits it. CloudWatch: **1,789 InvocationThrottles** in the 19:00 hour once the daily budget was exhausted, vs ~7,444 productive invocations — i.e. ~24% of all attempts were doomed retries.

## Why it matters
Futile retries waste invocation budget, inflate logs/metrics, and slow the suite (each redrive consumes the IP-ctrl ingress visibility timeout). They also obscure the real signal (one daily-cap event becomes thousands of throttle errors).

## Fix direction
Distinguish **daily-budget** throttles from **transient** throttles at the retry-decision seam (the throttle message text / error metadata differentiates them) and treat daily-budget ones as non-retryable within the day (fail fast / park), or add a per-model daily-cap circuit-breaker that short-circuits further invokes once a daily-cap throttle is seen. Related: [[e2e-live-suite-exceeds-bedrock-daily-token-budget]].
