# Backlog-system evaluation framework — design

**Date:** 2026-06-24
**Status:** design (approved in brainstorming; pending user spec review)
**Workstream:** `backlog-eval-framework`
**Motivates / guards:** the `backlog-skills-simplification` epic (β `backlog-skills-lessons-extraction`, γ `backlog-skills-procedure-to-tested-helpers`).

## Problem

The backlog skill suite (`backlog-add`, `backlog-next`, `backlog-next-epic`, `backlog-themes`,
`backlog-lint`) is ~3,900 lines of `SKILL.md` prose plus helpers, encoding 19 hard-won F-fixes and
11 lint invariants. We want to evolve it — starting with `backlog-skills-simplification` — and be
able to prove each change **(a) does not regress behavior** and **(b) actually adds value** (lower
cost / latency), measuring **quality, cost, and latency**.

The deterministic helpers (`lint.mjs`, `rules.mjs`, `runstate.mjs`, `epic-members.mjs`, the
classification helpers) already have `node:test` unit suites. The **untested gap** is the
**orchestration layer** — the `SKILL.md` prose an LLM executes (routing, lane classification, epic
core-vs-captured selection, severity ranking, the resume gate, merge-ownership). That layer is also
the *only* place cost and latency are meaningful, and exactly what a "simplification" can regress.

## Goals

1. Catch behavior regressions in the orchestration layer when skill prose/helpers change.
2. Quantify the value of a change: cost (USD/tokens) and latency (wall-clock/turns) deltas.
3. Be **valid across a behavior-preserving refactor** — the comparison must survive prose→helper
   moves (γ) and backstory relocation (β) without producing false regressions.

## Non-goals (out of scope)

- Real deploys / real e2e — the expensive/irreversible ops are **stubbed** (see Op-stubs).
- Re-testing `backlog-lint`'s 11 rules themselves — already unit-tested; the runner only **invokes**
  the existing suites as the deterministic layer so one command covers the whole system.
- Auto-running on a schedule, and CI wiring — separate workstreams (manual on-demand skill, like
  `benchmark-agents`).
- Testing F-lesson *knowledge* — that is "why," not "what." β relocates it; the framework never
  asserts on it (correctly invisible to a doc-only refactor).

## Why the comparison is valid (the central design constraint)

`backlog-skills-simplification`'s own contract is **"No backlog behavior or lint invariant changed;
no F-lesson knowledge deleted."** This yields a crisp **dual oracle**:

- **Quality must be identical.** With zero intended behavior change, *any* gate/invariant diff
  between current and simplified is a regression — no intended-vs-regression disambiguation needed.
- **Cost/latency should drop.** Leaner prose ⇒ fewer input/reasoning tokens. That drop with quality
  flat *is* the value proof, mapping 1:1 onto β/γ's goals.

γ's risk concentrates in the **resume gate + merge-conflict + worktree** logic it moves into helpers
— precisely the `backlog-next-epic` resume + merge-ownership surface this framework covers most
deeply. The risk and the coverage coincide.

Comparability holds **only** under three constraints, enforced below:

1. **Scenarios assert OUTCOMES, never procedure internals.** Never "calls `runstate.mjs get`, then
   E1, then E2"; always observable outcomes ("resumed without re-promoting / re-creating the branch
   / picked the next open member"; "never self-merged"). A scenario coupled to the current step
   structure would break on a behavior-preserving γ refactor — a false regression. Enforced by a
   **procedure-coupling ban** review gate during scenario authoring (see Validation).
2. **Op-stubs sit on the external behavior boundary** (`deploy.sh` / `gh` / `nx` / the
   `/backlog-next` worker). These do not move into helpers, so the call-log oracle is stable across
   β/γ. γ's *new* helpers get their own unit tests — a complementary layer, not overlap.
3. **Baseline captured on current `main` FIRST**, before any simplification work starts. Sequencing:
   this framework ships and baselines before the simplification epic is worked.

## Architecture

A backlog-specific harness whose **core is skill-agnostic** (reusable for other skill families
later); only the scenario corpus + golden assertions are backlog-specific. Plain `.mjs` (matches the
backlog helpers' own convention — it imports nothing from nestfolio `src`, so no `tsx`/path-alias
machinery).

