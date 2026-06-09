---
id: e2e-contract-emission-bytypename-helper-extract
status: parking
type: refactor
notes: "Rule-of-three: the GSI byTypename(tenantId-index) query helper is now duplicated across the ledger + investor contract-emission e2e gates; extract to a shared e2e helper when the execution slice adds a third."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Extract the `byTypename` GSI-query helper in the contract-emission e2e gates

Surfaced 2026-06-09 during `typed-subject-contracts-investor` review. The
`tenantId-index` GSI query helper (`byTypename(typename)` → query by `(tenantId, __typename)`,
projection ALL) is now duplicated in two contract-emission e2e files:

- `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts`
- `apps/e2e-feature-tests/src/investor/investor-contract-emission.e2e.test.ts`

Two copies is tolerable. The `typed-subject-contracts-execution` slice (next typed-subject domain
slice) will add a THIRD contract-emission gate with the same helper — at that point extract
`byTypename` (and likely the `expectContractMatch`-over-rows polling pattern) into a shared helper
under `apps/e2e-feature-tests/src/helpers/` (alongside `contract-assert.ts`). Promote when the
execution slice is in flight, or fold the extraction into it.
