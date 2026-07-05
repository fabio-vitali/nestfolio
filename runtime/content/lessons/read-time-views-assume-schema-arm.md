---
id: read-time-views-assume-schema-arm
status: shipped
type: bug
notes: Read-time planner views assumed the string arm of the ItemSchema
  references union; the real store's {path, anchor} arm crashed computeImpact
  with TypeError. The consumer sweep validated the STORE against the schema but
  never swept the CONSUMERS.
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
mints:
  - check: plan-views-total
    ratified: 2026-07-05T15:46:04.173Z
    status: active
---

# Read-time views assume one schema arm while the store legally carries the other

Surfaced 2026-07-05 by `plan-next-computeimpact-object-references-crash`: `computeImpact`
(`runtime/engine/lib/plan-next.mjs`) called `r.includes()` / `refResolves(r)` on every `references:`
entry, assuming the `"path#anchor"` string form. The reconciled ItemSchema
(`runtime/engine/schema/item.schema.ts` references union, re-freeze 2026-07-05) also legalizes
`{path, anchor?}` objects — and 47 such references live in the real store. One object-form reference
anywhere crashed `computeImpact` for EVERY item (`blocks` iterates all items' references).

**The generalized lesson:** the item-schema-reconciliation sweep validated the *store* against the
schema (421-file sweep + `item-store-valid` check) but never swept the *consumers* — read-time view
code can silently assume one arm of a schema union while the store legally carries the other, and no
store-side check can see it. The instance fix (a `refPath` normalizer + regression unit test) covers
today's only consumer; the mechanizable guard is to run the planner views (`planNext`, `computeImpact`,
`renderIndex`) over the REAL store and fail on any throw — totality over real data, not fixtures.
That catches the whole drift class for every future view at ~ms cost.
