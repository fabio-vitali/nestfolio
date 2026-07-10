---
id: backlog-lint-no-element-shape-validation
status: active
type: tooling
notes: "backlog-lint passes on element-shape-corrupt frontmatter (object inside out_of_scope) and the index render silently drops the item."
references: []
out_of_scope:
  - "The 11 lint semantic invariants themselves (relationships BETWEEN items) — this rule validates the shape/validity of a single item's OWN frontmatter against the ring-1 ItemSchema, orthogonal to the relational rules."
  - "The intake write-side fix (sibling member from-intake-join-theme-cannot-express-epic-role) — that hardens the producer; this hardens the checker."
  - "Repairing existing corrupt data — none remains (the original one-key-mapping corruption was repaired in runtime-item-schema-reconciliation); this prevents recurrence."
  - "Changing the ItemSchema itself — this wires the EXISTING frozen schema into lint as a checker; it does not alter the schema (re-freeze 2026-07-05)."
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: backlog-item-frontmatter-integrity
epic_role: core
---

# backlog-lint does not type-check frontmatter element shapes

Surfaced 2026-07-05 by the runtime-item-schema-reconciliation fail-closed store read: an unquoted
`out_of_scope` scalar with an embedded colon (`` …the raw `modelId: string` everywhere. ``) parsed as an
accidental one-key mapping in `docs/backlog/simplify-agent-orchestrator-model-knob.md`. All 11 lint rules
passed, AND the corrupt entry silently kept that shipped item out of the `BACKLOG.md` Recently Shipped
render — two silent failures for one typo. (Data repaired in that workstream; the runtime read path now
fails closed on such corruption via `validateItem` in `readItems`, but lint itself stays blind.)

Cheapest fix: a lint pre-pass that runs every file's frontmatter through the reconciled
`runtime/engine/schema/item.schema.ts` `validateItem` (single source of truth — no second schema), or at
minimum element-type assertions on `out_of_scope`/`references`/`topic_memory`. NOT folded into the
runtime-operationalization epic: its out_of_scope excludes net-new checks (they flow through the backward
edge / backlog-add), and no done_when clause requires lint-side shape validation.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-10
- **Decision:** How to wire ring-1 ItemSchema element-shape validation into backlog-lint (the check side of the epic)
- **Options:** Add ruleItemSchemaValid to rules.mjs, validating lint's already-parsed frontmatter via the imported validateItem | Call the runtime itemStoreViolations() from item-store-core.mjs inside lint | Also refactor the runtime item-store-valid check to delegate to the new lint rule (one home for all shape validation)
- **Chosen:** Add ruleItemSchemaValid to rules.mjs, validating lint's already-parsed frontmatter via the imported validateItem
- **Rationale:** Reusability: reuses the SINGLE source of truth (validateItem from runtime/engine/schema/item.schema.ts — the same schema the runtime read path fails closed on), and hooks into lint's EXISTING per-file rule loop, so there is zero traversal duplication, no double file I/O, and no double parse-error reporting. Fits the established rules.mjs pattern (the 11 rules + their module: checks already delegate to rules.mjs as the single source). Both the new lint rule and the runtime item-store-core consume the same validateItem, so single-source-of-truth holds without folding one into the other.
- **Rejected:** itemStoreViolations() re-reads and re-parses all 458 files lint already loaded and would double-report parse errors ruleFrontmatterParseable already owns. Refactoring the minted item-store-valid runtime check is out of scope (the runtime commit gate already validates shapes there and works) and adds blast radius to a minted check for no coverage gain — direct lint.mjs invocations were the actual gap.
