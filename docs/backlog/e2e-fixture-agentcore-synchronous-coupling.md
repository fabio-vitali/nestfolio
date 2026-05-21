---
id: e2e-fixture-agentcore-synchronous-coupling
status: queued
type: refactor
rank: 1
notes: "onboarded() e2e fixture synchronously blocks on a Bedrock-driven projection (InvestorProfileSnapshot, written by IP-ctrl's AgentCore agent). agentcore-invocation-resilience widens the poll budget to 360s but the fixture stays coupled to agent latency — every onboarded()-using scenario pays the agent-invoke time. Evaluate decoupling."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Decouple `onboarded()` fixture from synchronous AgentCore materialisation

`apps/e2e-feature-tests/src/helpers/fixtures.ts` `onboarded()` polls IP-ctrl's table for an `InvestorProfileSnapshot` row before any downstream fixture runs. That row is written by IP-ctrl's Bedrock AgentCore agent (user-goals Haiku + risk-assessment Sonnet 4.6), so the fixture's wall-clock cost is gated by agent-invoke latency (observed 19–89s, plus an SQS-redrive recovery window after `agentcore-invocation-resilience`).

`agentcore-invocation-resilience` raises the poll budget to 360s — correct for tolerating native retry, but it leaves every `onboarded()`-using scenario (≈ 15 tests) paying agent latency in `beforeEach`.

Evaluate decoupling options:
- Seed the `InvestorProfileSnapshot` row directly for scenarios that do not exercise the IP agent itself (most don't — they need an *onboarded tenant*, not a freshly-reasoned profile).
- Keep the live-agent path only for scenarios that actually assert on IP-agent output.
- Weigh against `feedback_no_seeder_fixtures` (fixtures via events/mutations, not raw DDB seeding) — a direct snapshot seed may need a carve-out or an event-driven equivalent.