```
scripts/benchmark-backlog/
  run.mjs            # orchestrator: modes (regression|compare|rebaseline) × scenarios × variants × iterations
  sandbox.mjs        # build throwaway git repo: fixture backlog + skill files from a git ref/dir + op-stubs
  runner.mjs         # invoke `claude -p --output-format stream-json`; parse usage/cost/duration + tool-call trace
  grade.mjs          # golden assertions (reuses backlog-lint/lib) + invariant assertions on the call-log/trace
  judge.mjs          # 2nd `claude -p` call → rubric score JSON (judge cost tracked separately)
  report.mjs         # raw-results.json → evaluation.md + compare-report.md
  scenarios/*.scenario.mjs   # corpus: fixture + skill + prompt + golden + invariants + rubric
  fixtures/<state>/          # synthetic backlog states (sets of .md + BACKLOG.md)
  stubs/                     # deploy.sh, gh, nx, backlog-next-worker — no-op + append to call-log
  baseline.json      # COMMITTED metric snapshot (the regression reference)
benchmarks/backlog/  # gitignored: raw-results.json, evaluation.md, compare-report.md, transcripts
```

### Component responsibilities

- **sandbox.mjs** — per run: `git init` a temp dir; copy the fixture's `docs/backlog/*.md` +
  `BACKLOG.md`; copy the backlog **skill files from the chosen git ref/dir** (the A/B knob); write a
  **trimmed `CLAUDE.md`** containing only the "Backlog Discipline" section (so cost is attributable
  to the skill, not nestfolio's full context); install **op-stubs** on `PATH`; set
  `NESTFOLIO_MEMORY_DIR` → a sandbox path (protects the real memory dir); `git commit` the baseline
  state. For `backlog-next-epic` scenarios, also seed a run-state file and/or a `gh` PR state per the
  scenario. Tear down after grading (keep the transcript on failure).
- **runner.mjs** — invoke `claude -p --output-format stream-json` with **cwd = sandbox**, pinned
  `--model`, `--permission-mode acceptEdits`, `--disallowedTools` for anything outside the sandbox.
  `stream-json` yields both the **final usage/cost/duration** event and the **full tool-call trace**
  (which tools were called, with what args). A per-run timeout; an emitted `AskUserQuestion` tool_use
  is the **pause signal** (in headless there is no responder) → record it and stop the run.
- **grade.mjs** — three layers (below).
- **judge.mjs** — a second headless `claude -p` call given the rubric + the run's result + the
  resulting backlog diff; returns `{ dimension: score 1-5, rationale }` JSON. Its cost is recorded
  **separately** so the skill-under-test cost stays clean.
- **report.mjs** — writes per-scenario `raw-results.json` and human-readable `evaluation.md` /
  `compare-report.md` under gitignored `benchmarks/backlog/`.

### Op-stubs + call-log (the enabler for high `backlog-next-epic` coverage)

The sandbox installs stub executables (ahead of the real ones on `PATH`) for the
expensive/irreversible operations: `deploy.sh`, `gh`, the `nx` e2e targets, and a fake
`/backlog-next` worker (which simply marks the named member `status: shipped` and commits on the
branch). Each stub **no-ops and appends a structured line to a call-log** (`stubs.log` in the
sandbox). This makes the orchestrator's control flow runnable cheaply and — crucially — lets the
grader assert **negative invariants** that are the heart of "bulletproof":

- `gh pr merge` was **NEVER** called (no self-merge — E8 / F-33).
- a second epic was **NEVER** promoted to `active` (rule 11).
- the branch was **NEVER** `-d`/`-D`'d before the PR merged (E8 keeps the branch).
- `deploy.sh` was called with the expected `--services=…` set; the e2e stubs ran once each.

## Execution & instrumentation

`claude -p --output-format stream-json` (CLI 2.1.187, verified) provides per-run:

- **Cost** — `total_cost_usd` (+ `usage` token breakdown). Judge cost recorded separately.
- **Latency** — `duration_ms`, `ttft_ms`, `num_turns` (turn count = a stable proxy for induced work).
- **First-turn / cached input tokens** — `usage.input_tokens` + `cache_*` on the first turn. This is
  a **low-noise direct proxy for skill-prose size**, isolating β's prose-reduction effect from
  tool-loop output-token noise. It is the metric that shows β's value cleanly **even on long
  control-flow runs** where end-to-end cost is dominated by the tool loop. (Mitigates the
  flow-length resolution caveat.)
- **Tool-call trace + result text** — drives the invariant assertions and pause detection.

The runner pins `--model` (default: the model normally driving backlog skills; configurable) so
cost/latency deltas reflect prose changes, not model drift.

## Metrics (per scenario × variant × iteration)

| Metric | Source | Used for |
|---|---|---|
| `gate_pass` (0/1) | grade layers 1+2 all pass | quality regression oracle |
| `rubric_score` (1–5) | judge | quality-drift / tiebreak |
| `total_cost_usd` | run | value |
| `first_turn_input_tokens` | run (first turn `usage`) | β value, low-noise |
| `duration_ms`, `ttft_ms`, `num_turns` | run | latency value |

Headline quality = **gate-pass-rate** across iterations; mean `rubric_score` is the secondary
quality-drift signal.

## Grading (3 layers)

1. **Golden assertions** — resulting `docs/backlog/*.md` frontmatter (`epic` / `epic_role` /
   `status` / `type` / `closed` / `validation_gate`), and `lint.mjs` exit 0. Reuses
   `backlog-lint/lib/{frontmatter,rules}.mjs` rather than reimplementing.
2. **Invariant assertions** on the call-log + tool trace — positive ("AskUserQuestion emitted at the
   pause juncture", "stub X called with Y") and **negative** ("`gh pr merge` never called", "no
   second epic activated").
3. **LLM judge** — fuzzy dimensions only: core-vs-captured correctness, severity sensibility,
   routing judgment, finding write-quality.

All three layers assert **outcomes**, never procedure internals (constraint 1).

## Scenario model

Each `*.scenario.mjs` exports:

```js
export default {
  id: 'bne-resume-merged-tail-only',
  skill: 'backlog-next-epic',
  fixture: 'epic-3members-2shipped',        // dir under fixtures/
  runstate: { e8: 'PR_OPEN_AWAITING_MERGE' },// optional seed (bne only)
  gh: { prState: 'MERGED' },                 // optional gh-stub state (bne only)
  prompt: '/backlog-next-epic acme-epic',
  golden: { /* frontmatter + lint expectations */ },
  invariants: {
    called: ['git checkout main', 'git branch -d feat/epic-acme-epic'],
    neverCalled: ['gh pr merge'],
    memberLoopEntered: false,
  },
  rubric: ['Did it run ONLY the post-merge tail and not re-enter the member loop?'],
};
```

## Scenario corpus

### `backlog-next-epic` — HIGH (~20, the bulletproof target)

- **Resume gate ×4:** absent→fresh (proceeds to preflight/promotion, does *not* jump to member
  loop); present+partial→resume (no re-promote, no re-create branch, re-derives next open member);
  `e8=PR_OPEN_AWAITING_MERGE`+PR `MERGED`→**post-merge tail only** (ff main, `branch -d`, drop
  run-state; member loop NOT entered; `gh pr merge` never called); `e8`+PR `OPEN`→re-print link &
  STOP (no member loop; `gh pr merge` never called).
- **Selection ×4:** no-arg impact-rank → AskUserQuestion confirm with top `(Recommended)` (queued
  epics keep `rank`, parking tail ordered by severity); `--like` criterion-rank → confirm; bare arg
  that IS an epic-id → skip menu; zero candidates → report & stop.
- **Rule-11 / promote ×3:** a *different* epic already active → STOP + ask resume-vs-switch (target
  NOT activated); clean promote (epic `active`, `done_when`/`scope`/`out_of_scope` present, index
  updated); already-drainable at start → still create worktree + run E6, not skip to ship.
- **`--auto` decisions ×6:** `type: design` member fork → ALWAYS pause; in-member fork +
  blast-radius exit 0 → auto-resolve picking the `(Recommended)` reusable option + append
  decision-log; blast-radius exit 1 → floor pause; catch-all unknown prompt → floor pause;
  irreversible/outward op → floor pause; floor surfaced as **AskUserQuestion widget**, not prose.
- **Ship / captured audit ×4:** drainable but e2e red/never-ran → must NOT ship (no PR); e2e green
  but **stale sha** (HEAD moved) → back to E6, not ship; captured audit promotes a load-bearing
  captured member to `core` → back to member loop (epic_role flips, ship blocked); clean ship →
  spin orthogonal captured into `<id>-leftovers`, set `shipped` + `closed` + `validation_gate`.
- **Merge-ownership ×2:** at E8 → PR route, body composed from `decisions[]`, STOP via
  AskUserQuestion, `gh pr merge` NEVER called, branch KEPT, worktree removed, `e8` marker set;
  **`--auto` at E8 still stops at the open PR** (no self-merge under `--auto`).

### `backlog-add` — MEDIUM (~7)

5 router branches (fold-core, fold-captured, join-theme, mint-aggregation-suggest, orphan) +
atomicity-split (mixed finding filed as two homogeneous items) + design-needs-references. The full
micro-flow (route → write → `lint --fix` → commit) runs end-to-end in the sandbox cheaply.

### `backlog-next` — MEDIUM (~4)

Lane classification ×3 (doc-layer / simple / complex) + dirty-tree preflight stop + epic-id →
redirect to `/backlog-next-epic`.

### `backlog-themes` — LIGHT (~1)

Orphans sharing a root cause → proposes a theme epic aggregating them.

### `backlog-lint` — COVERED (invoked, not re-tested)

The top-level runner also shells out to the existing `node --test
.claude/skills/backlog-*/test/*.test.mjs` suites, so a single `/benchmark-backlog` run reports the
whole system's health (deterministic layer pass/fail + orchestration metrics).

## Modes (the regression / value mechanism)

- **`regression`** — run current skills (cwd variant), N iterations (default 3); diff per-scenario
  median vs committed `baseline.json`; flag any **gate-pass-rate drop** or any cost/latency metric
  outside a **noise band**.
- **`compare <refA> <refB>`** — same scenarios head-to-head against two skill sources (git refs or
  dirs), same iterations; report per-metric deltas with noise bands → the "did the simplification
  regress / add value" verdict. This is the primary use for evaluating
  `backlog-skills-simplification`.
- **`rebaseline`** — explicit user step; overwrites `baseline.json` after an intended improvement.

**Noise handling:** agentic runs are non-deterministic. Report **median + spread** over N
iterations; a per-metric **noise band** (re-using `benchmark-agents`' "spread > 30% of median ⇒
rerun with more iterations" caveat) so deltas within noise are not called regressions. Quality
(gate-pass) is expected stable; a single iteration flipping gate-pass is itself a finding
([[feedback-flake-means-broken]] — never dismissed as flake).

## Invocation surface

A `/benchmark-backlog` skill (mirrors `/benchmark-agents`; `disable-model-invocation: true`,
user-triggered only):

```
/benchmark-backlog [regression | compare <refA> <refB> | rebaseline]
                   [--skill=backlog-next-epic] [--iterations N]
```

Reports to gitignored `benchmarks/backlog/`; `baseline.json` is committed. **Cost-conscious:**
estimate the run's $ before a full sweep and gate it via `AskUserQuestion` when above the
cost-conscious threshold ([[feedback-e2e-cost-conscious]]).

## Validation (how we know the framework itself works)

- **Bring-up smoke (Task 0):** confirm headless skill discovery (cwd `.claude/skills/`; fall back to
  `--plugin-dir` if cwd discovery does not surface the skill), confirm `stream-json` exposes the
  tool-call trace + usage, confirm an `AskUserQuestion` emission is detectable as a pause, confirm
  op-stubs intercept on `PATH`.
- **Procedure-coupling ban:** a review gate during scenario authoring — every assertion must be an
  observable outcome (files / call-log / pause / result), never a current-procedure step. Grep
  scenarios for forbidden coupling (`runstate.mjs get`, `E1`, `E2`, step-name references in
  assertions).
- **Self-consistency:** running `regression` against current `main` immediately after baselining
  must report zero regressions (the baseline reproduces itself within the noise band).
- **Mutation check:** introduce a deliberate, known behavior break in a *copy* of a skill (e.g.
  delete the rule-11 guard line) and confirm the relevant scenario's gate flips to fail — proves the
  oracle has teeth before we trust a "no regression" verdict on the real simplification.

## Sequencing dependency

Build framework → baseline on current `main` → **then** work `backlog-skills-simplification` →
`compare main feat/epic-backlog-skills-simplification`. The framework must ship and baseline before
β/γ start.

## Open implementation questions (for the plan, not blocking design)

- Exact `--disallowedTools` / permission settings that keep the sandbox safe while letting the
  op-stubs run.
- Whether the headless run needs `--setting-sources` tuning to load project skills from the sandbox
  cwd vs `--plugin-dir`.
- Default pinned `--model` and default `--iterations` (cost vs stability trade-off).
