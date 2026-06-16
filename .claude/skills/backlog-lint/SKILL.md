---
name: backlog-lint
description: Validate docs/backlog/ frontmatter against the 11 invariants (incl. epic closure / pointer / single-active-epic) and (with --fix) regenerate docs/BACKLOG.md from frontmatter and related_workstreams in topic dossiers. Use at every workstream ship and on demand.
---

## When this skill applies

Invoke when:
- A workstream is being shipped (status flips to `shipped`).
- A workstream is being adopted to ACTIVE (status flips to `active`).
- A backlog item is created via `backlog-add`.
- The user asks to verify backlog discipline ("lint the backlog", "check BACKLOG.md", etc.).
- A boundary review is happening (the per-ship 5-minute review).

## What it enforces

11 rules over `docs/backlog/<id>.md`:

1. `id` matches filename.
2. At most one **non-epic** file has `status: active` (zero is allowed between workstreams).
3. `type ∈ {design, spec}` ⇒ `references:` non-empty + paths exist + `#anchors` resolve.
4. `status: active` ⇒ `out_of_scope:` non-empty. **Active `type: epic`** additionally ⇒ `done_when:` + `scope:` non-empty.
5. `status: shipped` ⇒ `validation_gate` non-empty.
6. `status: queued` ⇒ `rank` set + unique among queued.
7. `docs/BACKLOG.md` matches the auto-generated rendering of frontmatter.
8. `status: queued` ⇒ body must NOT contain "Promote when/on/once/until/after/only" trigger language. If a promotion trigger remains unmet, item belongs in `parking`. To promote: remove the trigger sentence and document in body why the trigger fired.
9. **Epic closure:** `type: epic` + `status: shipped` ⇒ no member (a file whose `epic:` equals this id) is in a non-terminal status. Core members must be `shipped`/`dropped`; captured members must be resolved/dropped **or** re-homed (e.g. to `<epic>-leftovers`).
10. **Epic pointer integrity:** a member's `epic:` references an existing `type: epic` file; an epic file must NOT carry an `epic:` pointer (1-level tree, no nesting); `epic_role`, when set, ∈ {`core`, `captured`}.
11. **Single active epic:** at most one `type: epic` with `status: active` (the one delivery epic in flight). Theme epics (`status: parking`) and scheduled epics (`status: queued`) are unbounded.

## Epic schema (frontmatter)

- **Members** add: `epic: <epic-id>` (the parent pointer) + `epic_role: core | captured` (default `core`). `core` drives closure (rule 9); `captured` rides along and never blocks closure.
- **Epic files** (`type: epic`) add: `done_when:` (closure narrative), `scope:` (what folds in as `core`), `out_of_scope:` (the scope-creep guard). No `epic:` pointer. Membership is **derived** from children — never hand-listed on the epic.

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
