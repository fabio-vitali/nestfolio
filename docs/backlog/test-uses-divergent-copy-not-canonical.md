---
id: test-uses-divergent-copy-not-canonical
status: parking
type: epic
notes: "A test maintains its own copy of production logic/plumbing instead of exercising the canonical module/wrapper, so the canonical thing's changes go uncovered and the copy drifts. Theme epic, 2 members."
done_when: "Each in-scope test is routed through the canonical source (imports the real handler / uses the shared test-support wrapper) so production changes are covered and no divergent copy remains; both members shipped or dropped."
scope: "Tests that reconstruct or duplicate the canonical implementation instead of using it: a unit test that reconstructs handler logic inline rather than importing src, and a test fixture that hand-rolls raw @aws-sdk plumbing instead of the @nestfolio/test-support wrapper."
out_of_scope:
  - "Fixture payload-shape drift vs a producer contract (untyped-fixture-contract-drift) — that is wrong DATA in an otherwise-real call, not a divergent code copy"
  - "Behaviors with no existing test at all (integration-coverage-backfill) — here a test exists but exercises a copy"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Tests exercise a divergent copy, not the canonical source

Root cause: a test maintains its own parallel implementation instead of exercising the one canonical thing it is meant to cover. A unit test reconstructs the handler logic inline rather than importing `src/handlers/...`, so the real handler's typed emissions have zero coverage and a field-name typo would not fail the test. A Playwright fixture hand-rolls a raw `@aws-sdk/client-eventbridge` `PutEventsCommand` instead of the `@nestfolio/test-support` `EventBridgeClient.putEvent()` wrapper, duplicating plumbing that can silently drift. Both give false confidence (or maintenance drift) because the test and the production/canonical code can diverge with nothing failing. Fix pattern: route the test through the canonical module/wrapper (import the real handler with mocked deps; use the shared client).

Members (derived from `epic:` pointers):
- `broker-alpaca-event-listener-test-diverged-copy`
- `nestfolio-e2e-eventbridge-client-wrapper-migration`
