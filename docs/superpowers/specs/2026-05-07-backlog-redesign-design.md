# Backlog redesign: hybrid index + per-item files + BACKLOG↔MEMORY contract

**Status:** Design
**Author:** fabio + Claude
**Date:** 2026-05-07

## Problem

The current backlog implementation is hitting four coupled limits:

1. **File scaling.** `docs/BACKLOG.md` is 19KB / 161 lines; multi-paragraph entries make it hard to scan past completed work, and re-ranking is manual.
2. **Discipline drift.** References lines, `Out of scope` sections, and the file-and-continue rule are enforced socially via CLAUDE.md prose, not validated. Drift between conversations is invisible until the next workstream-boundary review.
3. **Read/query gaps.** `backlog-add` writes; reading is grep-only. No first-class queries like "what's QUEUED touching service X" or "PARKING items >90 days old."
4. **Cross-surface fragmentation.** Workstream state is split across `docs/BACKLOG.md`, `MEMORY.md` "Recently Completed Work", `MEMORY.md` "Active / Planned Work", per-workstream `project_*.md` topic files, design specs, plans, and git commits — with no canonical record per workstream and visible duplication. `MEMORY.md` is also over its 24.4KB soft cap (currently 31KB), tripped largely by these duplications.

The CLAUDE.md "Backlog Discipline" rules are sound, but they're enforced only by convention. This spec proposes the structural changes that make the discipline mechanically maintainable.

## Goals

- One canonical record per workstream, addressable by stable id.
- An always-loaded thin index that preserves the ACTIVE/QUEUED/PARKING discipline at a glance.
- Lint-validated invariants for the discipline rules that matter (single ACTIVE, References for design entries, Out-of-scope before activation, validation_gate on ship).
- Mechanical fix for the MEMORY.md 24KB cap by removing duplicated sections.
- A drift-resistant contract between backlog files and topic dossiers.

## Non-goals (Out of scope)

- Migrating older shipped work (pre-MEMORY "Recently Completed Work" cutoff) to backlog files. They live in git + topic dossiers; backfill is on-demand only.
- Replacing the auto-memory system or `project_*.md` topic dossiers. Topic dossiers stay as long-arc technical wikis.
- Unifying `project_*.md` files into the backlog model. Workstreams ≠ topic dossiers; the conflation is rejected (see §"Coordination model" below).
- Adopting Backlog.md (MrLesk) or Linear MCP. The kanban-column model fights "one ACTIVE"; SaaS leaves git. (Comparison reasoning is in conversation history, not committed.)
- Building a query CLI or web UI. The lint skill + grep + auto-generated index cover the read paths needed today.
- Migrating away from the `.claude/skills/` skill model.

## Coordination model: BACKLOG ↔ MEMORY (option 4 — explicit two-way contract)

The two systems serve different verbs and have different correctness properties. Conflation is rejected.

| | `docs/BACKLOG.md` (+ `docs/backlog/`) | `~/.claude/.../memory/` |
|---|---|---|
| Audience | dev + Claude + collaborators (in-repo) | only Claude, only on this machine |
| Persistence | git, committed | per-user, per-machine, never committed |
| Verb | *decide what to do next* | *recall what was true last time* |
| Decay | items have closed states (shipped/dropped) | memories rot, must be verified before use |

The **only real duplication** today is:

1. `MEMORY.md` § "Recently Completed Work" — multi-paragraph ship narratives that should be the body of closed backlog files.
2. `MEMORY.md` § "Active / Planned Work" — drift-prone status duplication of BACKLOG ACTIVE/QUEUED.

`project_*.md` topic dossiers are *not* duplication — they're long-arc technical wikis spanning many workstreams (e.g., `project_e2e_workflow.md`).

### The contract

**Workstream record** lives in `docs/backlog/<id>.md`. It owns: status, references, ship commits, validation gate, narrative.

**Topic dossier** lives in `~/.claude/.../memory/project_<topic>.md`. It owns: cross-cutting patterns, gotchas, recurring lessons that span workstreams.

**Pointers are one-way (truth flows from backlog to dossier):**

