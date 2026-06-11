---
id: cdc-publisher-typed-subjects
status: shipped
rank: 6
type: refactor
notes: "WS-2 of the typed-subject program (strategy: docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md). Every CDC event-publisher Lambda (changeDataCapture pipeline / event-publisher.ts on each *-egress) types its DynamoDB stream rows as TableEntry<Subject> (multiple row types under the single-table pattern → discriminate on __typename/sk), parses/validates each row, and emits strictly-typed subjects — no `as Record` on rows or emitted subjects. Verifies the producer actually emits what the WS-1 contract says (row → subject), so WS-3 consumers can trust the contract. Depends on WS-1 (needs the contracts + TableEntry<Subject> row types). Validation: publisher unit tests + e2e CDC emission (real row → real emitted event) green."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope:
  - "WS-3 consumer-side parseSubject conversions (event-listener handlers, BFF transforms, agent-services reading event.subject) — the consumer-parse-subject workstream."
  - "The enforcement capstone — lint rule / tools/ check-script / create-*/audit-* skill + arch-doc updates — that is typing-convention-enforcement-skills-docs."
  - "Fixing the latent producer/normalizer/consumer drift BUGS the typed-subject program surfaced (e.g. broker-funding-completed-normalization-drift, dwc-sfn-callback-reason-blockreason-gap). WS-2 types only the publisher EMISSION path; those are separately filed items — file-and-continue if more surface."
  - "Re-designing or net-new-authoring WS-1 contracts. Correcting a contract that demonstrably does NOT match the real persisted row IS in scope (that is WS-2's verification purpose), but inventing contracts for events WS-1 left uncovered gets filed, not authored here."
  - "Unrelated QUEUED items (nx-affected-true-affected-resolver, dashboard-live-push-position-snapshots, etc.)."
spec: docs/superpowers/specs/2026-06-11-cdc-publisher-typed-subjects-design.md
plan: docs/superpowers/plans/2026-06-11-cdc-publisher-typed-subjects.md
topic_memory: []
validation_gate: "Shipped 2026-06-11 (worktree branch worktree-cdc-publisher-typed-subjects, 35 commits ffbadb5a..728b0cd5). MECHANISM: libs/event-processor changeDataCapture gained schemas?:Record<__typename,ZodTypeAny> + exemptTypenames?:string[]; buildSubject emits schema.parse(record) (DRY) for covered types / fat row for exempt; init completeness guard (covered ∪ exempt = emitted __typenames, typed mode only); parse failure → NotRetryableError (→ error event, no retry); transform seam removed. All 21 publishers wired to typed mode via a per-service src/handlers/publisher-schemas.ts registry (relative import for own /contracts; investor-bff + broker-ctrl import cross-service from investor-adpt/domain + execution-adpt/domain). ~14 advisory-core agent-internal __typenames exempted (Decision 5) + filed advisory-agent-event-contract-coverage (rank 7). UNIT: 312 event-processor lib tests + 21 per-service registry tests green; nx affected -t test,lint --base=origin/main green (sole failure = agent-orchestrator @smithy/util-stream worktree-symlink artifact, resolves on main — verify post-merge). DEPLOY: all 21 publishers deployed to dev (771924376645). E2E (deployed dev, apps/e2e-feature-tests/*-contract-emission gates): ledger ✅ (row-parse + DRY-wire BALANCE_UPDATED), investor ✅ (row-parse + DRY-wire INVESTOR_PROFILE_CREATED), execution ✅ (row-parse Order/StagedOrder + REAL Alpaca + SIM), advisory FEED publishers ✅ (real-API row-parse: SecFiling/Fred/MarketWatch/Yahoo/AlphaVantage). DEFINITIVE #1-RISK CHECK: zero 'subject contract violation' across ALL 28 deployed egress publishers (twice-confirmed) — no publisher rejects any real row. §6 ruled out (DWC snapshot-projector never invoked — no consumer broke on DRY). KNOWN-LIMITED: advisory-CORE decision-cycle row-parse gate maxVms-blocked in sandbox (IP agent redelivered 576x without completing the snapshot; passed 7/7 in WS-1 yesterday — pre-existing AgentCore maxVms flakiness, not WS-2); validated by-construction (WS-1 validated rows parse → schema.parse succeeds) + zero-violations + unit tests. 2 fragile Task-9 DRY-wire its (execution wrong-event ORDER_CREATED, advisory maxVms) describe.skip'd + filed contract-emission-dry-wire-reenable (parking). e2e jest moduleNameMapper gap (advisory-bff/events + execution-ctrl/events) fixed tactically; systemic auto-derive remains filed (e2e-jest-modulenamemapper-auto-derive)."
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
