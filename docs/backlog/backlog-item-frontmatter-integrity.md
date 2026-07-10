---
id: backlog-item-frontmatter-integrity
status: parking
type: epic
notes: "Theme epic (minted 2026-07-10 by backlog-themes). Root cause: backlog-item frontmatter can be silently produced or accepted in a contract-violating state because the runtime item.schema isn't enforced uniformly across the write (intake) and check (lint) boundaries — intake drops epic_role on two routes, and lint passes corrupt element shapes. Both fixes converge on that one schema. 2 core members (1 ex-orphan + 1 ex-leftover)."
done_when: "Both members resolved or dropped: the runtime item.schema is enforced uniformly at the backlog-item write and check boundaries — intake writes a valid, complete item on every route (epic_role expressible on join-theme/mint-aggregation, not just fold), and backlog-lint validates frontmatter element shapes against the same item.schema (no silently-corrupt frontmatter passes lint or silently drops from the index). All members shipped or dropped."
scope: "Boundaries where backlog-item frontmatter can be silently produced or accepted contract-violating because the runtime item.schema isn't enforced there: (a) from-intake-join-theme-cannot-express-epic-role — thread epicRole through the IntakeDecision contract + the join-theme/mint-aggregation arms of shapeItems (today only the fold arm writes it, so intake-filed theme members silently default to core, a rule-9 ship blocker); (b) backlog-lint-no-element-shape-validation — add a lint pre-pass running each file's frontmatter through the reconciled runtime/engine/schema/item.schema.ts validateItem (or at minimum element-type assertions on out_of_scope/references/topic_memory), so a corrupt shape fails lint instead of silently dropping from the index."
out_of_scope:
  - "The 11 lint semantic invariants themselves (backlog-lint enforces relationships between items; this theme is about the shape/validity of a single item's own frontmatter)."
  - "The backlog data-model redesign (shipped) — this hardens the write/check boundaries around the existing model, it does not change the model."
references: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Backlog item frontmatter integrity (enforce item.schema at write + check)

Minted by `/backlog-themes` (2026-07-10). Two findings — one on the **write** side (intake), one on the
**check** side (lint) — share one root cause: **backlog-item frontmatter can be silently produced or
accepted in a contract-violating state because the runtime `item.schema` isn't enforced at that
boundary.** Both fixes converge on wiring that single schema in.

**Members (2, core):**

- `from-intake-join-theme-cannot-express-epic-role` (bug, write side) — intake's `shapeItems` writes
  `epicRole` only on the `fold` arm; `join-theme`/`mint-aggregation` silently drop it, so every
  intake-filed theme member defaults to `core` (a rule-9 ship blocker). Thread `epicRole` through the
  `IntakeDecision` contract and both arms — the closure-predicate instruction is already in
  `renderIntakePrompt`. (Self-demonstrating: THIS item was filed via `run-intake` with
  `epicRole: captured` and landed without it.)
- `backlog-lint-no-element-shape-validation` (tooling, check side) — `backlog-lint` passes
  element-shape-corrupt frontmatter (e.g. an unquoted `out_of_scope` scalar with an embedded colon
  parsing as a one-key mapping) and the index render silently drops the item — two silent failures for
  one typo. Add a lint pre-pass through the reconciled `item.schema.ts` `validateItem` (single source of
  truth — the runtime read path already fails closed on this; lint stays blind).

**Disposition:** durable root-cause bucket (`status: parking`). Promote to a delivery epic when the
item-schema boundary hardening is the active workstream; ships when both members are terminal.
