# Backlog Epics — bound the parking lot by collapsing findings into themes

**Date:** 2026-06-16
**Status:** approved (implemented)
**Supersedes (in part):** `docs/superpowers/specs/2026-05-07-backlog-redesign-design.md` — extends it with a first-class epic object; keeps its storage model, BACKLOG↔MEMORY contract, and the deliberate rejection of a `depends_on` graph.

## Problem

Working any non-trivial backlog item reliably spawns out-of-scope collateral findings. Today
each becomes a flat parking-lot singleton: **66 parking items across ~15 concern areas**, with
no principled way to choose what to clean up, and the list grows without bound.

The real goal is **not** to stop side-findings existing (they're real work) but to bound the
**tracking surface**: stop treating parking as a flat list of singletons and collapse findings
into a bounded set of **theme epics** (root-cause buckets). The number you watch becomes
"themes + un-clustered orphans," and the orphan count is something to actively drive to zero.
A secondary constraint from the user: **clean session context now** outweighs closure speed
("I don't mind delaying closure; I mind dirtying context").

This generalizes a pattern the repo already proved informally — the read-model-ownership
refactoring ("drain QUEUED = done", side-findings folded as `## A./## B.` parts instead of
parked, documented via a ⚠ banner) — into a first-class, lint-checkable object.

## Model

**Epic = one `type: epic` backlog file** owning members via child `epic: <epic-id>` pointers
(mirrors the existing `topic_memory:` → derived `related_workstreams:` one-way pattern;
membership is derived from children, never hand-listed → single source of truth, no graph). It
is a **single-parent tree**, deliberately not the `depends_on` graph the 2026-05-07 spec
rejected for drift.

**Two epic roles** (by `status`):
- **Delivery epic** (`status: active`) — on a closure clock; rule 9 drains it. Exactly one at a
  time (rule 11). The "extended session."
- **Theme epic** (`status: parking`) — a durable root-cause bucket, no ship pressure. Many
  allowed. Promote to `active` when you decide to tackle that theme.

**Two member kinds** (by `epic_role:` on the member, default `core`):
- **`core`** — in the epic's declared `scope`. Defines done — rule 9 drains these.
- **`captured`** — thematically near but out of scope; rode along to keep the session unified.
  Does NOT block closure. Auto-spun-out at close.

The `core`/`captured` split is the central mechanism: generous fold-in keeps context clean
*now*, while closure stays driven only by the epic's actual job — so a delivery epic can never
silently become the new parking lot.

## Frontmatter additions

- **Members:** `epic: <epic-id>` (optional parent pointer) + `epic_role: core | captured`
  (optional, default `core`).
- **Epic files** (`type: epic`): `done_when:` (closure narrative), `scope:` (what folds in as
  core), `out_of_scope:` (scope-creep guard). No `epic:` pointer.

## Side-finding routing (hot path, `backlog-add`)

Cheap per-finding routing mid-workstream; the heavy clustering is deferred to the cold path:

1. **Thematically near the active epic?** → fold in. `core` if within `scope:`, else `captured`.
   Generous: when unsure, choose `captured`.
2. **Else matches an existing theme epic?** → join it (`core`).
3. **Else shares a root cause with ≥1 parking orphans?** → *suggest* minting a new theme epic
   aggregating them (filing finding N organizes {others}+N into one theme).
4. **Else** → parking orphan (the residue).

## Parking clustering (cold path, `backlog-themes`)

On-demand skill: scans parking orphans + `*-leftovers`, proposes clusters by shared root cause
with their blast radius, and on approval mints/extends theme epics and repoints members. Goal:
drive the orphan count → 0; leave genuinely heterogeneous items as reported orphans.

## Closure & close ritual

- **Rule 9:** a `type: epic` may ship only when no member is in a non-terminal status. Core
  members must be `shipped`/`dropped`; open captured members must be re-homed (terminal members
  may keep pointing at the closed epic as provenance).
- **Auto-spin-out:** closing an epic moves still-open captured members into one successor
  `<epic-id>-leftovers` theme epic (`status: parking`) — no per-item triage; `backlog-themes`
  re-clusters later.
- **Escape hatch:** removing a member's `epic:` pointer returns it to standalone parking.

## Enforcement (lint)

`.claude/skills/backlog-lint/lib/rules.mjs` + `index-render.mjs`:
- Rule 2 (revised): "≤1 active" applies to non-epic files only.
- Rule 4 (extended): active `type: epic` ⇒ `done_when` + `scope` (+ `out_of_scope`) non-empty.
- Rule 9 (epic closure), Rule 10 (pointer integrity: pointer resolves to a real epic; no nested
  epics; `epic_role ∈ {core, captured}`), Rule 11 (single active epic).
- Rendering: an **EPICS** section with per-epic `done_when` + a core/captured rollup, a
  **Parking health** line (`N theme epics, M orphans`), and `[epic:X · role]` tags on member
  lines in QUEUED/LATER. Epics live only in EPICS; members appear flat in their status section.

## Decisions & alternatives rejected

| Decision | Choice | Rejected alternative |
|----------|--------|----------------------|
| Epic representation | `type: epic` + `epic:` parent pointer (tree) | `depends_on` graph (drift; rejected 2026-05-07) |
| Concurrency | one active delivery epic; many theme epics | multiple concurrent delivery epics |
| Routing cost | cheap hot path + heavy on-demand sweep | full clustering at every file-time |
| Fold-in attractor | generous ("thematically near") | only cheap + tightly coupled |
| Closure scope | only `core` members block | every folded-in member blocks (epic stalls) |
| Captured at close | auto-spin-out to `<epic>-leftovers` | per-item inline triage at close |

## Out of scope

- A `depends_on` dependency graph; nested/multi-level epics; multiple concurrent active
  delivery epics.
- Migrating historical shipped items into epics; any change to the auto-memory / `project_*.md`
  system beyond the existing one-way pointer contract.

## Verification

- `node .claude/skills/backlog-lint/lint.mjs` passes on the migrated state; `node --test
  '.claude/skills/backlog-lint/test/**/*.test.mjs'` green (incl. negative fixtures for rules
  9/10/11 and rule-4 epic fields).
- `docs/BACKLOG.md` after `--fix` shows the EPICS section, core/captured rollups, the Parking
  health line, and `[epic:X·role]` tags; re-running `lint` reports rule 7 in sync.
- Migration proof: the read-model program modeled as the first delivery epic; `backlog-themes`
  clusters existing parking (starting with the 6 `ts-jest diagnostics:false` items).
