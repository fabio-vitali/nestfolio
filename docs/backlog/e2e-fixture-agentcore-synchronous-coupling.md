---
id: e2e-fixture-agentcore-synchronous-coupling
status: shipped
type: refactor
rank: 1
notes: "onboarded() e2e fixture synchronously blocks on a Bedrock-driven projection (InvestorProfileSnapshot, written by IP-ctrl's AgentCore agent). agentcore-invocation-resilience widens the poll budget to 360s but the fixture stays coupled to agent latency — every onboarded()-using scenario pays the agent-invoke time. Evaluate decoupling."
references: []
out_of_scope:
  - "Reducing the actual decision-cycle latency inside withLiveDecision (180s budget) — that is end-to-end pipeline tuning, not a fixture-coupling concern."
  - "Changing the 360s native-retry poll budget itself — agentcore-invocation-resilience set it deliberately; this workstream relocates the poll, it does not retune it."
  - "Direct-DDB seeding of the InvestorProfileSnapshot row — rejected to keep the events-only fixture convention intact; the 3 live-decision scenarios keep the real agent path."
  - "Other fixtures (funded, withDecision, withHoldings, etc.) — unchanged."
spec: docs/superpowers/specs/2026-05-21-e2e-fixture-agentcore-decoupling-design.md
plan: docs/superpowers/plans/2026-05-21-e2e-fixture-agentcore-decoupling.md
topic_memory: []
validation_gate: "Extracted the 360s agent-gated InvestorProfileSnapshot poll out of onboarded() into a new composable withProfileSnapshot() fixture (commit 9b51fb12); the 3 live-decision scenarios compose it (commit 0b70655f), the other ~12 onboarded() scenarios drop the wait. nx affected test,lint green (43 tests). Scoped e2e gate against deployed dev (NESTFOLIO_INTEG_PREFIX=dev) — all 5 PASS, no flakes: first-decision 154s, rebalance-on-drift 178s, operating-mode-recommendation-shape 3/3 cases 264s (live-decision trio still passes with withProfileSnapshot composed in); accept-decision 57s, fund-account 49s (fast-path — pass without the snapshot wait). No deploy required (Tier 0 test-code only)."
---

# Decouple `onboarded()` fixture from synchronous AgentCore materialisation

`apps/e2e-feature-tests/src/helpers/fixtures.ts` `onboarded()` polls IP-ctrl's table for an `InvestorProfileSnapshot` row before any downstream fixture runs. That row is written by IP-ctrl's Bedrock AgentCore agent (user-goals Haiku + risk-assessment Sonnet 4.6), so the fixture's wall-clock cost is gated by agent-invoke latency (observed 19–89s, plus an SQS-redrive recovery window after `agentcore-invocation-resilience`).

`agentcore-invocation-resilience` raises the poll budget to 360s — correct for tolerating native retry, but it leaves every `onboarded()`-using scenario (≈ 15 tests) paying agent latency in `beforeEach`.

Evaluate decoupling options:
- Seed the `InvestorProfileSnapshot` row directly for scenarios that do not exercise the IP agent itself (most don't — they need an *onboarded tenant*, not a freshly-reasoned profile).
- Keep the live-agent path only for scenarios that actually assert on IP-agent output.
- Weigh against `feedback_no_seeder_fixtures` (fixtures via events/mutations, not raw DDB seeding) — a direct snapshot seed may need a carve-out or an event-driven equivalent.
