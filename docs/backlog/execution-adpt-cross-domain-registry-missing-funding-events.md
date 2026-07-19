---
id: execution-adpt-cross-domain-registry-missing-funding-events
status: parking
type: bug
notes: "ExecutionCrossDomainEventTypes omits 4 genuinely-produced funding events confirmed cross-domain by flow specs."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# ExecutionCrossDomainEventTypes missing funding events

`ExecutionCrossDomainEventTypes` (`services/execution/execution-adpt/src/domain/events.ts:20-28`) lists
only `DEPOSIT_DETECTED`, `DEPOSIT_SETTLED`, `WITHDRAWAL_SETTLED`, omitting `DEPOSIT_REQUESTED`,
`DEPOSIT_FAILED`, `WITHDRAWAL_REQUESTED`, `WITHDRAWAL_FAILED`, all of which are genuinely
produced/consumed cross-domain per `flows/deposit.flow.yaml` and `flows/withdrawal.flow.yaml`. The
doc-comment on `FundingSnapshotSchema` three lines away in the same package correctly lists all 7 — a
stale canonical producer registry, same class as the advisory-adpt DECISION_PACKET_UPDATED gap
([[advisory-adpt-cross-domain-event-types-missing-decision-packet-updated]]).