- Backlog frontmatter has `topic_memory: [project_X.md, ...]` — hand-written, the source of truth.
- Dossier frontmatter has `related_workstreams: [<id>, <id>, ...]` — **regenerated** by `backlog-lint --fix`, never hand-edited.

This kills the round-trip rule that would have drifted, and replaces it with a mechanical derive that runs on demand.

**MEMORY.md after the redesign**: architecture facts, key decisions, user preferences, technical notes, topic-file index. **No** "Recently Completed Work" section. **No** "Active / Planned Work" section. Both are rendered redundant by `docs/BACKLOG.md` (always loaded for human reading; Claude reads it via skill workflow).

## Storage shape

```
docs/BACKLOG.md                # auto-generated thin index
                               # sections: ACTIVE / QUEUED / PARKING / Recently Shipped (last 10)
                               # never hand-edited; backlog-lint --fix rebuilds it

docs/backlog/<id>.md           # one file per workstream, ever
                               # status frontmatter distinguishes open/shipped/dropped
                               # never moves folders (no archive/)

~/.../memory/MEMORY.md         # shrunken: arch + decisions + prefs + tech notes + topic index
~/.../memory/project_*.md      # topic dossiers (unchanged in shape; gain related_workstreams)
```

**Cross-refs everywhere are by `id`, never by file path.** This decouples the reference layer from the filesystem layout. Topic dossiers carry `related_workstreams: [investor-profile-collapse]` (just ids); CLAUDE.md links by id; the lint resolves id → path internally. There is only ever one path per id: `docs/backlog/<id>.md`.

**No archive folder.** Closed items stay in place with `status: shipped|dropped`. Reasoning:

- The auto-generated index already filters by status — reading is never polluted by shipped clutter.
- Filesystem moves on close make the lint responsible for filesystem state, not just content. A lint bug can appear to lose data.
- `git log docs/backlog/<id>.md` works straight; no `--follow` needed.
- Two-path grep tax persists with archive even with id-refs.
- "Visual tidiness in `ls`" is the only real win for archive, and `ls` is not how anyone reads the backlog.

## Frontmatter schema

```yaml
---
id: portfolio-engine-mode-aware-validation     # kebab-case slug, matches filename
status: active | queued | parking | shipped | dropped
type: spec | design | tooling | infra | bug | refactor
rank: null                                      # integer, only when status=queued; unique among queued
references: []                                  # required when type ∈ {design, spec}
                                                # entries: docs/architecture/SYSTEM-ARCHITECTURE.md#7.2-portfolio-construction
                                                #          flows/advisory-decision.flow.yaml
out_of_scope: []                                # required before status transitions to active
spec: null                                      # path to docs/superpowers/specs/<...>-design.md
plan: null                                      # path to docs/superpowers/plans/<...>-plan.md
topic_memory: []                                # filenames in memory dir, e.g., project_operating_mode.md
validation_gate: null                           # required when status=shipped; short string
                                                # e.g., "5/5 e2e onboarding, 39/41 integration"
notes: ""                                       # one-line summary shown in BACKLOG.md index
---

# <Title>

<Body — design rationale, ship narrative on close, anything else>
```

11 stored fields. **Auto-derived from git, not stored**: `opened`, `closed`, `ship_commits`. The lint computes them on demand for display.

**Dropped intentionally** (would drift, no honest way to maintain): `blocked_by`. If blockers are real, they go in body prose where staleness is visible at read time.

### Why slug ids over numeric

Slugs are stable across renames, grep-friendly (`grep -l portfolio-engine-mode docs/backlog/`), and human-meaningful. Numeric ids (Backlog.md uses `task-001`) collide with parallel branches and don't carry meaning.

## Lint rules

`backlog-lint` is a new skill that runs at every workstream ship and on demand.

