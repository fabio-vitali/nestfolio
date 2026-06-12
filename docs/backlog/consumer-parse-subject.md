---
id: consumer-parse-subject
status: shipped
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
validation_gate: "Shipped 2026-06-12 on branch worktree-consumer-parse-subject. (1) ALL consumer subject reads converted to parseSubject(carrier, importedProducerSchema) across ledger/investor/execution/advisory; repo-wide sweep confirms zero undocumented `as Record<string,unknown>` subject reads — remaining matches are the 4 out-of-scope broker-ctrl normalizer casts, documented boundaries (SF-direct agent invocations, GENERATE_NARRATIVE/CONSTRUCT_PORTFOLIO, external feeds, AppSync DECISION_FEEDBACK, ALPACA routing/webhooks), 2 LangGraph agent-internal upstreamOutputs reads, and 1 row-payload reducer read — none are CDC event-consumer subject reads. opaqueSubject absent (0 occurrences). (2) Captured intent: execution-ctrl USER_CONFIRMED decisionId fallback implemented (fromUserConfirmed reads subject.decisionId; fromDecisionApproved reads ComplianceCheck.decisionPacketId) with a fail-first regression test. (3) parseSubject widened to accept a bare BusEvent carrier (libs/event-processor, additive/back-compat, 313/313 tests) to drop the only `as unknown as` cast. (4) Consumer unit tests green across all touched services. (5) BUILD-TRIPWIRE VERIFIED: renaming BalanceUpdatedSchema.cashBalanceCents broke 4 ledger-bff consumer build sites (TS2551); reverted. (6) nx affected lint green (33 projects); nx affected test green except the pre-existing parked agent-orchestrator @smithy phantom-dep (WS-3 untouched libs/agent-orchestrator; tracked in agent-orchestrator-invoke-agentcore-smithy-phantom-dep). (7) Deployed 17 affected services to dev (deploy.sh sandbox --prefix=dev, all stacks ✅). (8) SCOPED E2E GREEN against the REAL producer: apps/e2e-feature-tests advisory/accept-decision.e2e.test.ts PASS (139s) — 'confirmed decision surfaces as CONFIRMED; downstream fill surfaces in ledger portfolio' — validates the USER_CONFIRMED decisionId fallback end-to-end. Side-findings filed (parking): ledger-ctrl-live-tax-lot-missing-order-fields (ORDER_FILLED lacks symbol/side — live tax-lot path latently broken), alpaca-transfer-request-compound-subject-no-contract. Latent-bug fixes surfaced by typing: broker-ctrl mode-listener read non-existent subject.mode (investor-bff emits toMode) → now reads toMode (live order-routing mode cache was caching undefined); malformed subjects now ZodError-poison-pill instead of silently degrading."
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
