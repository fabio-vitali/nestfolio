---
id: investor-adpt-legacy-event-name-entries-cleanup
status: queued
type: refactor
references: []
out_of_scope: []
rank: 3
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Remove unused InvestorCrossDomainEventTypes entries (GOAL_UPDATED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED) from investor-adpt/src/domain/events.ts."
---

# investor-adpt — legacy InvestorCrossDomainEventTypes cleanup

Filed 2026-05-08 during InvestorProfile domain resplit shipping. After the resplit, `investor-adpt/src/domain/events.ts` still declares `InvestorCrossDomainEventTypes` entries (`GOAL_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_CREATED`, `MANDATE_UPDATED`) that are no longer referenced anywhere. Annotated as legacy in the service card; remove the entries (and the `InvestorCrossDomainEventTypes` constant if it's the only consumer left). Estimated 15 min. Promote when an investor-adpt change happens to require touching that file anyway.
