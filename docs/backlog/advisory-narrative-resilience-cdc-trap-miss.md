---
id: advisory-narrative-resilience-cdc-trap-miss
status: parking
type: bug
notes: "Resilience-suite EventBusTrap on EXPLANATION_GENERATED consistently times out despite mock-agent-runtime + SsmOverrideFixture; basic integration suite passes the same assertion. Likely warm-Lambda SSM cache or overrideAndDeriveRestore corrupting param state."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: ssm-override-warm-cache-test-isolation
epic_role: core
---

# advisory-narrative-ctrl resilience test misses EXPLANATION_GENERATED

Split off from `mock-agent-runtime-cdc-unreliable.md` on 2026-05-28 once empirical
measurement disproved that workstream's coupling of the two symptoms — MI's
CCFEx was the dominant signal; the narrative leg has a distinct (and still
unverified) cause.

## What the dossier got wrong on first pass

Initial claim was "handler emits AgentCompletion only; trap waits for
`EXPLANATION_GENERATED`; trap can't fire". That is **wrong**. The full path is:

- `services/advisory/advisory-narrative-ctrl/src/agent-service.ts:125-132` issues a
  raw `PutCommand` for a `ReasoningOutput` row (independent of the handler's
  `WriteIntent[]` return value).
- `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:65` maps
  `ReasoningOutput INSERT → EXPLANATION_GENERATED` for CDC.
- The basic integration test
  `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:95-98`
  asserts `EXPLANATION_GENERATED` with **no try/catch** and presumably passes
  (this suite is not currently in CI gate; assumption needs reconfirmation).

So the path works for mock-driven invocations. The question is why the
**resilience** test consistently observes the trap timing out.

## Hypotheses (not yet measured)

1. **Parameters & Secrets Lambda Extension SSM cache** (5-min default TTL).
   A warm Lambda from a prior test invocation still holds the previous
   `/nestfolio/${prefix}-advisory-narrative-ctrl/agent/runtimeUrl` value.
   `SsmOverrideFixture.overrideAndDeriveRestore` mutates the param but the
   warm Lambda doesn't see the new value until its cached entry expires
   (≤ 5 min) or the container recycles.

2. **`overrideAndDeriveRestore` derives "restore" from current value.**
   If the basic test runs first, overrides, but cleanup mis-fires (or another
   process touches the param mid-run), the resilience test's call to
   `overrideAndDeriveRestore` "derives" a restore value that is itself the
   override URL — corrupting the param permanently for subsequent runs. Then
   the resilience test's "override" no-ops (param already at mockUrl from a
   stale state) and on cleanup it "restores" to the still-stale mockUrl,
   leaving production-dev's MI runtime URL pointing at a dead mock.

3. **Cold-start budget vs 90s timeout.** Less likely given the basic test
   uses the same Lambda and waits at most 60s for the row, but worth a
   measurement pass.

## Cheapest next step

1. **Verify the basic test still passes against deployed dev.**
   `pnpm nx run advisory-narrative-ctrl:test-integration -t "should write AgentInvocation record to DDB on GENERATE_NARRATIVE"` —
   if this fails on EXPLANATION_GENERATED, the cause is structural, not
   warm-Lambda-cache.
2. **Tail the IngressHandler log during the resilience test.** Confirm the
   handler is actually invoked and whether `agent-service.ts:127` runs.
3. **Inspect `SsmOverrideFixture.overrideAndDeriveRestore` for an
   "already overridden" guard.** If absent, this is the second hypothesis.

## Related

- `mock-agent-runtime-cdc-unreliable.md` — sibling workstream that shipped the
  MI half of the original umbrella.
- `feedback_measure_before_proposing.md` — this dossier deliberately stays
  parked until a measurement run produces evidence; promoting on theory alone
  is exactly the pattern that rule was written against.
