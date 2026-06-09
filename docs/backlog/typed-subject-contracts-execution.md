---
id: typed-subject-contracts-execution
status: queued
rank: 4
type: refactor
notes: "Execution domain slice (slice 3) of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'Execution (slice 3)'). LIVE-MONEY path — validate every contract against the REAL broker emissions, NOT fixtures ([[event-subject-contracts]]). broker-ctrl: order-lifecycle contracts (funding already covered via execution-adpt/domain). broker-sim-adpt: complete coverage (only SimDepositCompleted today). broker-alpaca-adpt: Alpaca order/transfer contracts. execution-ctrl: ORDER_CREATED / STAGED_ORDER_CREATED producer contracts; continues importing ProposedTrade cross-domain from advisory-adpt/domain (authored/converted to zod in the Advisory slice) — no change needed here beyond execution's own producer contracts. Home rule: cross-domain consumers import producer-domain adapter /domain re-exports. Depends on phase-0 (typed-subject-platform-context-taxonomy); the ProposedTrade zod conversion lands in the Advisory slice (advisory produces it). Validation: producer unit tests + tsc green + scoped e2e against the REAL broker path (incl. the funding/order-execution scenarios). Complex lane (worktree + deploy + e2e)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Typed-subject contracts — Execution (slice 3)

Third per-domain slice of the `typed-subject-producer-contracts` umbrella. **Live-money path** —
validate against the **real** broker emissions, never fixtures ([[event-subject-contracts]]). See the
design spec (`§ Execution (slice 3)`).

## Goal

Every Execution-domain producer aggregate has a producer-owned zod contract typing both the row
(`TableEntry<Subject>`) and the event (`BusEvent<Subject>`), validated against the real emitted shape.

## Scope

- **broker-ctrl** — order-lifecycle contracts (funding already covered via `execution-adpt/domain`).
- **broker-sim-adpt** — complete coverage (only `SimDepositCompleted` today).
- **broker-alpaca-adpt** — Alpaca order/transfer contracts.
- **execution-ctrl** — `ORDER_CREATED` / `STAGED_ORDER_CREATED` producer contracts. Continues to
  import `ProposedTrade` cross-domain from `advisory-adpt/domain` (authored/converted to zod in the
  Advisory slice) — no change here beyond execution's own producer contracts.
- Home rule: cross-domain consumers import the producer-domain adapter `/domain` re-export.

## Done

Every Execution event a publisher/consumer touches has a producer contract; rows are
`TableEntry<Subject>`; producers' unit tests + `tsc` green.

## Validation (THE #1 risk)

Scoped e2e against deployed dev validates each contract against the **REAL** broker path (funding /
order-execution scenarios), **not fixtures** ([[event-subject-contracts]]). Producer unit tests +
`tsc` green.

## Deps

Phase-0 (`typed-subject-platform-context-taxonomy`). The `ProposedTrade` → zod conversion lands in
the Advisory slice (advisory produces it); execution imports it cross-domain unchanged.
