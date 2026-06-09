# Typed-Subject Program — Strategy

- **Date:** 2026-06-09
- **Status:** strategy (umbrella for 3 ranked implementation workstreams + 1 capstone)
- **Supersedes:** `residual-generic-subject-casts-cleanup` (DROPPED — `opaqueSubject` was the wrong core idea)
- **Completes:** the program begun by `event-subject-payload-build-tripwire` (the `parseSubject` seam + first contracts) and the conventions catalogued in `typing-convention-enforcement-skills-docs`.

## North star

Every event a service consumes is **zod-validated and parsed against the producer's exported
schema**. The producer owns *one* schema that types **both** the persisted row (`TableEntry<Subject>`)
**and** the emitted event (`BusEvent<Subject>`). The CDC publisher parses each stream row into its
typed Subject(s) before emitting. Consumers `parseSubject(carrier, <importedProducerSchema>)`.

This is the in-repo equivalent of a schema registry (the producer-exported zod contract is the
registry entry; consumers import it). There is **no `opaqueSubject`** — in a system where every
event has a producer, every subject can be typed, so an opaque read is just un-validated input.
A producer payload change must break consumer builds (the build-tripwire); a producer payload
change that *also* drifts from runtime must be caught by e2e (the schema-vs-reality gate).

## The dependency order (why producer → publisher → consumer)

Both publishers (WS-2) and consumers (WS-3) **import the producer schema**, so the contracts must
land first (WS-1). WS-2 verifies the producer actually *emits* what the schema says (row → subject),
so WS-3 consumers can trust the contract. Enforcement (capstone) can only lock in a codebase that
already complies, so it runs last.

---

## WS-1 (rank 1) — `typed-subject-producer-contracts`

**Scope.** Every producer aggregate exports a zod subject contract (`<Name>Schema` + `type <Name>`),
named after the clean domain/event concept (NO `Subject` suffix; event-aligned name on clash).
Each contract types **both** the row (`TableEntry<Subject>`) and the event (`BusEvent<Subject>`) —
convention (3). Convert the inline-declared row types (e.g. TaxLot, SnapshotRecord, SecFiling, the
DWC projection rows, IP/MI snapshot rows, PE/AN AgentCompletionRow/AgentFailureRow) to
`TableEntry<Subject>`. Establish the **cross-domain re-export**: an event consumed across a domain
boundary has its producer contract re-exported via the **producer domain's adapter `/domain`**
(the `ProposedTrade` precedent: advisory *produces* it, so it sits in `advisory-adpt/domain`) — never
service↔service direct imports (that created the
broker-ctrl↔investor-bff project cycle the prior program hit). Fix the stale
`compliance-ctrl DecisionApprovedSchema`. Includes the advisory inter-agent handoff contracts.

**Home rule.** Intra-domain consumer → imports producer `<svc>/contracts`. Cross-domain consumer →
imports the producer's adapter `/domain` re-export.

**Done.** Every event that any publisher or consumer touches has a producer-owned zod contract
exported per the home rule; producer rows are `TableEntry<Subject>` (no inline row types); the
parameterised context generic `S` (RequestContext) is carried on both `BusEvent<T,S>` and
`TableEntry<T,S>` (convention 5); stale schemas fixed.

