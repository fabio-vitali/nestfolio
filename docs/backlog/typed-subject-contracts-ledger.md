---
id: typed-subject-contracts-ledger
status: active
rank: 2
type: refactor
notes: "Ledger domain slice (slice 1) of the typed-subject-producer-contracts umbrella (design: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md § 'Ledger (slice 1)'). Smallest, all tenant-scoped — proves the contract + TableEntry<Subject> + validate-against-real-emission e2e gate end-to-end cheaply, before the richer domains. ledger-ctrl: extend existing contracts (3 schemas today) to cover all emitted events; convert inline rows TaxLot (repositories/ledger.repository.ts) and SnapshotRecord (transforms/snapshot-to-events.ts) to TableEntry<Subject> (drop tenantId → S=RequestContext). reconciliation-ctrl: new contracts for PORTFOLIO_DRIFT_DETECTED + reconciliation lifecycle + drift/projection events. Home rule: intra-domain consumers import producer <svc>/contracts. Depends on phase-0 (typed-subject-platform-context-taxonomy). Validation: producer unit tests + tsc green + scoped e2e asserting the producer emits exactly what each contract declares (real DDB row / captured CDC subject, NOT fixtures — [[event-subject-contracts]] lesson). Complex lane (worktree + deploy + e2e)."
references:
  - docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
  - docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md
out_of_scope:
  - "WS-2 publisher retyping (cdc-publisher-typed-subjects) and WS-3 consumer parseSubject conversion (consumer-parse-subject) — this slice delivers producer contracts + TableEntry<Subject> row conversions only; no publisher/consumer rewrites."
  - "The other three domain slices (investor / execution / advisory)."
  - "The enforcement capstone (typing-convention-enforcement-skills-docs) — skills/docs/lint rules."
  - "Runtime/behavioral changes to emitted event or context payloads beyond what typing requires (typing-only refactor; no field renames on the wire)."
  - "Standing up a Ledger-domain adapter /domain cross-domain re-export unless a real cross-domain importer of a Ledger contract is found during planning (home rule covers intra-domain via <svc>/contracts)."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Typed-subject contracts — Ledger (slice 1)

First (smallest) per-domain slice of the `typed-subject-producer-contracts` umbrella. All tenant-
scoped — chosen first to prove the reusable pattern end-to-end cheaply. See the design spec
(`§ Ledger (slice 1)`).

## Goal

Every Ledger-domain producer aggregate has a producer-owned zod contract typing both the row
(`TableEntry<Subject>`) and the event (`BusEvent<Subject>`), validated against the real emitted shape.

## Scope

- **ledger-ctrl** — extend the existing contracts (3 today) to cover all emitted events; convert
  inline rows **`TaxLot`** (`repositories/ledger.repository.ts`) and **`SnapshotRecord`**
  (`transforms/snapshot-to-events.ts`) to `TableEntry<Subject>`, dropping `tenantId` into
  `S = RequestContext`.
- **reconciliation-ctrl** — new contracts for `PORTFOLIO_DRIFT_DETECTED`, the reconciliation
  lifecycle, and drift/projection events.
- Intra-domain consumers import the producer's `@nestfolio/<svc>/contracts` directly (home rule).

## Out of scope

- WS-2 publisher retyping (`cdc-publisher-typed-subjects`) and WS-3 consumer `parseSubject`
  conversion (`consumer-parse-subject`) — this slice delivers **producer contracts +
  `TableEntry<Subject>` row conversions only**; no publisher/consumer rewrites.
- The other three domain slices (investor / execution / advisory).
- The enforcement capstone (`typing-convention-enforcement-skills-docs`) — skills/docs/lint rules.
- Runtime/behavioral changes to emitted event or context payloads beyond what typing requires
  (typing-only refactor; no field renames on the wire).
- Standing up a Ledger-domain adapter `/domain` cross-domain re-export unless a real cross-domain
  importer of a Ledger contract is found during planning (home rule covers intra-domain via
  `<svc>/contracts`).

## Done

Every Ledger event a publisher/consumer touches has a producer contract; rows are
`TableEntry<Subject>` (no inline row types); producers' unit tests + `tsc` green.

## Validation (THE #1 risk)

Scoped e2e against deployed dev asserts each contract matches the **REAL** emitted shape (actual
persisted DDB row / captured CDC subject), **not fixtures** ([[event-subject-contracts]]). Producer
unit tests + `tsc` green.

## Deps

Phase-0 (`typed-subject-platform-context-taxonomy`) — needs the `SubjectContext`/`RequestContext`
taxonomy + the constrained `TableEntry<Subject>`.
