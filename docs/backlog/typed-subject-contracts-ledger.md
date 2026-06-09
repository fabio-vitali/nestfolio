---
id: typed-subject-contracts-ledger
status: shipped
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
spec: docs/superpowers/specs/2026-06-09-typed-subject-producer-contracts-design.md
plan: docs/superpowers/plans/2026-06-09-typed-subject-contracts-ledger.md
topic_memory: []
validation_gate: "SHIPPED 2026-06-09 (branch worktree-typed-subject-contracts-ledger, c34f08b7..6bf60f21). (1) Producer contracts: event-processor shared ErrorEventSubjectSchema; ledger-ctrl AccountSnapshot/TaxLot/SnapshotHistory schemas + TaxLot row→TableEntry<TaxLot,{tenantId}> + SnapshotRecord→TableEntry<AccountSnapshot> + typed record() subjects; reconciliation-ctrl ReconciliationResult/DriftRecord contracts + typed record() subjects. (2) Unit + lint green: nx run-many test,lint event-processor(308)+ledger-ctrl(112)+reconciliation-ctrl(38) all pass; e2e tsc clean. nx affected test,lint vs origin/main green except the documented agent-orchestrator @smithy worktree-symlink false-FAIL (module-resolution artifact, unrelated; verify on real main post-merge). (3) Deploy: bash deploy.sh sandbox --prefix=dev --services=ledger-ctrl,reconciliation-ctrl → dev-ledger-ctrl ✅ + dev-reconciliation-ctrl ✅ UPDATE_COMPLETE. (4) THE #1-RISK GATE: apps/e2e-feature-tests ledger-contract-emission.e2e.test.ts 2/2 PASS against deployed dev — parsed the REAL persisted DDB rows (AccountSnapshot, BalanceEvent, PortfolioEvent, LedgerEntryEvent, ReconciliationResult, DriftRecord) against the producer contracts (NOT fixtures). (5) Final holistic review: READY TO MERGE. Side-findings filed: funded-fixture-balance-updated-missing-snapshot (pre-existing e2e-suite blocker the gate surfaced — funded() emits a BALANCE_UPDATED missing the contract-required snapshot; gate made independent of it). Per-task: 16 code commits, each two-stage reviewed (spec + quality)."
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
