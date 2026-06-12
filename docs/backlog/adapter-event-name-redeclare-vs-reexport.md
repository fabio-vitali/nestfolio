---
id: adapter-event-name-redeclare-vs-reexport
status: parking
type: refactor
notes: "Surfaced 2026-06-12 by the typed-subject-enforcement capstone code review (Phase A cross-domain repoint). The boundary adapters' curated cross-domain event-name maps (LedgerCrossDomainEventTypes in ledger-adpt/src/domain/events.ts, InvestorCrossDomainEventTypes in investor-adpt/src/domain/events.ts) RE-DECLARE each name via eventName('LITERAL') rather than RE-EXPORTING the producer's own constant (e.g. LedgerCtrlEventTypes.PORTFOLIO_UPDATED / InvestorBffEventTypes.MANDATE_ISSUED). Consequence: if a producer renames an event in its own events.ts, the adapter map still carries the OLD literal, so cross-domain consumers (which now import names via the adapter per typed-subject convention 2) silently subscribe to a stale name — broken EB rule + handler dispatch, with ZERO compile error. This is the event-NAME analogue of the payload build-tripwire: the typed-subject program makes a producer PAYLOAD change break consumer builds, but a producer NAME change does NOT break cross-domain consumers because the name is re-declared, not re-exported. Pre-existing pattern (both adapters already did it for ACCOUNT_CLOSURE_REQUESTED / BALANCE_UPDATED etc.); the capstone added 4 more instances (the investor mandate/profile/operating-mode names) without changing the failure mode. Fix options: (a) have the adapter cross-domain map RE-EXPORT (or pick) entries from the producer's own EventTypes constant so a rename is a compile error at the adapter (e.g. `PORTFOLIO_UPDATED: LedgerCtrlEventTypes.PORTFOLIO_UPDATED`), or (b) a check-script asserting each adapter cross-domain name's literal equals the producer's literal. NOT one of the 5 typed-subject conventions (those are payload-typing + import channel), so genuinely adjacent — parked, not folded. Promote when hardening cross-domain event-name integrity or alongside the service-card-drift-gate / a future event-name-registry pass."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: ["project_event_subject_contracts.md"]
validation_gate: null
---

# Adapters re-declare cross-domain event names instead of re-exporting the producer constant

## Why this matters

The typed-subject program's build-tripwire guarantees a producer **payload** change breaks
consumer builds. But cross-domain event **names** are now imported via the producer-domain
adapter's curated `*CrossDomainEventTypes` map (typed-subject convention 2), and that map
**re-declares** each name as `eventName('LITERAL')` rather than re-exporting the producer's
own constant. So a producer renaming one of its events does **not** break cross-domain
consumers at compile time — they keep subscribing to the stale literal (broken EB rule +
dispatch), silently.

## Promote when

Hardening cross-domain event-name integrity, or alongside the `service-card-drift-gate` /
a future event-name-registry pass. See `[[project-event-subject-contracts]]`.
