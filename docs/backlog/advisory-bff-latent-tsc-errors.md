---
id: advisory-bff-latent-tsc-errors
status: dropped
type: bug
notes: "[SUPERSEDED -> dashboard-advisory-readmodel-fixes, merged 2026-06-02] advisory-bff: 6 latent tsc --noEmit errors in advisory.repository.ts ('timestamp' not in TableEntry; same root cause as ledger-ctrl-2). Not a deploy/test blocker."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-bff latent tsc --noEmit errors

`tsc --noEmit -p services/advisory/advisory-bff/tsconfig.spec.json` reports 6 errors,
all `error TS2353: Object literal may only specify known properties, and 'timestamp'
does not exist in type 'TableEntry'`:

- `services/advisory/advisory-bff/src/repositories/advisory.repository.ts:30`
- `…:179`
- `…:204`
- `…:229`
- `…:247`
- `…:265`

**Not a deploy or test blocker** — esbuild strips types and ts-jest is lenient on
excess-property in nested generics. Same class as `investor-bff-13-latent-tsc-errors`
and `ledger-ctrl-2-latent-tsc-errors`.

Surfaced 2026-06-02 during `read-model-ownership-w-a-registrations` when validating
advisory-bff via `tsconfig.spec.json` (which is why WS-A gave advisory-bff an isolated
`tsconfig.type-test.json` instead). Cheapest fix: add `timestamp` to the `TableEntry`
type or drop it from the PutItem object literals — confirm the row shape against the
GSI `typename-timestamp-index` requirement first.
