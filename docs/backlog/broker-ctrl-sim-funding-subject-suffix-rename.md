---
id: broker-ctrl-sim-funding-subject-suffix-rename
status: parking
type: refactor
notes: "broker-ctrl contracts.ts Sim*RequestedSubjectSchema names use the Subject suffix → typed-subject-drift gate fails (convention 4)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-subject-fixtures-program-residue
epic_role: core
---

# broker-ctrl funding-sim contracts use the `Subject` suffix (typed-subject convention 4)

## Evidence

`services/execution/broker-ctrl/src/domain/contracts.ts`:
- line 68: `export const SimDepositInitiatedSubjectSchema = z.object({ … })`
- line 77: `export const SimWithdrawalRequestedSubjectSchema = z.object({ … })`
- lines ~94, ~96: referenced in the `subjectSchemas` map (`SIM_DEPOSIT_INITIATED`, `SIM_WITHDRAWAL_REQUESTED`).

The `event-processor:typed-subject-drift` gate (`tools/check-typed-subjects.mjs`) **hard-fails**:

```
[subject-suffix] services/execution/broker-ctrl/src/domain/contracts.ts:68
  contract `SimDepositInitiatedSubjectSchema` uses a Subject suffix — name it after the clean domain/event concept (<Name>Schema / <Name>)
[subject-suffix] services/execution/broker-ctrl/src/domain/contracts.ts:77
  contract `SimWithdrawalRequestedSubjectSchema` uses a Subject suffix
```

Convention 4: no `Subject`-suffix contract names — name after the clean domain/event concept
(`<Name>Schema` / `<Name>`).

## Provenance

Pre-existing on `origin/main` (this branch never touches broker-ctrl). Surfaced 2026-06-20 by the
`audit-service ledger-ctrl` typed-subject-drift check (step 6.1) during the shipped workstream
[[ledger-ctrl-funding-reducer-depositid-vs-transferid]] — **not** introduced by it.

## Distinct from existing items

- Not [[broker-sim-inbound-schemas-nondry-stale]] — that is `broker-sim-adpt/schemas.ts` carrying
  identity in the subject (DRY violation). This is `broker-ctrl/contracts.ts` **naming**.
- Root-cause sibling of the parking orphan [[residual-generic-subject-casts-cleanup]] — both are
  typed-subject-drift-gate convention violations left un-cleaned. A `/backlog-themes` sweep could
  aggregate these (+ any other gate-flagged convention residue) into a "typed-subject convention
  drift" theme epic.

## Fix

Rename `SimDepositInitiatedSubjectSchema` → `SimDepositInitiatedSchema` (or the cleaner domain concept)
and `SimWithdrawalRequestedSubjectSchema` → `SimWithdrawalRequestedSchema`; update the `subjectSchemas`
map references. Re-run `pnpm nx run event-processor:typed-subject-drift` to confirm green.
