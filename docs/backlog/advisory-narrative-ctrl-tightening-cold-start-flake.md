---
id: advisory-narrative-ctrl-tightening-cold-start-flake
status: shipped
rank: null
type: bug
notes: "Investigation: write is NOT cold-start-bound — handler runs 5 AgentCore Memory reads + 28s retry sleep BEFORE agentService.runPipeline writes the IN_PROGRESS row. 60s timeout is architecturally necessary at the current handler shape. Two architectural fix paths filed as follow-ups (env-var plumb + eager-write refactor)."
references:
  - "services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:47-63"
  - "services/advisory/advisory-narrative-ctrl/src/agent-service.ts:38-47"
  - "services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:67-73"
out_of_scope:
  - "Handler refactor to write AgentInvocation HEAD row eagerly (filed as advisory-narrative-ctrl-eager-write-refactor)"
  - "Plumb MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE env var on dev Lambda (filed as advisory-narrative-ctrl-memory-retry-env-plumb)"
  - "Re-running integration test in this session (not load-bearing — investigation is code-derived; current 60s passes reliably per dossier history)"
  - "Tightening market-intelligence-ctrl / investor-profile-ctrl timeouts (those shipped cleanly at 20s in Lever 1)"
spec: null
plan: null
topic_memory: []
validation_gate: "Root cause documented in dossier body; misleading test comment at advisory-narrative-ctrl.integration.test.ts:67 rewritten to reflect actual timing; two architectural-fix follow-ups filed in PARKING LOT."
---

# advisory-narrative-ctrl waitForItem 60s tightening — investigation

## Status: SHIPPED 2026-05-13

Investigation-only workstream. No behavioral change. The 60s timeout stays.

## What Lever 1 attempted

Commit `fd0ae5e5` tightened `waitForItem({timeoutMs: 60_000})` → `20_000` on three dossier-flagged agent-ctrl integration tests:

- ✅ `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts:91`
- ✅ `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts:80`
- ❌ `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:81` — timed out at 20 s, then at 30 s in a 53-min retry. Reverted to 60 s for ship.

## Root cause (NOT cold-start)

advisory-narrative-ctrl is structurally different from its two siblings. Compare pre-pipeline work:

| Handler | Pre-`runPipeline` Memory calls | Retry sleep before `runPipeline` |
|---|---|---|
| `investor-profile-ctrl` | 1 (`searchLongTermMemory`) | 0 s |
| `market-intelligence-ctrl` | 1 (`searchLongTermMemory`) | 0 s |
| **`advisory-narrative-ctrl`** | **5 (4× `readUpstreamOutput` + 1× `searchLongTermMemory`)** | **3 + 5 + 8 + 12 = 28 s** |

`advisory-narrative-ctrl/src/handlers/event-listener.ts:47-63`:

```ts
const [investorRecords, marketRecords, portfolioRecordsInitial, preferences, sessionHistory] = await Promise.all([
  session.readUpstreamOutput('investor-profile'),
  session.readUpstreamOutput('market-intelligence'),
  session.readUpstreamOutput('portfolio-engine'),
  session.searchLongTermMemory('narrative preferences communication style'),
  session.searchLongTermMemory('session summaries'),
]);

let portfolioRecords = portfolioRecordsInitial;
const retryDelays = (process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE
  ?? '3000,5000,8000,12000')
  .split(',').map((s) => parseInt(s.trim(), 10));
for (const delay of retryDelays) {
  if (portfolioRecords[0]?.content) break;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  portfolioRecords = await session.readUpstreamOutput('portfolio-engine');
}
```

In production this loop is load-bearing — it absorbs AgentCore Memory's >40 s eventual-consistency window on the most-recent upstream write (the `portfolio-engine` reasoning output). Without it, L1/L2 e2e cases that depend on a complete narrative would observe an empty `portfolio` and produce degraded explanations.

In the integration test, the upstream records never exist (the test injects `GENERATE_NARRATIVE` directly without running the SF chain). Every iteration of the retry loop reads empty and proceeds to the next sleep. The full 28 s elapses, plus the wall-clock of 5 parallel Memory calls (~5–8 s typical), THEN `agentService.runPipeline()` starts and writes the IN_PROGRESS `AgentInvocation` row at `agent-service.ts:38-47` (~1 s into runPipeline).

Total time-to-row: **~33–40 s typical, higher under cold start.** This is why 20 s and 30 s timeouts fail and 60 s holds.

## The misleading test comment

`advisory-narrative-ctrl.integration.test.ts:67`:

```ts
// agent-service writes IN_PROGRESS record directly to DDB before calling the agent pipeline:
// pk: DECISION#<decisionId>, sk: INV#<uuid>, agentName: 'explainability'
```

This is half-true: `agent-service.ts` does write the row at the top of `runPipeline`. But it conflates "agent-service's first action" with "Lambda invocation start". They differ by ~30 s because the handler does Memory orchestration before `runPipeline`.

Rewritten to reflect actual timing — see commit.

## Why not just fix it

Three paths exist; all are architectural fixes in their own right, hence filed as separate backlog entries:

1. **Plumb the env-var override on dev Lambda.** Set `MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE='0,0,0,0'` via CDK on dev deploy. Lets the test see the row in ~5–10 s. Risk: prod and dev behave differently — masks a class of Memory-consistency regressions.

2. **Eager-write refactor.** Add a direct `PutCommand` at the top of the handler that writes an `AgentInvocation` HEAD row with a non-`INV#`-prefixed sk (e.g. `HEAD#<decisionId>`), then leave the existing `INV#<eventId>` lock in agent-service alone. Test asserts on HEAD row. Larger blast radius (CDC publisher, downstream consumers).

3. **Seed upstream Memory records in fixture.** Heavy — requires CreateEvent calls in `beforeAll` for three upstream agents, AND Memory's own eventual consistency means the seeds might not be visible to the handler anyway.

None of these is small enough to absorb into this dossier. Filed as `advisory-narrative-ctrl-memory-retry-env-plumb` and `advisory-narrative-ctrl-eager-write-refactor`.

## What ships

1. Test comment at `advisory-narrative-ctrl.integration.test.ts:67-68` rewritten to accurately describe the ~30 s minimum wall-clock and reference this dossier.
2. Timeout stays at 60 s.
3. Two follow-up backlog entries filed (see PARKING LOT).
4. No production code change.
