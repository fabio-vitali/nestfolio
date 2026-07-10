---
name: backlog-lint
description: Validate docs/backlog/ frontmatter against the 11 invariants (incl. epic closure / pointer / single-active-epic) plus element-shape validation against the ring-1 ItemSchema, and (with --fix) regenerate docs/BACKLOG.md from frontmatter and related_workstreams in topic dossiers. Use at every workstream ship and on demand.
---

## When this skill applies

Invoke when:
- A workstream is being shipped (status flips to `shipped`).
- A workstream is being adopted to ACTIVE (status flips to `active`).
- A backlog item is created via `backlog-add`.
- The user asks to verify backlog discipline ("lint the backlog", "check BACKLOG.md", etc.).
- A boundary review is happening (the per-ship 5-minute review).

## How the gate runs (the runtime check-registry)

The `/backlog-next` `preflight`/`postflight` gates validate the backlog store through the **runtime check-registry**:

```
node runtime/engine/lib/run-watch.mjs --on=commit --changed='docs/backlog/*.md'
```

The 11 rules run as their migrated `module:` checks (`runtime/content/checks/backlog-*.yaml`, each delegating to this skill's `lib/rules.mjs` as the single source of truth). The `commit` trigger excludes the `audit` context (no LLM judge needed) and the `docs/backlog/*.md` scope keeps gate-only non-backlog checks (e.g. `typed-subjects`) out, so the gate is deterministic and backlog-scoped. The gate command lives in `.claude/skills/backlog-next/backlog-gate.mjs`.

**Scope note:** the runtime gate rides **every active cheap `invariant`-context check repo-wide**, not only the 11 backlog rules — `--changed` scopes only the *non-invariant* checks. So a non-backlog invariant failing at the gate is expected: it surfaces framed as a `backlog-gate` failure with the true finding in the detail. Fix the finding, or — when the property itself is wrong — curate at the floor (`run-backward.mjs curate`), the only sanctioned path past a failing guard.

The `lint.mjs --fix` index + dossier regen (`renderIndex` / `syncDossiers`) is a **side-car of this skill** — the runtime gate never runs it; `lint.mjs` also remains the home of the 11-rule engine (`lib/rules.mjs`) that the content checks delegate into. (The strangler flag and the standalone `lint.mjs` validation invocation were retired with the legacy work-driver — runtime-legacy-retirement, 2026-07-09.)

## What it enforces

11 rules over `docs/backlog/<id>.md`:

1. `id` matches filename.
2. At most one **non-epic** file has `status: active` (zero is allowed between workstreams).
3. `type ∈ {design, spec}` ⇒ `references:` non-empty + paths exist + `#anchors` resolve.
4. `status: active` ⇒ `out_of_scope:` non-empty. **Active `type: epic`** additionally ⇒ `done_when:` + `scope:` non-empty.
5. `status: shipped` ⇒ `validation_gate` non-empty.
6. `status: queued` ⇒ `rank` set + unique among queued.
7. `docs/BACKLOG.md` matches the auto-generated rendering of frontmatter.
8. `status: queued` ⇒ neither `notes:` nor body may contain "Promote when/on/once/until/after/only" trigger language (both are scanned — notes must not let a trigger escape). If a promotion trigger remains unmet, item belongs in `parking`. To promote: remove the trigger sentence and document why it fired.
9. **Epic closure:** `type: epic` + `status: shipped` ⇒ no member (a file whose `epic:` equals this id) is in a non-terminal status. Core members must be `shipped`/`dropped`; captured members must be resolved/dropped **or** re-homed (e.g. to `<epic>-leftovers`).
10. **Epic pointer integrity:** a member's `epic:` references an existing `type: epic` file; an epic file must NOT carry an `epic:` pointer (1-level tree, no nesting); `epic_role`, when set, ∈ {`core`, `captured`}.
11. **Single active epic:** at most one `type: epic` with `status: active` (the one delivery epic in flight). Theme epics (`status: parking`) and scheduled epics (`status: queued`) are unbounded.

## Structural preconditions (run alongside the 11 rules, not numbered)

Two per-file gates run in `lint.mjs`'s loop **before** the 11 relational rules. They guard the *shape* of a single item's own frontmatter (the 11 rules guard *relationships between* items):

- **`frontmatter-parseable`** — a file whose YAML fence fails to parse is reported located-by-filename instead of crashing the run (relies on `loadBacklogFiles`' total `parseError` field).
- **`item-schema-valid`** — validates each file's frontmatter against the ring-1 `ItemSchema` via the **same** `validateItem` the runtime read path fails closed on (`runtime/engine/schema/item.schema.ts` — single source of truth, no second schema). Catches element-shape corruption the parse gate is blind to: an unquoted scalar with an embedded colon parses as a one-key mapping, so e.g. `out_of_scope` silently becomes an object (or an array holding one) instead of a `string[]`. Left unvalidated, lint would pass **and** the index render would silently drop the item — two silent failures for one typo. Parse-errored files are skipped here (owned by `frontmatter-parseable`); the filename-derived id is injected so id mismatches stay rule 1's concern.

The runtime commit gate already runs shape validation via the `item-store-valid` check (`runtime/content/checks/item-store-valid.yaml` → `item-store-core.mjs`, same `validateItem`). `item-schema-valid` closes the identical gap for every **direct** `lint.mjs` invocation (ship steps, `--fix`, boundary reviews) that never rides that gate.

## Epic schema (frontmatter)

- **Members** add: `epic: <epic-id>` (the parent pointer) + `epic_role: core | captured` (default `core`). `core` drives closure (rule 9); `captured` rides along and never blocks closure.
- **Epic files** (`type: epic`) add: `done_when:` (closure narrative), `scope:` (what folds in as `core`), `out_of_scope:` (the scope-creep guard). No `epic:` pointer. Membership is **derived** from children — never hand-listed on the epic.

## Captured-member audit surface (close-ritual aid)

On every run, lint prints the open `captured` members of any **active** epic:

```
ℹ captured audit — active epic "<id>" has N open captured member(s); re-test each
  against done_when before ship (promote load-bearing ones to core):
```

This is **advisory, never a violation** — it's structural (which files are captured members of the active epic), but *whether* a captured member is actually load-bearing for `done_when` is a judgment the agent makes during the **close ritual** (CLAUDE.md § "Closure & close ritual"). The print exists so required work can't hide under the captured label and silently leftover-spin-out at close. Two disciplines it backstops, both **router/close-ritual prose, not machine-checked** (they're semantic):

- **Predicate routing** (`backlog-add`): role is `core` if leaving the finding undone falsifies a `done_when` clause — not merely "in `scope:`".
- **Atomicity:** one item = one closure verdict; a finding split across core/captured is filed as separate items.

## What `--fix` does

- Regenerates `docs/BACKLOG.md` from per-item frontmatter (rule 7 becomes structurally true).
- Regenerates `related_workstreams:` in topic dossiers (`~/.claude/.../memory/project_*.md`) from `topic_memory:` pointers in backlog files. One-way derive; never hand-edit `related_workstreams:`.

## How to invoke

```bash
# Validate only (exit code 1 on violations, 0 on success)
node .claude/skills/backlog-lint/lint.mjs

# Auto-fix index + dossier related_workstreams, then validate
node .claude/skills/backlog-lint/lint.mjs --fix
```

Override the memory dir for tests:

```bash
NESTFOLIO_MEMORY_DIR=/tmp/test-mem node .claude/skills/backlog-lint/lint.mjs --fix
```

## Procedure

1. Run `node .claude/skills/backlog-lint/lint.mjs --fix` from repo root.
2. If violations remain after `--fix`, surface each one with file + rule name. Do not commit until they're resolved.
3. After a clean run, stage the regenerated `docs/BACKLOG.md` (and any modified per-item files) before committing the workstream change.

## Drift surface this lint cannot catch

- A `references:` entry pointing at a still-existing path/anchor whose semantic meaning has changed (rule 3 is structural, not semantic).
- A missing `topic_memory:` entry that should exist but wasn't added during exec.

These decay slowly and should be caught at the per-ship boundary review.

## Tests

The lib (`frontmatter`, `rules`, `index-render`, `dossier-sync`) is covered by `node:test` suites under `test/`. Use the **glob** form — `node --test <dir>` does not discover suites on Node 24:

```bash
node --test .claude/skills/backlog-lint/test/*.test.mjs
```

The `index-render` tests are **hermetic**: pass an explicit `gitInfo` (`{ dirty: Set, dateMap: Map }`) to `renderIndex` so it never shells out to git. The default `collectGitInfo()` batches all git reads into ≤2 subprocesses for production `--fix` (keeps `lint --fix` sub-second on the live backlog).
