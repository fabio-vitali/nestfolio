---
id: backlog-skills-simplification
status: parking
type: epic
notes: "Reduce accreted complexity in the backlog skill suite (~3,900 lines, 19 F-fixes, rationale interleaved into procedures) WITHOUT regressing hard-won lessons or changing behavior."
done_when: "Both core members terminal: (β) SKILL.md procedures read as lean imperative steps with backstory relocated to a LESSONS/pitfalls log and terse guardrails kept inline; (γ) load-bearing multi-step bash dances are encapsulated in tested .mjs helpers rather than narrated in prose. No backlog behavior or lint invariant changed; no F-lesson knowledge deleted."
scope: "The backlog skill suite under .claude/skills/ (backlog-next, backlog-next-epic, backlog-add, backlog-themes, backlog-lint) + their helpers. β = extract F-story/backstory from procedural SKILL.md bodies into a LESSONS/pitfalls log, keep one-line guardrails inline at the step that needs them, de-duplicate repeated lessons (doc-restructuring only). γ = push load-bearing bash procedures (worktree cleanup, PR merge-conflict resolution, the resume gate) out of prose into tested helpers, as epic-members.mjs / runstate.mjs already do."
out_of_scope:
  - "Changing backlog BEHAVIOR or any of the 11 lint invariants (this is structure/readability only)."
  - "The separate selection-by-criteria feature for /backlog-next-epic (its own workstream)."
  - "Deleting any F-lesson knowledge — every lesson is relocated, never lost."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Backlog skills simplification

**Root cause.** The backlog skill suite has grown to ~3,900 lines across five SKILL.md files plus
helpers, encoding **19 hard-won F-number bug fixes**, 11 lint invariants, and a closed-schema
run-state. Much of that complexity is *essential* (the cwd-pinned-worktree `ExitWorktree` saga, the
one-branch/one-PR epic invariant, resume idempotency) — but it is delivered as **dense prose with
rationale interleaved into the procedure**, and the same lesson is often re-narrated in two or three
places. The lived effect is "baroque": the day-to-day imperative steps are hard to find under the
backstory explaining *why* each non-obvious thing must be done a specific way.

The fix is to separate **what to do** (lean imperative procedure) from **why** (relocatable lessons),
and to push **load-bearing bash dances** out of prose into **tested helpers** — without changing any
behavior and without losing a single F-lesson.

**Members (derived from `epic:` pointers — never hand-listed):**

- `backlog-skills-lessons-extraction` (β, core) — readability pass: extract backstory to a LESSONS
  log, keep terse guardrails inline, de-duplicate. Doc-restructuring only; near-zero regression risk.
- `backlog-skills-procedure-to-tested-helpers` (γ, core) — structural pass: encapsulate load-bearing
  multi-step bash procedures into tested `.mjs` helpers. Higher value, higher risk — **needs its own
  brainstorm/investigation before execution.**

**Why one epic.** Both members touch the same SKILL.md surface and share the single root cause
(accreted load-bearing prose). Handling them as one delivery epic = one branch / one PR keeps the
restructure coherent and avoids β and γ fighting over the same files in separate PRs. Both are
**core**: leaving either undone makes a `done_when` clause literally false.
