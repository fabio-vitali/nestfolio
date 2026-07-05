---
id: plan-next-computeimpact-object-references-crash
status: queued
rank: 0
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

**Promoted 2026-07-05** (parking → queued, rank 0): user-approved via `/backlog-next <id> --auto` —
load-bearing for the epic's done_when clause 5 (work-driver soak needs `computeImpact` to survive the
real store, which carries 9+ object-form references legalized by the reconciled ItemSchema).

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-05
- **Decision:** Work parked item plan-next-computeimpact-object-references-crash named explicitly in /backlog-next --auto
- **Options:** Promote to queued (rank 0) and proceed | Stop and leave parked
- **Chosen:** Promote to queued (rank 0) and proceed
- **Rationale:** Floor pause (parking dispatch refuses even in --auto); user chose Promote & proceed via AskUserQuestion. Load-bearing for runtime-operationalization done_when clause 5 — computeImpact must survive the real store, which carries 9+ object-form references.
- **Rejected:** Stop: would leave the P5 soak blocked on a known TypeError crash.
