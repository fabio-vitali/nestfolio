---
id: runtime-item-schema-reconciliation
status: parking
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "Reconcile runtime/engine/schema/item.schema.ts with the real docs/backlog frontmatter (done_criteria→done_when, relax .strict/migrate legacy keys) and wire validateItem into the read path — today ItemSchema has no production importer."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Reconcile the runtime item schema with docs/backlog

`runtime/engine/schema/item.schema.ts` is an idealized abstract contract not wired to the real store:
- It **requires `done_criteria`** — 0 of 402 backlog files have it; 53 use `done_when`.
- It is `.strict()` — rejects the legacy `spec`/`plan`/`topic_memory`/`validation_gate`/`closed`/`notes` keys
  every backlog file carries.
- It has **no production importer** — the engine reads `docs/backlog` frontmatter raw via
  `scope-gate.mjs readItems()`; `plan-next.mjs` operates on an injected array. Neither validates.

Reconcile: rename `done_criteria`→`done_when` (or map), relax/extend the schema for the real keys, then wire
`validateItem` into the read path (scope-gate's `readItems`) so `docs/backlog` IS a validated runtime item
store. This is what lets the forward edge (intake/planner) trust its inputs.
