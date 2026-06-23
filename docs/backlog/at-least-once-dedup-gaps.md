---
id: at-least-once-dedup-gaps
status: parking
type: epic
notes: "AWS at-least-once / concurrent redelivery can double a side-effect because the path lacks an idempotency/dedup guard. Theme epic, 2 members."
done_when: "Each in-scope side-effecting path is made idempotent against at-least-once / concurrent redelivery (conditional-write dedup guard or equivalent), so a redelivered or duplicate trigger produces the effect exactly once; both members shipped or dropped."
scope: "Side-effecting paths (event emission, Step Functions start, notification write) that are NOT deduped against EventBridge at-least-once redelivery or concurrent executions, so a duplicate/redelivered trigger doubles the effect."
out_of_scope:
  - "Paths already proven idempotent (e.g. the circuit-breaker CLOSE path is deduped via a conditional UpdateItem) — only the un-guarded paths are in scope"
  - "Test-only dedup / trap-buffer races — those are integration-test isolation, not a production at-least-once gap"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# At-least-once / concurrent dedup gaps

Root cause: EventBridge delivers at-least-once and Step Functions executions can run concurrently, but several side-effecting paths assume exactly-once. When the trigger is redelivered (or a sibling execution reaches the same step), the effect fires twice because the transition is not guarded by a conditional write or other dedup. The system already demonstrates the fix elsewhere (the circuit-breaker CLOSE path is a conditional `UpdateItem` on `state=OPEN`, so it emits once per episode) — these are the paths that were not given the same guard. Fix pattern: gate the side-effecting transition behind a conditional write (`attribute_not_exists(...)` / state-precondition) so a duplicate trigger no-ops.

Members (derived from `epic:` pointers):
- `broker-circuit-breaker-concurrent-escalation-duplicate`
- `sf-start-idempotency-at-least-once-redelivery`
