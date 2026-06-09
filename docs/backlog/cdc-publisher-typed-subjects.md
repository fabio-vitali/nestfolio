---
id: cdc-publisher-typed-subjects
status: queued
rank: 6
type: refactor
notes: "WS-2 of the typed-subject program (strategy: docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md). Every CDC event-publisher Lambda (changeDataCapture pipeline / event-publisher.ts on each *-egress) types its DynamoDB stream rows as TableEntry<Subject> (multiple row types under the single-table pattern → discriminate on __typename/sk), parses/validates each row, and emits strictly-typed subjects — no `as Record` on rows or emitted subjects. Verifies the producer actually emits what the WS-1 contract says (row → subject), so WS-3 consumers can trust the contract. Depends on WS-1 (needs the contracts + TableEntry<Subject> row types). Validation: publisher unit tests + e2e CDC emission (real row → real emitted event) green."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# CDC publisher typed row → subject (WS-2)

Second workstream of the typed-subject program. See the strategy doc for the full picture.

## Goal

Every CDC event-publisher Lambda (`changeDataCapture` pipeline / `event-publisher.ts` on each
`*-egress`) works with **strictly-typed subjects**: type its DynamoDB stream rows as
`TableEntry<Subject>`, parse/validate each row, and emit typed subjects.

## Scope

- Type stream rows as `TableEntry<Subject>`; under the single-table pattern a publisher sees
  multiple row types → discriminate on `__typename` / `sk` and parse each against its WS-1 contract.
- Remove every `as Record` on rows / emitted subjects in the publisher path.
- The row→event mapping type-checks against the WS-1 contracts (a producer schema change breaks the
  publisher build).

## Done

Every publisher emits typed subjects; no generic Record casts in the publisher path.

## Validation

Publisher unit tests + e2e CDC emission (real persisted row → real emitted event) green.

## Deps

WS-1 (`typed-subject-producer-contracts`) — needs the contracts + `TableEntry<Subject>` row types.
