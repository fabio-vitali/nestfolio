---
id: e2e-live-suite-exceeds-bedrock-daily-token-budget
status: queued
type: infra
rank: 1
notes: "One full live-AgentCore e2e run (~7.2k Bedrock invocations) exhausts the dev account daily token-per-day quota mid-suite, so the suite self-throttles and cannot go fully green in a single pass."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Live-AgentCore e2e exceeds the dev Bedrock daily token-per-day budget in one run

## Evidence (2026-06-26 E6 run of `dead-code-cleanup`, tip 41e72aa4)
- Jest e2e: 7 suites / 11 tests RED. Dominant failure (7/11): `withProfileSnapshot(): InvestorProfileSnapshot not materialised within 360s`.
- IP-ctrl ingress log: `DegradedAgentOutputError: Agent "user-goals" returned a degraded output … ThrottlingException: Too many tokens per day, please wait before trying again.` (retryable=true) — repeated across every decision attempt.
- Bedrock CloudWatch (AWS/Bedrock) today: **Invocations 7,444 + InvocationThrottles 1,789**. Hourly shape: flat **12/hr** baseline all day (scheduled emitters), then **3,529** (18:00 CEST) + **3,720 + 1,789 throttles** (19:00) — the entire burn is one e2e run. No loop / no background drain.

## Why it happens
The live-AgentCore suite (~28 test files) drives full multi-agent decision cycles (5 LangGraph agents, each making many internal LLM calls per invocation) + the 7-phase onboarding wizard. One pass is thousands of model calls — larger than the dev account's on-demand tokens-per-day quota for the throttled model(s) (Haiku/Sonnet inference profiles). Once the cap is hit the suite throttles itself for the rest of the day → green is structurally unreachable in one run.

## Fix options (multi-pronged)
1. Request a Bedrock on-demand **tokens-per-day** Service Quota increase for the inference profiles (`us.anthropic.claude-haiku-*`, `us.anthropic.claude-sonnet-*`). Distinct axis from the maxVms (concurrency) item — see [[agentcore-maxvms-prod-quota-increase]].
2. Reduce per-scenario token consumption (tighter agent prompts; fewer reasoning/tool-call loops; reuse a shared onboarded tenant across scenarios instead of re-onboarding).
3. Scope the live-AgentCore scenarios (run the full decision cycle for a representative subset; assert cheaper signals for the rest).
4. Split the suite so a single run fits within the daily budget.

## Cheapest next step
Pull per-model token totals (AWS/Bedrock `InvocationInputTokenCount`/`OutputTokenCount` by `ModelId` dimension — were `None` at the namespace level) to size the gap, then compare against the current Service Quota value before choosing increase-vs-reduce.
