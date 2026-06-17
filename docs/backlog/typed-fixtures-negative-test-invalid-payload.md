---
id: typed-fixtures-negative-test-invalid-payload
status: parking
type: bug
notes: "typed putEvent validates before sending; DWC snapshot-projector negative test can't inject invalid payload"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures
epic_role: captured
---

# Typed putEvent prevents negative-test invalid-payload injection

## Evidence

`services/advisory/decision-workflow-ctrl/test/integration/snapshot-projector.integration.test.ts` (line 259):
The test `"does NOT project a row when MARKET_SNAPSHOT_UPDATED is missing subject.agentOutput"` sends
an intentionally schema-invalid payload (no `agentOutput`) to exercise the handler's fault-tolerance
path (ZodError at `parseSubject` seam → no row written).

After registering `MARKET_SNAPSHOT_UPDATED` in typed-fixtures Phase 2, the typed `putEvent` overload
calls `MarketSnapshotSchema.parse(subject)` **before** sending — so the ZodError is thrown at call
time in the test process, not at the handler. The event is never sent; the fault-tolerance path is
never exercised.

Surfaced during Task 4 migration (`typed-test-fixtures-phase2-advisory`).

## Impact

- The test's intent is broken: it becomes a test that "typed putEvent rejects a bad subject" rather
  than "the handler rejects a bad payload". The former is already covered by the registry tests.
- The fault-tolerance path (handler-side ZodError → no row written) is no longer integration-tested.

## Fix options

1. **Unit-style direct handler call** — invoke `createHandlers().MARKET_SNAPSHOT_UPDATED(payload, ctx)`
   directly with an invalid `payload` object. No EB, no schema guard. Cleanest.
2. **Raw `AwsEBClient.send`** — bypass the typed `putEvent` wrapper entirely. Keeps the integration
   boundary but adds boilerplate.
3. **`eb.putEvent({ detail: ... })`** — temporarily retain the legacy overload for this one call-site
   with a `// TODO: <this-id>` comment. Accepted workaround during Phase 2 (gate skip via comment).

Option 1 is cleanest. The current workaround (Task 4) retains `detail:` with a `// b-finding` comment.
