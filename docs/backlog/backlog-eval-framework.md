---
id: backlog-eval-framework
status: active
type: design
notes: "Evaluation framework for the backlog skill suite — decision-point evals run via headless `claude -p` against sandboxed synthetic backlog states + op-stubs, graded by golden assertions + call-log invariants + an LLM judge, measuring quality / cost / latency with a committed baseline + A/B compare mode. Built to prove `backlog-skills-simplification` regresses no behavior and adds value. HIGH coverage on backlog-next-epic (resume gate + merge-ownership + ship-preconditions = γ's blast radius)."
references:
  - docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md
  - docs/reviews/2026-06-24-backlog-eval-framework-spec-review.md
  - .claude/skills/backlog-next-epic/SKILL.md
  - .claude/skills/backlog-add/SKILL.md
  - .claude/skills/backlog-next/SKILL.md
  - .claude/skills/backlog-lint/lint.mjs
  - docs/backlog/backlog-skills-simplification.md
out_of_scope:
  - Real deploys / real e2e — the expensive/irreversible ops are stubbed (deploy.sh / gh / nx / the backlog-next worker).
  - Re-testing backlog-lint's 11 rules themselves (already unit-tested; the runner only invokes the existing node:test suites).
  - Auto-running on a schedule + CI wiring — separate workstreams; this is a manual on-demand skill like benchmark-agents.
  - Testing F-lesson knowledge ("why", not "what") — β relocates it; the framework never asserts on it.
  - Scenarios coupled to current procedure internals (E-step names, helper-call sequences) — banned by a structural lint; assertions are observable outcomes only (golden files / external-stub call-log / internal-op state / terminal kind), so the comparison survives γ's prose→helper refactor.
  - Asserting internal git/worktree/run-state ops via the call-log — those are γ-relocated; they are asserted via resulting FS/git state instead (only the four external stubbed ops — deploy.sh / gh / nx / worker — carry call-log invariants).
spec: docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md
plan: docs/superpowers/plans/2026-06-24-backlog-eval-framework.md
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# Backlog-system evaluation framework

Decision-point eval harness for the backlog skill suite. Each scenario seeds a synthetic backlog
state (+ optional run-state / gh-PR state) in a throwaway git sandbox with the skill files copied
from a chosen git ref, runs the skill via headless `claude -p --output-format stream-json`, and
grades the **outcome** — resulting frontmatter + `lint` exit (golden), the op-stub call-log + tool
trace (positive/negative invariants, e.g. "`gh pr merge` never called"), and an LLM-judge rubric for
fuzzy dimensions. Captures cost (`total_cost_usd`, first-turn input tokens), latency (`duration_ms`,
`ttft_ms`, `num_turns`), and quality (gate-pass-rate + rubric).

**Modes:** `regression` (vs committed `baseline.json`), `compare <refA> <refB>` (A/B head-to-head),
`rebaseline`. Invoked via `/benchmark-backlog`.

**Why it's comparable across a refactor.** `backlog-skills-simplification`'s contract is zero
behavior change → quality must be identical (any diff = regression) and cost/latency should drop
(the value proof). Valid only if scenarios assert outcomes (not procedure), op-stubs sit on the
external behavior boundary, and the baseline is captured on current `main` first. See spec
§ "Why the comparison is valid".

Guards the `backlog-skills-simplification` epic; coverage is deepest on `backlog-next-epic` because
γ (`backlog-skills-procedure-to-tested-helpers`) moves the resume gate / merge-conflict / worktree
logic into helpers — exactly this skill's highest-stakes surface.
