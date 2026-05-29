---
id: bff-readmodel-w1-ledger-bff
status: active
type: refactor
out_of_scope:
  - "Any BFF other than ledger-bff (dashboard/advisory/investor are w2–w5)."
  - "Changing ledger-ctrl's producer side — it already stamps lastEventSequence; w1 only consumes it."
  - "Externally-settled-entity ownership (Deposit/Withdrawal/Order) — that is w5."
  - "Live-push transport for ledger read rows — deferred dashboard-live-push-* family, rebuilt later."
  - "Governance/freeze enforcement layers 3+4 (skills + audits) — that is w6."
  - "AdvisoryStatus P3 re-sourcing — belongs to w2/w3."
notes: "Workstream 1 (reference migration) of bff-read-model-materialization-redesign: migrate ledger-bff read rows to version-guarded P1 projections via projectVersioned, keyed on lastEventSequence as __version. Lowest risk; ledger-ctrl already stamps versions; proves the w0 primitive end-to-end."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: docs/superpowers/plans/2026-05-29-bff-readmodel-w1-ledger-bff.md
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# Workstream 1 — ledger-bff (reference migration)

First consumer of the w0 foundation. ledger-ctrl already emits a monotonic
`lastEventSequence`, so ledger-bff is the lowest-risk place to prove
`projectVersioned` end-to-end against a real producer.

## Scope / deliverables
- Switch ledger-bff's P1 read-row transforms (e.g. `balance-updated`,
  `portfolio-updated`, `ledger-entry-recorded`) from `project()` to
  `projectVersioned()`, carrying `lastEventSequence` as the `__version`.
- Register ledger-bff's P1 typenames in `ReadModelOwnership`
  (`declare module '@nestfolio/event-processor'`) — the moment they're
  registered, any lingering `project()`/`accumulate()` on them fails typecheck.
- Keep append-only rows (snapshot history / `SnapshotAt`) as P2 `record()`.
- Integration tests asserting version-guard behaviour: stale/duplicate version
  dropped, out-of-order delivery rejected — using `@nestfolio/test-support`
  `expectStaleDrop` / `expectVersionedWrite`.

## Done
ledger-bff materializes versioned P1 rows; `ReadModelOwnership` registered;
`event-processor:typecheck` + integration green; deploy to dev + scoped ledger
e2e green. No other BFF touched.

## Rollout context
Rank 1 of the read-model program (see spec §"Decomposition"); foundation w0
shipped. See [[project_read_model_redesign]].
