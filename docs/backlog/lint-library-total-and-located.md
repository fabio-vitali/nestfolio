---
id: lint-library-total-and-located
status: active
type: tooling
notes: "backlog-lint render crashes opaquely (no filename) on non-string or duplicate-key frontmatter the skills themselves produce; 4 fragmented frontmatter parsers diverge from the lint gate. Make rendering total + parse errors located + unify on one parser."
references: []
out_of_scope:
  - "detect-deploy-needed.mjs / detect-doc-derivation.mjs readers (the 2 detect-* parsers) — those are the 3rd/4th forks but are homed in the deploy-tooling-integrity epic (F-1, F-2/F-3); this member unifies only epic-members.mjs onto the canonical lint parser"
  - "lint --fix performance (F-29 ~25s / per-shipped-file git log fan-out) — owned by backlog-skills-misc-polish"
  - "--auto decision discipline, merge ownership, run-state, ship/merge mechanics — separate backlog-skills-hardening core members"
  - "The backlog data-model redesign itself (backlog-redesign) — this hardens the parser/render machinery, not the model"
spec: docs/superpowers/specs/2026-06-22-lint-library-total-and-located-design.md
plan: docs/superpowers/plans/2026-06-22-lint-library-total-and-located.md
topic_memory: []
validation_gate: null
epic: backlog-skills-hardening
epic_role: core
---

# Make the backlog-lint library total + located, and unify the frontmatter parsers

Audit findings F-15, F-16 (read-side), F-18, F-19, F-20, plus the backlog-add non-string write-side.
See `docs/reviews/2026-06-22-backlog-skills-audit.md` § Cluster 1.

## Root cause

The lint library is not total over the malformed YAML the skills can write, and there are **four**
independent frontmatter parsers that can disagree with each other.

- `lib/index-render.mjs:18` does `f.frontmatter.notes?.trim()` — the `?.` guards null but **not** a
  non-string. A `notes:`/`done_when:`/`scope:` written as a YAML list or number (e.g. a `backlog-add`
  one-liner starting with `-` or `:`) throws `TypeError: …trim is not a function` **with no filename**.
  Same unguarded `.trim()` at lines ~73/75.
- A **duplicate** `validation_gate:` key throws `YAMLParseError: Map keys must be unique` — and the
  ship steps actively cause this (templates ship `validation_gate: null`; the ship step adds a second
  one). That crash lands inside `renderIndex` (the `--fix` WRITE), which can leave a stale index.
- `epic-members.mjs` carries a 4th hand-rolled regex parser that keeps inline comments
  (`epic_role: captured # rides along` → member vanishes from both rosters; `status: active # WIP`
  → an in-flight core treated terminal → `isDrainable()` wrongly true) and turns `rank: null` into `NaN`.

## Fix pattern

1. **Total render.** In `lib/index-render.mjs` add `const str = x => typeof x === 'string' ? x : x == null ? '' : String(x);` and route every frontmatter `.trim()` through it.
2. **Located parse errors.** In `lib/frontmatter.mjs`, wrap `parseFrontmatter` so a YAML error is rethrown prefixed with the filename (or surfaced as a rule-1-style violation) instead of a raw throw — mirror the existing dossier-sync guard.
3. **Unify parsers.** Have `epic-members.mjs` import `loadBacklogFiles` from `backlog-lint/lib/frontmatter.mjs` (the bundle already ships the `yaml` dep, so the "lift-as-is / dependency-light" rationale is weak — divergence from the gate is the actual bug). Or extract one zero-dep reader both import.
4. **Write-side guard (backlog-add).** Ensure `notes:` is always written as a quoted scalar (the read-side total render is the primary fix; this is defense-in-depth).

## Done when

`lint.mjs --fix` never throws on any frontmatter a skill can legally write; a malformed file yields a
located rule violation naming the file; `epic-members.mjs` parses identically to the lint gate
(inline comments + `rank: null` handled); a regression test covers each case.
