---
id: plan-next-computeimpact-object-references-crash
status: parking
type: bug
epic: runtime-operationalization
epic_role: core
notes: "computeImpact assumes string references — r.includes()/refResolves(r) crash on the {path, anchor} object form 10 real store files carry."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# computeImpact crashes on object-form references

`runtime/engine/lib/plan-next.mjs:25` — `(item.references ?? []).some((r) => r.includes(item.id))` — and
`:27` — `(item.references ?? []).every((r) => refResolves(r))` — assume every reference is a string.
The reconciled `ItemSchema` (runtime-item-schema-reconciliation, 2026-07-05) validates the real store's
second citation form `{ path, anchor? }` as legal on the read path, and 10 real `docs/backlog` files carry
it. `r.includes` on an object throws `TypeError`; `refResolves(r)` receives an object where project
resolvers expect a path string.

Load-bearing for the epic's done_when clause 5 (work-driver re-platform soaked over real workstreams):
`planNext`/`computeImpact` must run over real store items. Fix pattern: normalize a reference to its path
string (`typeof r === 'string' ? r : r.path`) at the top of `computeImpact`, with a unit test covering the
object form (fixture mirrors `assemble-packet-narrative-explainability-key-mismatch.md`).
