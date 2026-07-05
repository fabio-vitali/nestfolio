---
id: runtime-guide-path-to-live-section-stale
status: parking
type: tooling
epic: runtime-operationalization
epic_role: captured
notes: "runtime/GUIDE.md §7 'path to live' is stale post-make-it-fire — item 1 says the operational surface is parked and the closing line says keep the OLD pre-commit gate, but the runtime gate fires on every commit."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# runtime/GUIDE.md §7 "path to live" is stale post-make-it-fire

Surfaced 2026-07-05 during runtime-item-schema-reconciliation (which updated §7 item 3 to done). The rest
of the section predates `runtime-make-it-fire` (PR #30):

- Item 1 says "Fire it … `runtime-operational-surface`, parked" and recommends a thin pre-commit live path
  — that thin path SHIPPED (`.git/hooks/pre-commit` → `runtime/adapters/git/pre-commit-gate.mjs` runs the
  content-ring commit-trigger checks on every commit, fail-closed).
- The closing line "keep using … the old `pre-commit` gate. The runtime augments them; it does not replace
  them yet" is half-true now — the runtime gate IS live; the legacy structural checks still run after it.
- Item 2's migrated-count ("~11 of ~34–39") should be re-counted at edit time.

Filed as `captured` on the theme epic: GUIDE freshness is genuinely orthogonal to every done_when clause
(closure-predicate test), but belongs with the epic's session context. Cheapest fix: rewrite §7 against
current state at the next member ship that touches the live path.