1. `id` matches filename (`<id>.md`).
2. Exactly one file has `status: active`.
3. `type ∈ {design, spec}` ⇒ `references:` non-empty AND every cited path exists on disk AND every `#anchor` is grep-findable in the cited file.
4. `status` transitions to `active` ⇒ `out_of_scope:` non-empty.
5. `status: shipped` ⇒ `validation_gate` non-empty.
6. `status: queued` ⇒ `rank` is set and unique among queued items.
7. `docs/BACKLOG.md` index matches files in `docs/backlog/` (no orphans, no missing entries).

`backlog-lint --fix` performs:

- Regenerate `docs/BACKLOG.md` from per-item frontmatter (rule 7 becomes structurally true).
- Regenerate `related_workstreams:` in topic dossiers from all `topic_memory:` pointers across `docs/backlog/*.md` (one-way derive).

Honest drift surface that lint **cannot** catch between ships:
- A `references:` entry pointing at a still-existing path/anchor whose *meaning* has changed (rule 3 catches structural existence, not semantic match). Same residual risk CLAUDE.md already accepts.
- A `topic_memory:` pointer that *should* exist but wasn't added during exec. Mitigated by the boundary-review-on-ship rule.

These are acceptable because they decay slowly and surface at the next ship boundary.

## Skill changes

- **New**: `backlog-lint` — implements the 7 rules + the two `--fix` regenerators. Replaces the periodic boundary-review-by-eye with mechanical validation.
- **Updated**: `backlog-add` — instead of appending a one-liner to `docs/BACKLOG.md` PARKING LOT, creates `docs/backlog/<id>.md` with `status: parking` + minimum frontmatter, then runs `backlog-lint --fix` to refresh the index.
- **CLAUDE.md § "Backlog Discipline"** — rewritten to point at `docs/backlog/<id>.md` as the canonical record, the lint as the enforcement mechanism, and the option-4 contract as the BACKLOG↔MEMORY rule.

## Migration

5 phases, each a separate PR. Claude drafts; human reviews before merge.

| Phase | Work | Reversible? |
|---|---|---|
| 0 | Write `backlog-lint` skill; update `backlog-add` skill; rewrite CLAUDE.md § "Backlog Discipline"; create empty `docs/backlog/`. | Pure additive. |
| 1 | Migrate ~21 open items (1 ACTIVE + ~5 QUEUED + ~15 PARKING) from `docs/BACKLOG.md` sections to `docs/backlog/<id>.md` files. Replace `BACKLOG.md` with auto-generated index. | Atomic; lint must pass before merge. |
| 2 | Backfill ~10 shipped items from `MEMORY.md` "Recently Completed Work" with `status: shipped`. Delete that MEMORY section. | Lossy if a narrative drops; full human review. |
| 3 | Reconcile + delete `MEMORY.md` "Active / Planned Work" — entries should already exist as backlog files from Phase 1. Verify, then delete. | Mechanical. |
| 4 | Run `backlog-lint --fix` to populate `related_workstreams:` in ~22 topic dossiers. | Mechanical, single commit. |

**Older shipped work is not migrated.** It lives in git + topic dossiers; backfill is on-demand only.

## Done definition

- `docs/backlog/` populated; `docs/BACKLOG.md` auto-generated and verified by lint.
- `MEMORY.md` is below 24.4KB soft cap.
- `MEMORY.md` no longer has "Recently Completed Work" or "Active / Planned Work" sections.
- All `project_*.md` topic dossiers have `related_workstreams:` frontmatter populated.
- CLAUDE.md § "Backlog Discipline" rewritten to reflect the new model.
- `backlog-lint` skill exists and passes on the migrated state.
- `backlog-add` skill creates per-item files (verified end-to-end).
- This spec gets its own backlog file `docs/backlog/backlog-redesign.md` with `status: shipped` once migration completes.

## References

- `CLAUDE.md` § "Backlog Discipline" (lines 71–90) — current discipline rules being formalized
- `CLAUDE.md` § "Skill Routing" (lines 44–69) — where `backlog-lint` registers
- `docs/BACKLOG.md` — current single-file shape being decomposed
- `~/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` — current shape; sections "Recently Completed Work" and "Active / Planned Work" being removed
- System prompt § "auto memory" — the four memory types (user, feedback, project, reference) that govern dossier semantics
