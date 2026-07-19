---
id: advisory-adpt-cross-domain-event-types-missing-decision-packet-updated
status: parking
type: bug
notes: "AdvisoryCrossDomainEventTypes omits DECISION_PACKET_UPDATED, forcing investor-adpt to independently redeclare the same wire string locally."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# AdvisoryCrossDomainEventTypes missing DECISION_PACKET_UPDATED

`AdvisoryCrossDomainEventTypes` (`services/advisory/advisory-adpt/src/domain/events.ts:7-17`) omits
`DECISION_PACKET_UPDATED`, which decision-workflow-ctrl genuinely produces and investor-adpt/dashboard-bff
genuinely consume cross-domain. Because it's missing from the canonical list, investor-adpt independently
redeclares the same wire string locally (`InvestorIngestEventTypes.DECISION_PACKET_UPDATED`), so a future
rename on either side would silently break the contract with no compiler signal. This is exactly the
[[event-name-integrity]] epic's (b) case: a cross-domain map re-declaring a literal instead of re-exporting
the producer's constant.
