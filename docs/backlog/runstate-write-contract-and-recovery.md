---
id: runstate-write-contract-and-recovery
status: parking
type: tooling
notes: "The epic run-state JSON (crash-recovery backbone) has no prescribed write mechanism (a prior run hand-wrote malformed JSON), drifted its schema (invented ws*_decisions/paused_at), uses a cwd-relative path that can misclassify RESUME as FRESH, and isn't invalidated when a member is re-opened."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: backlog-skills-hardening
epic_role: core
---

# Run-state write-contract + resume durability

Audit findings F-11, F-12, F-13, F-14.
See `docs/reviews/2026-06-22-backlog-skills-audit.md` § Cluster 4.

## Root cause

`<git-common-dir>/backlog-next-epic-<id>.json` is the resumable epic's only crash-recovery artifact,
but it is written by hand and validated by nothing:

- **F-11** — a prior session hand-wrote malformed JSON (`],\n  ,\n  "paused_at":`) that the resume had
  to repair before it could `JSON.parse`. E3 shows the schema but never says HOW to write/append it.
- **F-12** — the model invented `ws3/ws4/ws5_decisions` arrays + a `paused_at` field, splitting the
  decision log across 3 arrays. E8's PR body reads `decisions[]` only → the split-off decisions would
  never reach the reviewer.
- **F-13** — the resume gate / E3 reference the path via cwd-relative `--git-common-dir`, but E8 uses
  `--path-format=absolute --git-common-dir`. From a worktree cwd the relative form resolves
  differently → a resume can read the wrong path, find nothing, and **misclassify a RESUME as FRESH**
  (re-promote, overwrite the accumulated `decisions[]` / `e2e`).
- **F-14** — E6 recovery re-opens a shipped member but nothing invalidates the recorded `e2e`
  evidence → stale-green ship risk.

## Fix pattern

1. **Mechanical write.** In E3, prescribe a structured read-modify-write
   (`JSON.parse → mutate → JSON.stringify(…, null, 2)`, never hand-edit raw JSON) + a resume self-heal
   parse gate.
2. **Closed schema.** Declare exactly 6 keys (`epic, branch, worktree, auto, decisions, e2e`) — no
   `paused_at`, no per-member arrays; every decision appends one entry to the single `decisions[]`
   tagged by `member`. The in-flight member is re-derived from frontmatter (the single source of truth).
3. **Absolute path everywhere.** Use `git rev-parse --path-format=absolute --git-common-dir` at the
   resume gate + E3 so all sites match E8.
4. **e2e freshness.** Make the `e2e` shape explicit (`{commands, outcome, sha}`) and add an
   `e2e.sha === HEAD` clause to the E7 ship-precondition: a member re-open invalidates a recorded
   green and forces a return to E6.

## Done when

Run-state is only ever written via the structured helper; a malformed run-state yields a clean
self-heal, not a crash; the path is cwd-independent (resume vs fresh classification is reliable); a
re-opened member invalidates stale e2e evidence; a regression test covers each.
