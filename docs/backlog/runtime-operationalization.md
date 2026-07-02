---
id: runtime-operationalization
status: parking
type: epic
notes: "Adopt/operationalize the Long-Horizon Engineering Runtime: make it FIRE on real triggers, migrate the remaining ~23 enforced surfaces into the content ring, reconcile the item schema with docs/backlog, build a regression/benchmark harness, and ship the operator surface. runtime-realization shipped the 3 library slices; THIS epic makes the runtime the project's live enforcement + work loop."
done_when: "The runtime is the project's LIVE enforcement + work-driver, not a dormant library: it fires on at least one real trigger (hook/CI/schedule) via injected live capabilities; the ~34-surface migration into runtime/content/checks is complete (old tools/check-*.mjs + backlog-lint rules + audit skills all represented as CheckEntries); item.schema is reconciled with docs/backlog and validated on read; a baseline/regression harness protects runtime releases; the operator surface (view+executor) is shipped. Every core member shipped or dropped."
scope: "Live wiring (make-it-fire), the full check migration, item-schema reconciliation, the regression/benchmark harness, CI-wiring the check golden gates, and the operator surface. Each a standalone /backlog-next member PR, drained individually like runtime-realization's slices."
out_of_scope:
  - "Re-designing ring-1 engine contracts (schemas/helpers) — frozen by runtime-realization; a build-reconciliation delta re-freezes into SPEC 1, not here."
  - "Authoring NET-NEW checks beyond migrating existing enforcement — new lessons flow through the backward edge / backlog-add."
  - "The 3 spec build slices themselves — that was runtime-realization (shipped)."
references: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime operationalization — adopt the runtime as the live system

`runtime-realization` shipped the Long-Horizon Engineering Runtime as a tested, harness-agnostic **library**
(SPEC 1 registry/atom + SPEC 2 backward edge + SPEC 3 forward edge & capability seams). But **nothing fires
it**: no git hook, CI job, or schedule invokes the loop/watch/gates; the adapter capabilities are stubs until
a host injects live runners; today's real enforcement is still `.git/hooks/pre-commit → tools/check-*.mjs`.

This epic closes that gap — it makes the runtime the project's **actual** enforcement and work loop.

Members (each a standalone `/backlog-next` member PR):
- `runtime-make-it-fire` — the thin live path that dogfoods the seam (the unblocker for the rest).
- `runtime-check-migration-completion` — the remaining ~23 surfaces → content-ring YAML.
- `runtime-item-schema-reconciliation` — align `item.schema.ts` with `docs/backlog`, validate on read.
- `runtime-regression-harness` — baseline/release comparison + loop eval, reusing `defineSuite`.
- `runtime-check-goldengates-ci` — wire the existing `tools/check-*.test.mjs` fixtures into CI.
- `runtime-operational-surface` — the §14 view+executor (re-homed from runtime-realization).

**Sequence:** `runtime-make-it-fire` first — it dogfoods the capability seam on one real path; the operator
surface and the bulk migration land behind that proven path. Migrating 34 checks before anything runs them
is the trap this ordering avoids.
