---
id: backlog-lint-no-element-shape-validation
status: parking
type: tooling
notes: backlog-lint passes on element-shape-corrupt frontmatter (object inside
  out_of_scope) and the index render silently drops the item.
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
mints:
  - check: item-store-valid
    ratified: 2026-07-05T13:37:16.820Z
    status: active
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
