---
id: mock-agent-runtime-cdc-unreliable
status: active
type: bug
notes: "MI REFRESH_TICK slow-tier uses create-only record() → CCFEx every 15min on existing regional row; narrative trap asserts EXPLANATION_GENERATED but handler emits NARRATIVE_COMPLETED. Two unrelated root causes; dossier's SSM-cache + shared-egress hypotheses disproved."
references:
  - services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts
  - services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.resilience.integration.test.ts
  - services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts
  - services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.resilience.integration.test.ts
  - libs/event-processor/src/engine/intent-executor.ts
out_of_scope:
  - "Generic upsert intent in event-processor. The fix uses the existing record/update primitives; a new intent type is a bigger design discussion and belongs in its own workstream if rule-of-three justifies it."
  - "Replacing `expect(true).toBe(true)` resilience assertions with real CDC observability — restoring CDC visibility is in scope; broader assertion redesign for resilience suites is not."
  - "Investigating the still-open `cold_start: true` on every scheduled REFRESH_TICK (file as separate dossier if it surfaces during execution as load-bearing)."
  - "The second top-ranked dossier `investor-ctrl-system-trap-canary-timeout` — measurement here disproves the orphan-rule hypothesis for THAT dossier as well, but its fix path is independent (canary timing / EB rule propagation), not this workstream's."
  - "narrative-ctrl `wrapAgentOutput` vestigial-wrap cleanup (separately tracked as `an-ctrl-wrap-agent-output-vestigial`)."
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

## Investigation 2026-05-28

Empirical measurements per [[feedback-measure-before-proposing]] **disproved both original hypotheses** and surfaced two unrelated root causes:

### Measurement A — orphan integ-trap rule accumulation: ZERO
```
dev-investor-event-bus: 0
dev-advisory-event-bus: 0
dev-execution-event-bus: 0
dev-ledger-event-bus: 0
```
Kills the orphan-accumulation slowdown hypothesis (also weakens it for `investor-ctrl-system-trap-canary-timeout`).

### Measurement B — MI-ctrl IngressHandler scheduled REFRESH_TICK: 100% failure
~95 invocations over 24h, every ~15 minutes (the scheduled emitter cadence), every one fails identically:
```json
{"level":"ERROR","eventType":"MARKET_SNAPSHOT_REFRESH_TICK","errorName":"Error",
 "errorMessage":"ConditionalCheckFailedException","retryable":false}
```
Sample event ids span 2026-05-27T09:56 through 2026-05-27T16:40 (and continuing). EgressPublisher has zero errors over the same window — because the upstream conditional write never lands, no DDB Stream record exists for CDC to publish.

### Root cause #1 — MI slow-tier `record()` collides with the existing regional row

`services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts:87-100` uses `record('MarketSnapshot', …, { pk, sk })` for slow-tier (REFRESH_TICK). `record()` is implemented with `ConditionExpression: 'attribute_not_exists(pk)'` (`libs/event-processor/src/engine/intent-executor.ts:71`). `MarketSnapshot` is keyed by `pk=MarketSnapshot#{region}` (regional, not tenant-scoped — one row per region, lives forever). Once the bootstrap REFRESH_TICK creates the row, every subsequent tick fails the conditional → no write → no CDC.

Fast-tier (YAHOO/MARKETWATCH/SEC/FRED/ALPHA) correctly uses `update()`. Slow-tier was likely typoed during the Task 19 bootstrap commit — the in-file comment references "bootstrap on first deploy" without distinguishing recurring ticks.

This breaks both production-dev steady state AND the resilience test (which fires REFRESH_TICK against the same regional row).

### Root cause #2 — narrative trap waits for an event the handler never emits

`advisory-narrative-ctrl.resilience.integration.test.ts:153,173,207,242` traps `detailType: ['EXPLANATION_GENERATED']`.

The handler at `event-listener.ts:111-123` emits `record('AgentCompletion', …)`. Per `services/advisory/advisory-narrative-ctrl/CLAUDE.md` egress:
- `ReasoningOutput` → `EXPLANATION_GENERATED` (insert only)
- `AgentCompletion` → `NARRATIVE_COMPLETED` (insert only)
- `AgentFailure` → `NARRATIVE_FAILED` (insert only)

The handler never writes a `ReasoningOutput` row, so `EXPLANATION_GENERATED` is never emitted. A successful invocation emits `NARRATIVE_COMPLETED` — which the trap doesn't subscribe to. Trap is structurally unable to fire; not an "AgentRuntime unavailable" condition.

## Dossier original hypotheses — status

- **H1 SSM cache propagation**: Not the cause for MI. The CCFEx happens at write time, BEFORE the trap could observe the agent's return value matters. (Cannot rule out for narrative without a separate measurement, but root cause #2 explains the symptom independently.)
- **H2 CDC egress on shared regional row**: Disproved. Zero egress ERROR entries over 24h.

## Fix shape (sketch — settle in brainstorming)

- MI: change slow-tier from `record()` to `update()` for the MarketSnapshot row. Keep one explicit bootstrap path (handler, script, or first-tick `attribute_not_exists OR …` choice) so a fresh deploy still creates the row.
- Narrative: align trap and handler. Two options — (a) flip the trap to `NARRATIVE_COMPLETED` (cheap, preserves current handler shape), (b) make the handler also write `ReasoningOutput` so `EXPLANATION_GENERATED` becomes a real signal (heavier, aligns with the implied egress schema).
- Validation gate: scheduled REFRESH_TICK in production-dev must stop ERROR'ing; both resilience suites must observe CDC (or be re-asserted on the right detail-type) and pass without `console.warn` fallthrough.

## Related

- `feedback_e2e_no_external_mocks.md` — integration tests must mock external APIs. These already do.
- `project_agentcore_cost_safeguards.md` — Haiku floor + P0 cost safeguards on dev (ambient context).
- `investor-ctrl-system-trap-canary-timeout` — sibling dossier whose orphan-accumulation hypothesis is weakened by Measurement A above.
