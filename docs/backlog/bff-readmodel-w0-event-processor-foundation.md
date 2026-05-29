---
id: bff-readmodel-w0-event-processor-foundation
status: shipped
type: refactor
notes: "Workstream 0 of bff-read-model-materialization-redesign: add the projectVersioned WriteIntent + reserved __version convention + type-level ownership tags (CommandOwned | Projection<'P1'|'P2'|'P3'>) to event-processor, plus the canonical READ-MODEL-OWNERSHIP.md doc and the event-processor-patterns skill update (enforcement layers 1+2). Foundation for the whole rollout; no consumer behavior change yet."
references:
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
  - "services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts"
out_of_scope:
  - "Migrating any BFF read model (workstreams 1-5) — no consumer behavior change in w0."
  - "Skill/audit updates to create-* / audit-* (enforcement layers 3+4 = governance workstream 6)."
  - "Live-push transport (deferred dashboard-live-push-* items)."
  - "Event sourcing on the write side — not adopted."
spec: docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md
plan: docs/superpowers/plans/2026-05-29-bff-readmodel-w0-event-processor-foundation.md
topic_memory: [project_read_model_redesign.md]
validation_gate: |
  Shipped 2026-05-29 on branch worktree-bff-readmodel-w0-event-processor-foundation
  (15 commits, 1cdb0253..3b4f60cc). Subagent-driven: each of 8 tasks passed
  spec-compliance + code-quality review; final whole-implementation review (opus)
  returned READY TO MERGE (mutation-tested the type-level assertions to confirm
  they are not vacuous; verified the factory retrofit added zero new tsc errors at
  real literal call sites).
  Gates (run from worktree):
  - event-processor:typecheck (tsc --noEmit on type-test) → PASS, 0 errors; all
    @ts-expect-error directives consumed (type machinery genuinely rejects wrong
    intent×typename combos; degrades to plain string for unregistered/widened).
  - event-processor:build (real tsc over src) → PASS.
  - pnpm nx affected -t test,lint --base=origin/main → PASS for 29 projects
    (event-processor 291 tests, test-support incl. version-guard, + all consumers
    — the shared-lib change is provably non-breaking).
  Deploy: SKIPPED by user decision — zero runtime behavior change by design
  (projectVersioned/executor/ownership types have no callers yet; factory retrofit
  is type-only/runtime-identical; test-support not bundled). A deploy would rebuild
  ~28 consumers with functionally identical bundles and add no validation signal.
  Layers 1 (types) + 2 (canonical doc) delivered; layers 3+4 deferred to w6.
---

# Workstream 0 — event-processor foundation (versioned projection primitive + type freeze)

First step of the `bff-read-model-materialization-redesign` program (see the spec
for the full model + rollout). No predecessor — ready to start now. Delivers
**enforcement layers 1 + 2** so every later workstream builds on a frozen,
type-checked foundation.

## Deliverables

1. **`projectVersioned` WriteIntent** in `event-processor`: full-row write guarded
   by `attribute_not_exists(pk) OR #__version < :version`; `version` is a
   **required, typed** parameter; on condition-fail the write is **dropped as
   stale/deduplicated** (NOT redriven — distinct from `updateOrRetry`'s
   precondition-wait, which must be preserved).
2. **Reserved `__version` attribute convention** — the monotonic version on an
   owned row, carried in emitted events. Define the attribute + carriage shape;
   `ledger-ctrl` already emits `version`/`lastEventSequence` (the reference).
3. **Type-level ownership tags** — `CommandOwned | Projection<'P1'|'P2'|'P3'>` so
   the intent API steers each typename to its allowed writers: `accumulate` on a
   `Projection`, or a direct command write to a `Projection` typename, **fails to
   typecheck**. Restrict `project` (unconditional overwrite) to seed/command paths.
4. **Canonical doc** `docs/architecture/READ-MODEL-OWNERSHIP.md` — the ownership
   rule + discriminator ("after creation, who drives ongoing state?") + P1/P2/P3
   variants + command-side rules. Single source of truth referenced by skills.
5. **`event-processor-patterns` skill update** — document `projectVersioned`, the
   variants, and "never `accumulate` a cross-event projection."
6. **`test-support` helpers** — version-guard + stale-drop test utilities.

## Out of scope
- Migrating any BFF (those are workstreams 1–5).
- Skill/audit updates to `create-*` / `audit-*` (governance workstream 6).

## Done
`projectVersioned` + type tags compile and are unit-tested (incl. stale-drop and
out-of-order rejection); canonical doc + `event-processor-patterns` updated; no
consumer behavior change (no BFF migrated yet). `pnpm nx affected -t test,lint`
green.
