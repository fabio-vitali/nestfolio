---
id: backlog-skills-misc-polish
status: parking
type: tooling
notes: "Low-severity perf/prose singletons from the 2026-06-22 skills audit: lint --fix spawns ~388 git subprocesses/run; BACKLOG.md date drifts across midnight; node --test <dir> fails on Node 24 + non-hermetic render tests; --auto debug budget is a magic number; E1 rule-11 guard is prose-only."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: backlog-skills-hardening
epic_role: core
---

# Backlog-skills misc polish

Audit findings F-29, F-30, F-31, F-9, F-32 (low severity, genuinely orthogonal but each falsifies the
epic's "audit findings closed" done_when, so filed as core).
See `docs/reviews/2026-06-22-backlog-skills-audit.md` § Secondary findings.

- **F-29 — lint --fix perf.** `lib/index-render.mjs` calls `gitLastCommitDate(f.path)` per shipped file
  *before* the `.slice(0,10)`, and `renderIndex` runs twice per run → ~388 `git log` spawns (~25s).
  Replace with one batched `git log --name-only` call resolved once.
- **F-30 — midnight date drift.** The committed `BACKLOG.md` "Recently Shipped" date (dirty→today)
  drifts from a fresh regen run after midnight (git-commit-date) → postflight `[index-matches]` fails.
  Stamp `closed: <today>` at ship time in both ship steps and make it the authoritative date.
- **F-31 — test ergonomics + hermeticity.** `node --test <dir>` fails on Node 24 (only the glob form
  runs suites); no copy-pasteable test command in either SKILL.md; `backlog-lint` render tests shell
  out to real git (`fatal: Invalid path '/dummy'` spew, non-hermetic). Document the glob invocation +
  make render tests hermetic (inject the git lookups or give fixtures explicit `closed:`).
- **F-9 — debug-budget rationale.** E4.3's `at most 3 debug→re-run cycles` is a magic number; add a
  one-clause rationale so it's self-documenting (optional polish, not correctness).
- **F-32 — rule-11 guard command.** E1's rule-11 guard is prose-only; the run hand-rolled a frontmatter
  grep. Give it a command (note: the E0 preflight does NOT already cover the pre-promotion case — at
  promotion time only 0-or-1 epics are active — so the guard is load-bearing).

## Done when

Each of the five is fixed or consciously dropped; `lint --fix` is sub-second on the current backlog;
`node --test` has a documented, working invocation and the render tests are hermetic.
