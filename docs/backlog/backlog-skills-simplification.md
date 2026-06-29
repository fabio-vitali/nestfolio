---
id: backlog-skills-simplification
status: parking
type: epic
notes: "Reduce accreted complexity in the backlog skill suite (~3,900 lines, 19 F-fixes, rationale interleaved into procedures) WITHOUT regressing hard-won lessons or changing behavior."
done_when: "Both core members terminal: (β) SKILL.md procedures read as lean imperative steps with backstory relocated to a LESSONS/pitfalls log and terse guardrails kept inline; (γ) load-bearing multi-step bash dances are encapsulated in tested .mjs helpers rather than narrated in prose. No backlog behavior or lint invariant changed (no F-lesson knowledge deleted) — proven at epic pre-done by a scoped `/benchmark-backlog compare main <branch>` (interleaved A/B over the restructured skills) showing BOTH the regression half (anyGateFlip:false, no gatePassRate drop vs the committed baseline) AND the value half (tokens.total reduced on the restructured skills)."
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

## Validation — the compare gate (not a separate member)

This epic's "no behavior changed" claim is **verified, not asserted**. The whole
`backlog-eval-framework` + `backlog-eval-corpus-hardening` program exists to be the regression
reference this epic diffs against (committed `scripts/benchmark-backlog/baseline.json` — 50
scenarios, `gatePassRate=1`, `anyGateFlip:false`). The verification is the epic's pre-done gate, NOT
a backlog member — it's the test *of* `done_when`, so it lives in `validation_gate` (filled with the
actual numbers at ship), analogous to how `/backlog-next-epic` batches the expensive e2e once at
pre-done.

Method, run at epic pre-done:

- **Tool:** `/benchmark-backlog compare main <branch>` (interleaved A/B — re-runs both refs fresh per
  iteration to cancel cache noise). NOT `regression` (that diffs HEAD vs the frozen baseline, the
  wrong tool for a branch).
- **Regression half (must hold):** `anyGateFlip:false` and no scenario's `gatePassRate` drops vs the
  committed baseline → behavior + lint invariants unchanged.
- **Value half (the point):** `tokens.total` reduced on the restructured skills → the accreted-prose
  inefficiency actually shrank.
- **Scope deliberately.** A blind full 3× corpus compare is ~6 live passes (the corpus is ~115M
  tokens/pass and exceeds one subscription window). Narrow with `--skill=` to the skills β/γ actually
  restructure and cap `--iterations`; widen only if a gate looks shaky. Surface the token cost via
  `AskUserQuestion` before launching (the skill already gates full-corpus runs).
- **Precondition — keep the external boundary observable.** The harness grades the external boundary
  via PATH-shim binaries (`gh`/`nx`/`deploy.sh`/`backlog-next-worker`) and internal git/worktree ops
  by end-state, so the grade is implementation-blind to prose-vs-helper — *provided* γ helpers shell
  out to the stubbed CLI binaries rather than swapping in a library (which silently mutes the shim →
  false green/red). If any helper must use a library, add a shim at that seam first. See the
  `backlog-skills-procedure-to-tested-helpers` "Compare-observability constraint".
