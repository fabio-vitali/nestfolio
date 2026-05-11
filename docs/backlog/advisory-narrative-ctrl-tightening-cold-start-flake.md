---
id: advisory-narrative-ctrl-tightening-cold-start-flake
status: queued
rank: 10
type: bug
notes: "Lever 1 attempted to tighten waitForItem 60s -> 20s on advisory-narrative-ctrl integration test (sync handler write path). 20s timed out under cold-start; 30s also failed in a 53min run. Reverted to 60s for ship. Needs investigation: either the write isn't truly synchronous in the handler, or cold-start tax is materially larger than dossier estimated. The two sibling agent-ctrls (investor-profile-ctrl, market-intelligence-ctrl) tightened cleanly at 20s."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-narrative-ctrl waitForItem 60s tightening — cold-start flake

Lever 1 (commit `fd0ae5e5`) tightened `waitForItem({timeoutMs: 60_000})` → `20_000` on two of three dossier-flagged agent-ctrl integration tests:

- ✅ `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts:91`
- ✅ `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts:80`
- ❌ `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:81` — deferred.

## Symptom

Test at line 78 — `await table.waitForItem({ table: 'advisory-narrative-ctrl', pk: 'DECISION#<id>', timeoutMs: 20_000 })` — timed out twice in a row (20s then 30s) during Lever 1 validation, before the row could be observed. Comment at the call site claims "agent-service writes IN_PROGRESS record directly to DDB before calling the agent pipeline" — implying the write should be ≤ 1 s after the Lambda starts.

## Hypotheses to investigate

1. **Cold-start tax larger than dossier estimated.** Bedrock AgentCore-routed handlers may have ARM64 image + Bedrock client init cost pushing the first-event invocation past 20–30 s.
2. **The write isn't actually synchronous.** Look at the handler's event-listener pipeline — there may be an `await` chain (KB lookup, SSM read, etc.) before the DDB write that the comment glossed over.
3. **Test ordering effect.** The integration suite runs after the resilience suite when both ran in parallel — the integration test paid the cold-start; running them in isolation gives different behavior.

## Suggested investigation steps

1. CloudWatch Logs `/aws/lambda/dev-advisory-narrative-ctrl-Ingress`: timestamp of `INIT_START` vs first DDB write. Measures actual cold-start + handler-to-write latency.
2. Read `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` to confirm whether the "synchronous write" claim still holds post-refactor (the dossier was written before recent advisory-domain consolidation).
3. If cold-start tax is real, decide: ship a `warmHandler()` step in `beforeAll` (Lever 2 territory) and then 20 s becomes safe; or simply set this site to 45 s (matching `ctx.timings.eventTimeout` default) and call it done.

Until investigated, the existing 60 s value at line 81 stays as-is. No production impact.
