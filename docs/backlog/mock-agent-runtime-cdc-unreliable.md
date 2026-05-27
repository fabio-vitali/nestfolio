---
id: mock-agent-runtime-cdc-unreliable
status: queued
rank: 2
type: bug
notes: "MI + narrative resilience tests catch CDC trap timeouts despite using mock-agent-runtime; SSM-override may not propagate to warm Lambda"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# MI + advisory-narrative resilience: CDC trap times out despite MockApiFixture

The order-agnostic resilience tests in `market-intelligence-ctrl` and `advisory-narrative-ctrl` deploy `MockApiFixture` mocks (`mock-agent-runtime.zip`) and override the AgentRuntime SSM param to point at the mock URL. Despite this, `trap.waitForEvent` for the downstream CDC event (`MARKET_SNAPSHOT_UPDATED` / `EXPLANATION_GENERATED`) consistently times out — the test catches it via `console.warn('AgentRuntime may be unavailable')` and continues.

## Symptom (from 2026-05-27 run)

```
market-intelligence-ctrl: Run A feed event did not produce CDC (AgentRuntime may be unavailable)
market-intelligence-ctrl: Run A refresh tick did not produce CDC (AgentRuntime may be unavailable)
advisory-narrative-ctrl: Run A GENERATE_NARRATIVE did not produce CDC (AgentRuntime may be unavailable)
```

The warning string is misleading — these tests **don't** call real AgentCore. They invoke the mock. The "unavailable" condition is the mock not producing CDC events, not real Bedrock being down.

## Workaround applied 2026-05-27

`market-intelligence-ctrl.resilience.integration.test.ts:207` — bump test timeout 360s → 600s.
`advisory-narrative-ctrl.resilience.integration.test.ts:262` — bump test timeout 240s → 360s.

Both tests assert only `expect(true).toBe(true)` at the end, so they tolerate CDC misses — but cumulative `waitForEvent(120s)` × 4 (MI) or × 2 (narrative) was exceeding the Jest test timeout before the catches could fall through.

## Hypothesis

Two candidates, not yet measured:

1. **SSM override doesn't propagate to a warm Lambda.** `SsmOverrideFixture.overrideAndDeriveRestore` updates the SSM parameter, but the AWS Parameters & Secrets Lambda Extension caches values for 5 min by default. If a previous test invocation populated the cache with the production AgentCore Runtime ARN, the warm Lambda keeps using that ARN — agent calls hit the real (unreachable from integration test context) runtime and fail silently. The handler still `record('AgentInvocation')`s the failure but never `record('MarketSnapshot')` so no CDC fires.

2. **CDC egress Lambda failing on shared regional row.** `MarketSnapshot` is keyed by `pk=MarketSnapshot#{region}` (regional, not tenant-scoped). The egress publisher may have an issue distinguishing test vs prod stream records on this shared row.

The basic (non-resilience) tests for the same services PASS by `table.waitForItem` on DDB row state (with `sourceEventIds` predicate), so:
- (a) Mock IS invoked at least sometimes (basic test sees the row updated)
- (b) But CDC isn't reliably reaching the trap (resilience test consistently misses)

The divergence between basic-passes and resilience-misses-CDC is the smoking gun: either CDC is broken for `MarketSnapshot` modifications specifically, or the mock invocation is racy and basic tests happen to win the race more often.

## Cheapest next step

```bash
AWS_PROFILE=nestfolio-dev aws logs filter-log-events \
  --log-group-name /aws/lambda/dev-market-intelligence-ctrl-egress \
  --start-time $(($(date +%s%3N) - 3600000)) \
  --filter-pattern "ERROR" \
  --query 'events[*].message'
```

If the egress Lambda is failing on shared-row modifications, errors show up. Also: tail the ingress Lambda log during a test run and verify the mock-agent-runtime URL is actually being hit (vs the real AgentCore ARN).

## Related

- `feedback_e2e_no_external_mocks.md` — integration tests are supposed to mock all external APIs. These tests do.
- `project_agentcore_cost_safeguards.md` — Haiku floor + P0 cost safeguards on dev; not directly related to mock CDC, but ambient context.
