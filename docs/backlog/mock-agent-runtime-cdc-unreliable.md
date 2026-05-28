---
id: mock-agent-runtime-cdc-unreliable
status: shipped
type: bug
notes: "MI slow-tier REFRESH_TICK now uses update() upsert instead of create-only record(); production-dev CCFEx errors stopped (3 consecutive clean ticks observed post-deploy); MI integration suite green 2x in 109s/101s (was timing out at 600s). Narrative piece split to advisory-narrative-resilience-cdc-trap-miss.md."
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
validation_gate: |
  Code: commit c0ce8615 — slow-tier `record('MarketSnapshot', …)` → `update('MarketSnapshot', …, { overrides: { pk, sk } })`
    + unit test asserts `_tag: 'update'` and no `condition` (would re-introduce CCFEx).
  Unit/lint: `pnpm nx affected -t test,lint --base=origin/main` → 9 projects, 110/110 tests green, lint green.
  Deploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=market-intelligence-ctrl` →
    dev-market-intelligence-ctrl UPDATE_COMPLETE in 56.54s (Ingress/Handler UPDATE_COMPLETE at 12:11:35).
  Production-dev observation: 17-min window post-deploy on
    /aws/lambda/dev-market-intelligence-ctr-IngressHandler*:
    - ERROR events: 0 (was ~6/15min before fix)
    - 3 scheduled REFRESH_TICKs (10:25, 10:40, 10:55 UTC) all clean
    - 25 intent batches, 100% emit new shape `tags=['record', 'update']`
  Integration: `pnpm nx run market-intelligence-ctrl:test-integration` ×2
    → 5/5 pass both times, resilience suite 109s / 101s (down from 600s timeout budget),
      zero "did not produce CDC" warnings.
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

### Root cause #2 — narrative resilience: trap misses EXPLANATION_GENERATED (separate dossier)

Initial hypothesis ("handler doesn't emit EXPLANATION_GENERATED at all") was **wrong**: `services/advisory/advisory-narrative-ctrl/src/agent-service.ts:125-132` writes a `ReasoningOutput` row via a raw `PutCommand` independent of the handler's `WriteIntent[]` return value, and `service.stack.ts:65` maps `ReasoningOutput INSERT → EXPLANATION_GENERATED` for CDC. The basic integration test (`advisory-narrative-ctrl.integration.test.ts:95-98`) asserts `EXPLANATION_GENERATED` with no try/catch and presumably passes — confirming the path works for mock-driven invocations.

Why the resilience-test trap consistently misses it remains unverified. Likely candidates: (a) Parameters & Secrets Lambda Extension SSM cache (5-min TTL) — a warm Lambda still hits the previous test's (now stale) mock URL after `SsmOverrideFixture.overrideAndDeriveRestore` runs in this test's `beforeAll`; (b) `overrideAndDeriveRestore` derives the "restore" value from the current param when it runs, so if a sibling test already mutated the param, the cleanup path corrupts state for the next run.

Moved out to **`advisory-narrative-resilience-cdc-trap-miss.md`** (status: parking). The MI fix stands on its own — the production-dev REFRESH_TICK CCFEx evidence is independent.

## Dossier original hypotheses — status

- **H1 SSM cache propagation**: Not the cause for MI. The CCFEx happens at write time, BEFORE the trap could observe the agent's return value matters. (Cannot rule out for narrative without a separate measurement, but root cause #2 explains the symptom independently.)
- **H2 CDC egress on shared regional row**: Disproved. Zero egress ERROR entries over 24h.

## Fix shape

MI slow-tier: change `record('MarketSnapshot', …)` → an upsert-style write. Two viable shapes:

1. **`update()` + explicit bootstrap** — `update()` requires `attribute_exists(pk)`. Need a one-shot bootstrap that creates the empty `MarketSnapshot#{region}` row at stack-deploy time (a custom resource or a Lambda invocation) OR a fallback `record()` on first tick. Cleaner CDC semantics: every tick is a "Modify" event, not a mix of "Insert" + "Modify".
2. **PutCommand without conditional** — bypass `record()`/`update()` and issue a raw `PutCommand` (no `attribute_not_exists` guard). Always succeeds; row always exists post-tick. Simplest, but bypasses event-processor's idempotency machinery, so a duplicate REFRESH_TICK with the same EB eventId would re-run the agent unnecessarily.

Preferred: option 1 with a single bootstrap row created from `ScheduledEmitter` or a fresh-deploy hook. Falls out of brainstorming below.

Validation gate (this workstream): scheduled REFRESH_TICK in production-dev must stop ERROR'ing within one tick after deploy; MI resilience integration test must run without "Run A refresh tick did not produce CDC" warnings.

## Related

- `feedback_e2e_no_external_mocks.md` — integration tests must mock external APIs. These already do.
- `project_agentcore_cost_safeguards.md` — Haiku floor + P0 cost safeguards on dev (ambient context).
- `investor-ctrl-system-trap-canary-timeout` — sibling dossier whose orphan-accumulation hypothesis is weakened by Measurement A above.
