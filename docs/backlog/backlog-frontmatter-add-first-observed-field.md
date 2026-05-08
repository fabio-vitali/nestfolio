---
id: backlog-frontmatter-add-first-observed-field
status: parking
type: tooling
notes: "Add first_observed: ISO-date field to backlog frontmatter; lint enforces presence on new files."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Add `first_observed:` field to backlog frontmatter spec

## Why

Filing date (git commit timestamp on `docs/backlog/<id>.md`) is not the same as discovery date. Two recent confounds proved this is load-bearing:

- The 2026-05-07 backlog-system refactor (`3f5ca4cb..ad8be1e1`) re-homed many older entries — their git-commit dates landed on 2026-05-07/08 even though the underlying findings were older.
- `operating-mode-shape-empty-proposed-trades` was filed on the resplit branch on 2026-05-08; a future reader can't tell from the file alone whether the bug was discovered during the resplit, or pre-existed and was just newly documented. Required a manual `## Timeline` section to disambiguate (commit on `main` once shipped).

Without a structured field, every file with a stale-state risk needs hand-written timeline prose.

## Proposed shape

Frontmatter gains one optional-on-old-files, required-on-new-files field:

```yaml
first_observed: 2026-05-08   # ISO date the failure mode was first witnessed (NOT filing date)
```

Optionally a sibling for clarity:

```yaml
filed_at: 2026-05-08          # auto-populated by backlog-add at write time
```

## Lint enforcement (rule #8)

Extend `.claude/skills/backlog-lint/lint.mjs` to add an 8th invariant:

> "Every backlog file created after `<cutoff-date>` MUST have `first_observed:` set to a valid ISO date string. Files older than the cutoff are grandfathered with `first_observed: null` permitted."

Cutoff date should be the commit that lands this rule, so existing 64 files stay valid without backfill. `backlog-add` skill template is updated to write `first_observed: <today>` by default.

## Out of scope (when this is picked up)

- Backfilling `first_observed:` on the existing 64 files — grandfathering is sufficient. Backfill only on touch.
- Distinguishing "first observed by us" from "first observed in the wild" — single-developer project; collapse to one field.

## Cheapest next step

1. Edit `.claude/skills/backlog-lint/lint.mjs` to validate `first_observed` is either `null` (grandfathered) or a valid ISO date.
2. Edit `.claude/skills/backlog-add/SKILL.md` template to include `first_observed: <today>`.
3. Add a regression test in the lint script's self-test suite (if it has one) — invalid date string → fail; valid → pass.
4. Run `backlog-lint --fix` to verify all 64 existing files still pass under the new rule.
