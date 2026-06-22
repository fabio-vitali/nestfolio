---
id: runstate-write-contract-and-recovery
status: shipped
closed: 2026-06-22
type: tooling
notes: "The epic run-state JSON (crash-recovery backbone) has no prescribed write mechanism (a prior run hand-wrote malformed JSON), drifted its schema (invented ws*_decisions/paused_at), uses a cwd-relative path that can misclassify RESUME as FRESH, and isn't invalidated when a member is re-opened."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Built .claude/skills/backlog-next-epic/runstate.mjs (library + thin CLI) + test/runstate.test.mjs (12 tests). F-11: all writes go parse->mutate->JSON.stringify via the helper; parseRunState self-heals malformed JSON into a clean error (no raw throw at resume) — covers the exact `],\\n  ,\\n  paused_at:` corruption shape. F-12: closed 6-key schema (epic,branch,worktree,auto,decisions,e2e + optional e8); validateRunState rejects invented keys (paused_at, wsN_decisions); appendDecision pushes ONE flat decisions[] tagged by member, append-only by construction. F-13: runStatePath uses `git rev-parse --path-format=absolute --git-common-dir` at every site (resume gate, E3, E8) — cwd-independent, no RESUME->FRESH misclassification. F-14: e2e shape {commands,outcome,sha}; e2eIsFresh + `runstate.mjs e2e-fresh` gate added to E7 ship-preconditions (a re-opened member moves HEAD -> stale -> back to E6). SKILL.md E3/E5/E6/E7/E8 + resume gate rewired to the helper. Gate: full skill suite 104/104 (node --test), backlog-lint 11/11, helper dogfooded on live run-state (get validates; e2e-fresh STALE pre-E6; append round-trips). No deploy/e2e (skill scripts; batched e2e is epic E6)."
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
