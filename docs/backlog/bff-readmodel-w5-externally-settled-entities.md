---
id: bff-readmodel-w5-externally-settled-entities
status: queued
rank: 5
type: refactor
notes: "Workstream 5 (cross-domain, last) of bff-read-model-materialization-redesign: broker-ctrl (Execution) owns the Deposit/Withdrawal funding lifecycle + emits versioned lifecycle events; investor-bff deposit/withdrawal → P1 projections; initiateDeposit → intent event + optimistic UI; ledger-ctrl consumes settled for cash. Fixes deposit-settlement-never-persisted."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# Workstream 5 — externally-settled entities (cross-domain)

The only part of the program that reaches beyond the read-side BFFs. Deposits/
withdrawals are started by the user but finished by an outside system, so the
BFF is not their owner.

## Scope / deliverables
- Designate `broker-ctrl` (Execution) as the funding-lifecycle aggregate owner:
  maintain canonical requested→detected→settled/failed state and emit **versioned
  lifecycle events** (adjacent to `DEPOSIT_DETECTED`). No new service.
- investor-bff `Deposit`/`Withdrawal` rows → pure P1 projections fed by those
  events; register the typenames.
- `initiateDeposit` becomes an **intent event** (outbox / AppSync→EventBridge),
  not a local row write; UI shows "submitting…/pending" optimistically until the
  projection catches up.
- `ledger-ctrl` keeps consuming "settled" to adjust cash (records the effect; it
  does not own the funding rail). Align Orders (already Execution-owned).

## Done
funding lifecycle owned + versioned by broker-ctrl; deposit/withdrawal are P1
projections; settlement is persisted (latent bug #1 fixed by construction);
`initiateDeposit` is an intent event with optimistic UI; integration + scoped
e2e green across Execution + investor + ledger.

## Rollout context
Rank 5 — cross-domain, sequenced last (see spec §"Externally-settled entities").
Funding owner decision settled 2026-05-29 (broker-ctrl). See
[[project_read_model_redesign]].
