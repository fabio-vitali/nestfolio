---
id: investor-adpt-legacy-event-name-entries-cleanup
status: shipped
type: refactor
references: []
out_of_scope:
  - "Renaming or relocating the surviving ACCOUNT_CLOSURE_REQUESTED entry. execution-ctrl/handlers/event-listener.ts:109 still consumes via InvestorCrossDomainEventTypes — leaving import path stable."
  - "Touching the duplicate names in BrokerCtrlInboundEventTypes / InvestorBffEventTypes / ExecutionIngestEventTypes — these are the live owners; not duplicates to dedupe in this workstream."
  - "Renaming the InvestorCrossDomainEventTypes constant itself (e.g., to InvestorAdptCrossDomainEventTypes). Breaking-change-style renames belong to a separate workstream if motivated."
rank: null
spec: null
plan: null
topic_memory: []
validation_gate: "pnpm nx run-many -t test -p investor-adpt,execution-ctrl — 7 suites, 62 tests pass. grep '@nestfolio/investor-adpt' across services/libs/apps shows only execution-ctrl imports InvestorCrossDomainEventTypes (ACCOUNT_CLOSURE_REQUESTED, preserved); all other importers use InvestorIngestEventTypes (untouched)."
notes: "Remove unused InvestorCrossDomainEventTypes entries (GOAL_UPDATED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED) from investor-adpt/src/domain/events.ts."
---

# investor-adpt — legacy InvestorCrossDomainEventTypes cleanup

Filed 2026-05-08 during InvestorProfile domain resplit shipping. After the resplit, `investor-adpt/src/domain/events.ts` still declares `InvestorCrossDomainEventTypes` entries (`GOAL_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_CREATED`, `MANDATE_UPDATED`) that are no longer referenced anywhere. Annotated as legacy in the service card; remove the entries (and the `InvestorCrossDomainEventTypes` constant if it's the only consumer left). Estimated 15 min. Promote when an investor-adpt change happens to require touching that file anyway.

## Ship 2026-05-11

Scope broadened from 4 dossier-named entries to 8 dead entries — a grep-based audit found that `RISK_PROFILE_UPDATED`, `DEPOSIT_INITIATED`, `WITHDRAWAL_REQUESTED`, and `EXECUTION_MODE_CHANGED` were also unreferenced (those names are now owned by `BrokerCtrlInboundEventTypes` and `InvestorBffEventTypes`; the entries in `InvestorCrossDomainEventTypes` were never imported). Only `ACCOUNT_CLOSURE_REQUESTED` survived the cull — `execution-ctrl/handlers/event-listener.ts:109` consumes it. Keeping the narrower 4-entry scope would have left the file in an inconsistent state.

Changes:
- `services/investor/investor-adpt/src/domain/events.ts` — `InvestorCrossDomainEventTypes` shrunk from 9 entries to 1 (`ACCOUNT_CLOSURE_REQUESTED`); JSDoc rewritten to explain the new shape ("only for names imported by name from `@nestfolio/investor-adpt/domain`"). `InvestorIngestEventTypes` untouched.
- `services/investor/investor-adpt/CLAUDE.md` — Event Types section updated to reflect new state + reason ("All other outbound investor event names are owned by InvestorBffEventTypes / BrokerCtrlInboundEventTypes / ExecutionIngestEventTypes — not this map.").

Reference-scan evidence: only one importer of `InvestorCrossDomainEventTypes` (`execution-ctrl/handlers/event-listener.ts`) and it uses `ACCOUNT_CLOSURE_REQUESTED` only. All other `@nestfolio/investor-adpt/domain` importers (`investor-ctrl`, `dashboard-bff`, `investor-bff`) use `InvestorIngestEventTypes` which is bit-for-bit unchanged.
