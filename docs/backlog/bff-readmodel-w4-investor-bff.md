---
id: bff-readmodel-w4-investor-bff
status: queued
rank: 4
type: refactor
notes: "Workstream 4 of bff-read-model-materialization-redesign: confirm investor-bff command-owned rows (InvestorProfile/Mandate/Notification/UserConfirmation) follow field-level update + condition + seed-by-event rules; CashBalance → P1 projection; register CommandOwned vs Projection typenames."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# Workstream 4 — investor-bff

investor-bff is mostly command-owned rows; this workstream confirms they obey
the command-side rules and migrates the one external-authority row (CashBalance)
to a projection.

## Scope / deliverables
- Confirm command-owned rows — `InvestorProfile`, `Mandate`, `Notification`,
  `UserConfirmation`/`Rejection`/`Interaction` — use field-level `update()`
  (never full-row Put), condition-expression invariants, and seed-by-one-
  idempotent-event creation (`record()` once, then command-owned).
- `CashBalance` → P1 projection (`projectVersioned`) — ledger is its external
  authority.
- Register investor-bff typenames in `ReadModelOwnership` as `CommandOwned` or
  `Projection<...>` accordingly; the registration makes any mis-write fail
  typecheck.

## Done
investor-bff rows are correctly classified and enforced (command-owned vs P1);
CashBalance is a versioned projection; `event-processor:typecheck` + integration
green; deploy + scoped investor e2e green.

## Rollout context
Rank 4 (see spec §"Decomposition"). See [[project_read_model_redesign]].
