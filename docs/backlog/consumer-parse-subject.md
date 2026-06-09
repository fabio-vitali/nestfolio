---
id: consumer-parse-subject
status: queued
rank: 3
type: refactor
notes: "WS-3 of the typed-subject program (strategy: docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md). Every consumer (event-listener handlers, BFF transforms, agent-services) parses each event it handles via parseSubject(carrier, <importedProducerSchema>) — BRANCH PER EVENT TYPE (the handler map IS the dispatch; split shared multi-event handlers so each branch is single-producer). Convert ALL current `as Record<string,unknown>` subject reads. DELETE the opaqueSubject helper + its test (terminal step — only possible once the last caller is gone). NOTE: opaqueSubject does not exist on main (the worktree that introduced it was dropped); 'delete' means do NOT reintroduce it. Carry the execution-ctrl USER_CONFIRMED decisionId id-fallback (captured intent from the dropped residual workstream's B3) into the retyped extractFromPayload, e2e-validated against the real advisory-bff producer. Genuinely-polymorphic fan-in handlers (KB stringify; the 15-event notification deep-link extractor) parse each event against its producer schema per branch (discriminated union / per-type registration), NOT an opaque read. Depends on WS-1 (contracts); benefits from WS-2 (verified emissions). Validation: consumer unit tests + scoped e2e (incl. USER_CONFIRMED order-execution) green; build-tripwire verified."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Consumer parseSubject conversion (WS-3)

Third workstream of the typed-subject program. See the strategy doc for the full picture.

## Goal

Every consumer subject read is `parseSubject(carrier, <importedProducerSchema>)`. Zero
`as Record<string,unknown>` subject reads; no `opaqueSubject` (it must never be (re)introduced).

## Scope

- Branch per event type (the handler map IS the dispatch); split shared multi-event handlers so each
  branch parses a single producer's schema.
- Convert all event-listener handlers, BFF transforms, and agent-service subject reads.
- Fan-in handlers that read across many producers (KB stringify; investor-ctrl's 15-event
  `NOTIFICATION_ENTITY_MAP` deep-link extractor) parse each event against its producer schema per
  branch — a discriminated union or per-type registration, never an opaque bag.
- **Carry the captured intent:** add the `subject.decisionId` id-fallback to execution-ctrl's
  `extractFromPayload` (USER_CONFIRMED carries `decisionId`, not `decisionPacketId`) — the one unique
  behavior of the deleted `OrderLifecycleService`. Include a regression test.
- Do NOT reintroduce an `opaqueSubject`-style helper.

## Done

Zero generic-Record subject reads in consumers; every read is `parseSubject(producer schema)`.

## Validation

Consumer unit tests + scoped e2e (incl. the USER_CONFIRMED order-execution scenario, to validate the
decisionId fallback against the REAL advisory-bff producer) green; build-tripwire verified (a producer
payload change breaks a consumer build).

## Deps

WS-1 (`typed-subject-producer-contracts`); benefits from WS-2 (`cdc-publisher-typed-subjects`).
