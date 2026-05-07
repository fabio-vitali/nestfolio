---
name: backlog-add
description: Create a new backlog file at docs/backlog/<id>.md (default status=parking) and refresh the auto-generated docs/BACKLOG.md index. Use when a side-finding, out-of-scope bug, or future improvement surfaces during execution and should be filed without pivoting from the active workstream.
---

## When this skill applies

Invoke when:
- An out-of-scope failure surfaces during validation of an active spec/plan.
- The user says "park this", "file this for later", "add to backlog".
- A side-finding deserves to be tracked but doesn't justify pivoting.

Do NOT invoke when:
- The finding actually blocks the active workstream's done-definition (then it IS in scope).
- The user is starting a new workstream — use `superpowers:brainstorming` and create the file with `status: queued` or `status: active`.

## What this skill does

Creates `docs/backlog/<id>.md` with minimum-valid frontmatter (default `status: parking`, `type: bug`), then runs `backlog-lint --fix` to regenerate the index.

## Procedure

1. Take the one-liner from the user (or args). If unclear, ask once for: title, type (`bug` | `refactor` | `tooling` | `infra` | `design` | `spec`), and any file:line evidence to put in the body.
2. Compute the `id`: kebab-case slug from the title, ≤ 60 chars, must be unique. Verify with `ls docs/backlog/<id>.md` — if it exists, append `-2`, `-3`, etc.
3. Write `docs/backlog/<id>.md` using the template below.
4. Run `node .claude/skills/backlog-lint/lint.mjs --fix` to refresh `docs/BACKLOG.md` and verify the new file passes.
5. **Commit immediately.** Stage ONLY `docs/backlog/<id>.md` and `docs/BACKLOG.md`. Do NOT use `git add .`. Commit with `docs(backlog): file <id>` (parking), `docs(backlog): promote <id> to QUEUED` (queued), or `docs(backlog): ship <id>` (shipped).
6. Report: "Filed in PARKING LOT: `<id>` (commit `<sha>`). Resuming active workstream."

## File template (parking, default)

```markdown
---
id: <slug>
status: parking
type: bug
notes: "<one-line summary, ≤ 100 chars, shown in BACKLOG.md index>"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# <Title>

<Evidence: file:line refs, hypothesis, cheapest next step. Pointer to topic memory if one exists.>
```

## File template (active or queued)

For status `active`, also fill `out_of_scope:` (rule 4) and `references:` if `type ∈ {design, spec}` (rule 3).
For status `queued`, also fill `rank:` (rule 6).
For status `shipped`, fill `validation_gate:` (rule 5).

## Why auto-commit

Uncommitted backlog edits don't travel cleanly across worktrees, don't survive crashes, and accumulate as hidden todos. File-and-continue should be atomic. The `docs(backlog):` commit prefix is grep-able and squash-merge collapses on PRs.

## Examples of good entries

```markdown
- **`OnboardingRepository.updatePhase` ValidationException on non-mandate commits** — latent backend bug; non-blocking for onboarding e2e per Spec 3 ship.
- **BFF resolver region sweep** — advisory-bff + ledger-bff mutation resolvers likely missing `region` field.
```

## Examples of BAD entries (avoid)

- "TODO: investigate something" (no evidence)
- "Fix the bug we saw earlier" (no path to action)

If you can't be specific, ask one clarifying question before filing.
