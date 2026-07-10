---
id: backlog-item-frontmatter-integrity
status: shipped
closed: 2026-07-10
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
validation_gate: "Both core members shipped on feat/epic-backlog-item-frontmatter-integrity. (1) backlog-lint-no-element-shape-validation (383a4a19) — lint pre-pass validates frontmatter element shapes against the ring-1 ItemSchema (check side). (2) from-intake-join-theme-cannot-express-epic-role (a8f18a79) — shapeItems threads epicRole through all three epic-attaching write arms (fold/join-theme/mint-aggregation) + renderIntakePrompt requests it route-agnostically; regression tests at ring-1 (shapeItems), adapter (write path), and prompt levels (write side). Per-member gates green: nx run-many -t test,lint -p runtime,tools → 425 pass / 0 fail; runtime:typecheck green; backlog-lint 11/11. E6 batched e2e = justified NO-OP: the epic touched no deployable/service/lib/e2e surface (all changes Tier 0: runtime/ + .claude/skills/), so the audit checks (scoped services/**,libs/**,apps/**) are inapplicable to the diff; the mechanized epic-pre-done batch is additionally broken (unmapped audit-integration-test procedure hard-fails the gate) — both gate defects filed queued as runtime-epic-gate-unmapped-audit-integration-test-procedure + runtime-epic-pre-done-scope-hardcoded-star. E6 disposition user-confirmed at the cost floor (see Decision log)."
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

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-10
- **Decision:** How to clear the epic-pre-done (E6) gate for this runtime-tooling-only epic
- **Options:** Justified no-op + file the 2 runtime-gate defects as queued findings | Fix orchestrator changedScope to the branch diff (runtime-core change, mid-ship) | Map audit-integration-test + run the full headless-Opus batch (~30-60 min, may block on unrelated pre-existing drift)
- **Chosen:** Justified no-op + file the 2 runtime-gate defects (user-confirmed at the E6 cost floor)
- **Rationale:** The epic touched NO deployable/service/lib/e2e surface (all changes Tier 0: runtime/ + .claude/skills/), so the audit checks (scoped services/**,libs/**,apps/**) are inapplicable to the diff — the skill sanctions a no-op E6 with per-member evidence for a no-deployable-code epic. The mechanized batch is additionally broken here: orchestrator.mjs hardcodes changedScope=[**/*], selecting integration-test-completeness whose skill:audit-integration-test procedure is unmapped in makeAuditProcedures -> the judge throws -> gate returns failed. Running it would burn Opus tokens on untouched surfaces and still hard-fail. Keeping the epic atomic + filing the gate defects as their own workstreams is the disciplined, cheapest, ship-the-validated-work path.
- **Rejected:** Full mechanized batch — hard-fails on the unmapped procedure and risks blocking THIS ship on pre-existing drift in services this epic never touched; the orchestrator-scope fix — a shared-surface runtime-core change that expands this epic beyond frontmatter integrity and belongs in its own workstream.
