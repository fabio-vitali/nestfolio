---
id: ledger-bff-latent-tsc-errors
status: queued
rank: 12
type: bug
notes: "~18 latent tsc --noEmit errors in ledger-bff src + legacy test-cast errors; not a deploy/test blocker (esbuild strips types). Sibling of investor-bff-13 / ledger-ctrl-2."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# ledger-bff latent tsc --noEmit errors

Surfaced 2026-05-29 during `bff-readmodel-w1-ledger-bff` (Task 4). Same class as
[[project_read_model_redesign]] siblings `investor-bff-13-latent-tsc-errors` and
`ledger-ctrl-2-latent-tsc-errors`: not a deploy or test blocker (esbuild strips
types; ts-jest is lenient on the excess-property/variance cases), but it blocks a
future clean service-wide `typecheck` nx target.

`npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json` reports ~18 errors
in `src` plus more in legacy test files. Representative cases:

- `src/handlers/event-listener.ts` — `UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>`
  not assignable to `UnitOfWork<BusEvent<Record<string, unknown>>>` (generic
  variance on the transform handler signatures).
- `src/repositories/portfolio.repository.ts` (multiple lines, e.g. :78, :98, :118,
  :144, :162) — `'timestamp' does not exist in type 'TableEntry'` (same `TableEntry`
  excess-property issue as ledger-ctrl-2).
- Legacy `test/unit/transforms/*.test.ts` historically used `as Record<string, unknown>[]`
  casts that error under tsc (the w1 transform-test rewrites removed these from the
  three migrated transforms, but other test files in the service may still carry them).

**Why parking (not queued):** does not affect whether any e2e/integration suite
passes today; purely a type-hygiene gap. Promote to QUEUED only if/when a
service-wide `typecheck` target or the w6 governance CI lint needs ledger-bff green.

**Cheapest next step:** fix the `event-listener.ts` `UnitOfWork` generic widening
(align the handler `toUow` generic args) and the `TableEntry` `timestamp` shape
(extend the entry type or stop writing `timestamp` as an excess property), then add
a `typecheck` target. Coordinate with `ledger-ctrl-2-latent-tsc-errors` since the
`TableEntry` fix likely shares a root cause.