**Validation (THE #1 risk).** Each contract is validated against the **REAL** emitted shape — the
actual persisted DDB row / a captured CDC subject — **NOT fixtures**. (The `event-subject-contracts`
lesson: a schema co-wrong with its fixture passed integration; only e2e caught it. The stale
compliance-ctrl schema is proof this already happens.) Producers' own tests + tsc green.

**Deps.** None (foundational). **Folds:** `advisory-inter-agent-handoff-typed-contract`,
`compliance-ctrl-stale-decision-approved-schema`. **Note:** large — warrants its own
brainstorm→spec, phased internally by domain (Investor / Advisory / Execution / Ledger).

## WS-2 (rank 2) — `cdc-publisher-typed-subjects`

**Scope.** Every CDC event-publisher Lambda (`changeDataCapture` pipeline / `event-publisher.ts`
on each `*-egress`) types its DynamoDB stream rows as `TableEntry<Subject>` (multiple row types
under the single-table pattern → discriminate on `__typename`/`sk`), parses/validates each row, and
emits strictly-typed subjects. No `as Record` on rows or emitted subjects.

**Done.** Every publisher works with typed subjects; the row→event mapping type-checks against the
WS-1 contracts; a producer schema change breaks the publisher build.

**Validation.** Publisher unit tests + e2e CDC emission (real row → real emitted event) green.

**Deps.** WS-1 (needs the contracts + `TableEntry<Subject>` row types).

## WS-3 (rank 3) — `consumer-parse-subject`

**Scope.** Every consumer (event-listener handlers, BFF transforms, agent-services) parses each
event it handles via `parseSubject(carrier, <importedProducerSchema>)` — **branch per event type**
(the handler map IS the dispatch; split shared multi-event handlers so each branch is single-
producer). Convert ALL current `opaqueSubject` and `as Record<string,unknown>` subject reads.
**DELETE the `opaqueSubject` helper + its test** (terminal step — only possible once the last caller
is gone). Carry the **execution-ctrl USER_CONFIRMED `decisionId` id-fallback** (captured intent from
the dropped workstream) into the retyped `extractFromPayload`.

**Done.** Zero `as Record<string,unknown>` subject reads and zero `opaqueSubject` in consumers;
helper deleted; every consumer subject read is `parseSubject(producer schema)`.

**Validation.** Consumer unit tests + scoped e2e (incl. the USER_CONFIRMED order-execution scenario,
to validate the decisionId fallback against the REAL advisory-bff producer) green; build-tripwire
verified (a producer payload change breaks a consumer build).

**Deps.** WS-1 (contracts); benefits from WS-2 (verified emissions). Genuinely-polymorphic fan-in
handlers (KB stringify; the 15-event notification deep-link extractor) parse each event against its
producer schema per branch — a discriminated union or per-type registration, NOT an opaque read.

## Capstone (rank 4) — `typing-convention-enforcement-skills-docs` (re-scoped)

ONLY the enforcement layer now: a lint rule / `tools/` check-script forbidding
`as Record<string,unknown>` on subjects, bare subject casts, and any reintroduced `opaqueSubject`;
`create-*`/`audit-*` skill updates; arch-doc updates (conventions 1–5). Runs AFTER WS-1/2/3 so it
locks in an already-compliant codebase. Re-ranked 3 → 4.

---

## Backlog reconciliation

- **DROP** `residual-generic-subject-casts-cleanup` (opaqueSubject pattern abandoned).
  - **Salvaged to main:** B2 (assemble-packet SF-state interface typing), B4 (delete dead
    `OrderLifecycleService`). Both are done/tested/clean and not subject-typing.
  - **Captured for WS-3:** the execution-ctrl USER_CONFIRMED `decisionId` fallback + its regression
    test (the dead class's one unique behavior).
- `advisory-inter-agent-handoff-typed-contract` → **dropped** `[SUPERSEDED -> typed-subject-producer-contracts]`.
- `compliance-ctrl-stale-decision-approved-schema` → **dropped** `[SUPERSEDED -> typed-subject-producer-contracts]`.
- `execution-ctrl-orderrepository-prune-unused-methods` → stays parking (independent).
- **Ranks after pivot:** WS-1=1, WS-2=2, WS-3=3, enforcement-capstone=4,
  `nx-affected-true-affected-resolver`=5, `dashboard-live-push-position-snapshots`=6,
  `broker-funding-completed-normalization-drift`=7.

## Risk register

1. **Schema-vs-reality** — write contracts from the real runtime emission, e2e-gated. (#1.)
2. **Cross-domain project cycles** — mitigated by the adapter `/domain` re-export home rule.
3. **WS-1 size** — phase internally by domain; it is the long pole.
