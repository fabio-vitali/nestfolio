---
id: consumer-parse-subject
status: active
rank: 8
type: refactor
notes: "WS-3 of the typed-subject program (strategy: docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md). Every consumer (event-listener handlers, BFF transforms, agent-services) parses each event it handles via parseSubject(carrier, <importedProducerSchema>) — BRANCH PER EVENT TYPE (the handler map IS the dispatch; split shared multi-event handlers so each branch is single-producer). Convert ALL current `as Record<string,unknown>` subject reads. DELETE the opaqueSubject helper + its test (terminal step — only possible once the last caller is gone). NOTE: opaqueSubject does not exist on main (the worktree that introduced it was dropped); 'delete' means do NOT reintroduce it. Carry the execution-ctrl USER_CONFIRMED decisionId id-fallback (captured intent from the dropped residual workstream's B3) into the retyped extractFromPayload, e2e-validated against the real advisory-bff producer. Genuinely-polymorphic fan-in handlers (KB stringify; the 15-event notification deep-link extractor) parse each event against its producer schema per branch (discriminated union / per-type registration), NOT an opaque read. Depends on WS-1 (contracts); benefits from WS-2 (verified emissions). Validation: consumer unit tests + scoped e2e (incl. USER_CONFIRMED order-execution) green; build-tripwire verified."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope:
  - "The 4 broker-ctrl deposit-withdrawal-normalizer `as Record<string,unknown>` casts (deposit-withdrawal-normalizer.ts ~lines 26/58/88/96). They are SHARED across the sim AND alpaca funding-completed paths, so they cannot be typed against a single producer schema until a canonical funding-completed event shape is defined. Owned by broker-funding-completed-normalization-drift (rank 6); WS-3 leaves them as the one documented exception."
  - "The enforcement layer (lint rule / tools/ check-script forbidding subject `as Record`/bare casts/reintroduced opaqueSubject; create-*/audit-* skill + arch-doc updates). That is the re-scoped capstone typing-convention-enforcement-skills-docs (rank 4)."
  - "WS-1 producer contracts and WS-2 CDC-publisher typing (both shipped). WS-3 imports those contracts; it does not re-author them or re-touch publisher row typing."
  - "Any consumer behavioral change beyond the one captured execution-ctrl USER_CONFIRMED decisionId fallback. Conversion is read-typing only; do not alter what handlers do with the parsed values."
spec: null
plan: docs/superpowers/plans/2026-06-12-consumer-parse-subject.md
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

## Out of scope

- **The 4 broker-ctrl deposit-withdrawal-normalizer funding casts** (`deposit-withdrawal-normalizer.ts`
  ~26/58/88/96). They are shared across the sim AND alpaca `funding-completed` paths, so they cannot be
  typed against a single producer schema until a canonical funding-completed event shape exists. Deferred
  to `broker-funding-completed-normalization-drift` (rank 6); WS-3 leaves them as the one documented
  exception — its "zero `as Record`" done-definition is "zero, modulo these 4".
- **The enforcement layer** (lint rule / `tools/` check-script forbidding subject `as Record` / bare
  casts / any reintroduced `opaqueSubject`; `create-*`/`audit-*` skill + arch-doc updates). That is the
  re-scoped capstone `typing-convention-enforcement-skills-docs` (rank 4), which runs after WS-3.
- **WS-1 producer contracts and WS-2 publisher typing** (both shipped). WS-3 imports the WS-1 contracts;
  it does not re-author them or re-touch publisher row typing.
- **Behavioral changes** beyond the single captured execution-ctrl USER_CONFIRMED `decisionId` fallback.
  Conversion is read-typing only — do not change what handlers do with the parsed values.

## Done

Zero generic-Record subject reads in consumers (modulo the 4 deferred broker-ctrl funding casts above);
every read is `parseSubject(producer schema)`.

## Validation

Consumer unit tests + scoped e2e (incl. the USER_CONFIRMED order-execution scenario, to validate the
decisionId fallback against the REAL advisory-bff producer) green; build-tripwire verified (a producer
payload change breaks a consumer build).

## Deps

WS-1 (`typed-subject-producer-contracts`); benefits from WS-2 (`cdc-publisher-typed-subjects`).
