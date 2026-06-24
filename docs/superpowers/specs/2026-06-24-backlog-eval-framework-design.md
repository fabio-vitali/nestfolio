# Backlog-system evaluation framework — design

**Date:** 2026-06-24
**Status:** design (approved in brainstorming; revised after a 6-dimension adversarial review — see
`docs/reviews/2026-06-24-backlog-eval-framework-spec-review.md`)
**Workstream:** `backlog-eval-framework`
**Motivates / guards:** the `backlog-skills-simplification` epic (β `backlog-skills-lessons-extraction`, γ `backlog-skills-procedure-to-tested-helpers`).

## Problem

The backlog skill suite (`backlog-add`, `backlog-next`, `backlog-next-epic`, `backlog-themes`,
`backlog-lint`) is **~800 lines of orchestration `SKILL.md` prose** (the target of change) plus
**~3,500 lines of already-unit-tested `.mjs` helpers**. The prose encodes 19 hard-won F-fixes and
drives the 11 lint invariants and a closed-schema run-state. We want to evolve it — starting with
`backlog-skills-simplification` — and prove each change **(a) does not regress behavior** and
**(b) actually adds value** (lower token/turn cost), measuring **quality, cost, and latency**.

The deterministic helpers (`lint.mjs`, `rules.mjs`, `runstate.mjs`, `epic-members.mjs`, the
classification helpers) already have `node:test` unit suites. The **untested gap** is the
**orchestration layer** — the prose an LLM executes (routing, lane classification, epic
core-vs-captured selection, severity ranking, the resume gate, merge-ownership). That layer is also
the *only* place cost/latency are meaningful, and exactly what a "simplification" can regress.

## Goals

1. Catch behavior regressions in the orchestration layer when skill prose/helpers change.
2. Quantify the value of a change in **tokens and turns** (the low-noise efficiency signals);
   wall-clock latency is reported as informational only (it is dominated by API queueing — see
   §Measurement).
3. Be **valid across a behavior-preserving refactor** — the comparison must survive prose→helper
   moves (γ) and backstory relocation (β) without producing false regressions.

## Non-goals (out of scope)

- Real deploys / real e2e — the expensive/irreversible ops are **stubbed** (see §Op taxonomy).
- Re-testing `backlog-lint`'s 11 rules themselves — already unit-tested; the runner only **invokes**
  the existing suites as the deterministic layer so one command covers the whole system.
- Auto-running on a schedule, and CI wiring — separate workstreams (manual on-demand skill).
- Testing F-lesson *knowledge* — that is "why," not "what." β relocates it; the framework never
  asserts on it (correctly invisible to a doc-only refactor).

## Gate-0 spike (resolve BEFORE authoring the corpus)

The adversarial review proved that several mechanisms this design depends on are not what intuition
expects against CLI 2.1.187. **The corpus is provisional until this spike lands.** Each item below is
an explicit **accept/reject gate** — a reject forces a design change here before any scenario is
written. (Items marked ✔ were already verified live by the review and are treated as accepted;
they are listed so the spike re-confirms them in one place.)

1. **Headless pause signature (B1).** ✔ `AskUserQuestion` is **not** in the headless `claude -p`
   toolset; a forced pause becomes an undetectable prose stop. **Decision:** inject a harness
   convention (via `--append-system-prompt`, applied **identically to both A/B variants** so it
   cannot bias the comparison): *"When you would call `AskUserQuestion` or otherwise pause for a user
   decision, emit a single final line `<<HARNESS-PAUSE: {reason}>>` and stop."* The grader detects a
   pause by that sentinel **plus** no terminal mutating op in the call-log. Spike confirms the model
   honors the sentinel for the skills' mandated-widget junctures.
2. **Worker / Skill-tool interception seam (B2).** The `/backlog-next` worker runs **in-process via
   the Skill tool**, not a subprocess — a PATH shim cannot touch it. **Decision:** ship a stub
   `backlog-next` SKILL.md into the sandbox `.claude/skills/` whose body simply runs a deterministic
   `node .claude/skills/_stubs/worker.mjs <member-id>` (flips the member to `shipped`, commits on the
   branch, appends to `stubs.log`, honors a per-scenario `failCycles` knob). **Spike must confirm the
   Skill tool discovers + invokes a sandbox-cwd project skill in headless mode** (else fall back to
   `--plugin-dir`). This is the single riskiest unknown — the entire bne corpus depends on it.
3. **Per-op stub seams (B2).** `gh` → PATH shim (correct). `deploy.sh` → write the stub **at**
   `infrastructure/scripts/deploy.sh` inside the sandbox repo. `nx` → drop a stub at
   `node_modules/.bin/nx` inside the sandbox (or shim `pnpm`); spike confirms `pnpm nx run …` resolves
   it. Each stub no-ops and appends to `stubs.log`.
4. **Sandbox isolation (M3).** ✔ `claude -p` loads the user's **global** config regardless of cwd
   (MCP servers, `superpowers` plugin, a `SessionStart` hook re-injecting context, `permissionMode:
   auto`). ✔ `--setting-sources project` neutralizes it (init shows `mcp:[]`, `plugins:[]`,
   `permissionMode:default`); `--bare` does **not**. **Decision:** always invoke with
   `--setting-sources project --strict-mcp-config`, a default-deny `--disallowedTools`
   (`WebFetch`/`WebSearch`/`Task` + the Skill-tool sub-skills per §Op taxonomy), an explicit spawn
   `env` that strips `AWS_*` and sets a sandbox `HOME`. Gate: the `init` event must show
   `mcp_servers:[]`, `plugins:[]`, no SessionStart hook, no `AWS_*` in env.
5. **`--verbose` (m1).** ✔ `--output-format stream-json` with `--print` **requires `--verbose`** (CLI
   errors otherwise). The runner command includes it.
6. **Run-state seeding + resumable repo (M5).** Seed run-state by shelling the skill's own helper
   (`node runstate.mjs init … && set-e8 …`) so the closed 6-key schema + cwd-independent path are
   always correct and auto-track γ. Build the sandbox with a **local `origin` remote** so
   `git fetch origin main`, `worktree add … origin/main`, and the `main == origin/main` preflight
   succeed. Gate: `runstate.mjs get <id>` from sandbox cwd returns the seeded state (exit 0), not
   FRESH.

## Why the comparison is valid (the central design constraint)

`backlog-skills-simplification`'s own contract is **"No backlog behavior or lint invariant changed;
no F-lesson knowledge deleted."** This yields a crisp **dual oracle**:

- **Quality must be identical.** With zero intended behavior change, *any* gate/invariant diff
  between current and simplified is a regression — no intended-vs-regression disambiguation needed.
- **Cost should drop.** Leaner prose ⇒ fewer input/reasoning tokens. That drop with quality flat *is*
  the value proof, mapping 1:1 onto β/γ's goals.

γ's risk concentrates in the **resume gate + merge-conflict + worktree** logic it moves into helpers
— precisely the `backlog-next-epic` resume + merge-ownership surface this framework covers most
deeply. The risk and the coverage coincide.

Comparability holds **only** under three constraints, enforced below:

1. **Scenarios assert OUTCOMES, never procedure internals.** Never "calls `runstate.mjs get`, then
   E1, then E2"; always observable outcomes (resulting files/state, stubbed-op call-log, terminal
   kind). Enforced by the **structural lint** below (a token-grep is insufficient — see constraint 2).
2. **The call-log oracle covers only the four EXTERNAL stubbed ops; internal git/worktree ops are
   asserted via state, not the trace.** This is the key correction from the review: git/worktree/
   merge-base commands are **not** stubbed and γ **relocates them into helpers**, so a call-log
   assertion over `git branch -d` flips with zero behavior change. The op taxonomy (below) splits the
   two; a **structural lint** forbids any `called`/`neverCalled` entry whose command is not one of the
   four stub binaries, and requires `runstate:`/`state:` seeds expressed as helper-intent, not raw
   schema.
3. **Baseline captured on current `main` FIRST**, before any simplification work starts. F-lesson
   knowledge is "why," not "what" — the framework never tests it, so β relocating it is correctly
   invisible. Sequencing: this framework ships and baselines before the simplification epic is worked.

## Architecture

A backlog-specific harness whose **core is skill-agnostic** (see §Reusable seam). Plain `.mjs` (it
imports nothing from nestfolio `src`, so no `tsx`/path-alias machinery).

```
scripts/benchmark-backlog/
  run.mjs            # orchestrator: modes (regression|compare|rebaseline) × scenarios × variants × iterations
  sandbox.mjs        # throwaway git repo + local origin + skill files from a ref + per-op stub seams + isolation
  runner.mjs         # invoke `claude -p --print --verbose --output-format stream-json --setting-sources project …`
  grade.mjs          # 3 layers: golden (files+lint) / call-log+state invariants+terminal-kind / LLM judge
  judge.mjs          # 2nd `claude -p` call → rubric score JSON (judge cost tracked separately)
  cost.mjs           # deterministic cost from token breakdown × fixed published prices (cache-aware)
  report.mjs         # raw-results.json → evaluation.md + compare-report.md
  suite.mjs          # defineSuite() — the reusable seam (see §Reusable seam)
  scenarios/*.scenario.mjs   # corpus: fixture + skill + prompt + golden + invariants + state + terminal + rubric
  fixtures/<state>/          # synthetic backlog states (sets of .md + BACKLOG.md)
  stubs/                     # deploy.sh, gh, nx, _stubs/worker.mjs + stub backlog-next SKILL.md
  baseline.json      # COMMITTED metric snapshot (the regression reference)
benchmarks/backlog/  # gitignored: raw-results.json, evaluation.md, compare-report.md, transcripts
```

### Component responsibilities

- **sandbox.mjs** — per run: `git init` a temp dir + a **local bare `origin`** it is pushed to; copy
  the fixture's `docs/backlog/*.md` + `BACKLOG.md`; copy the backlog **skill files from the chosen
  git ref/dir** (the A/B knob) into `.claude/skills/`; install the **stub `backlog-next` SKILL.md**
  + `_stubs/worker.mjs`; write the stub `deploy.sh` at `infrastructure/scripts/`; drop the stub `nx`
  at `node_modules/.bin/`; put the `gh` shim on `PATH`; write a **trimmed `CLAUDE.md`** (only the
  "Backlog Discipline" section); set `NESTFOLIO_MEMORY_DIR` → a sandbox path; seed run-state via the
  **real helper** when the scenario needs a resume; `git commit` + push the baseline state. Tear down
  after grading (keep the transcript + sandbox on failure).
- **runner.mjs** — invoke the CLI with **cwd = sandbox**, pinned `--model`, the isolation flag set
  (gate-0 #4), `--append-system-prompt` carrying the pause-sentinel convention (gate-0 #1), and a
  per-run **timeout** (a timeout is a distinct terminal kind). Parse the `stream-json` event stream:
  the final result event (`usage`, `total_cost_usd`, `duration_ms`, `ttft_ms`, `num_turns`,
  `subtype`) **and** the per-turn `usage` breakdown **and** the full tool-call trace. Classify the
  **terminal kind** (`pause` via sentinel / `completed` / `timeout` / `error`).
- **grade.mjs** — three layers (below).
- **judge.mjs** — a second headless `claude -p` call given the rubric + the run's result + the
  resulting backlog diff; returns `{ dimension: score 1-5, rationale }`. Cost recorded **separately**.
- **cost.mjs** — computes cost deterministically from the per-turn token breakdown × fixed published
  prices with documented cache multipliers (mirrors `benchmark-agents`' `computeCostUSD`), so cost is
  immune to cold/warm-cache pricing swings.
- **report.mjs** — writes per-scenario `raw-results.json` + human-readable `evaluation.md` /
  `compare-report.md` under gitignored `benchmarks/backlog/`.

### Op taxonomy (the call-log vs state split)

Operations the skills perform fall into two classes, asserted differently:

- **External stubbed ops → `stubs.log` call-log.** Exactly four, each with a real interception seam
  (gate-0 #2/#3): the **`backlog-next` worker** (sandbox stub SKILL.md → `_stubs/worker.mjs`),
  **`deploy.sh`** (in-repo path), **`nx`** (`node_modules/.bin/nx`, per-scenario configurable
  `{exitCode, collectedCount}`), **`gh`** (PATH shim). Plus the direct test calls the complex path
  makes — `pnpm nx run-many -t test,lint,test-integration` — routed through the same `nx` stub. These
  carry positive/negative call-log invariants (`called` / `neverCalled`), matched as a substring of a
  `stubs.log` line. The structural lint restricts `called`/`neverCalled` entries to these binaries.
- **Internal git/worktree/run-state ops → resulting FS/git STATE.** `git`, `git worktree`,
  `merge-base`, and the run-state helper are **not** stubbed and are **γ-relocated**, so they are
  asserted only via observable state in a scenario `state:`/`postState:` block: branch existence,
  `HEAD`, worktree directory presence, the local `origin/main` log (e.g. the E1 promotion marker
  reached origin), and `runstate.mjs get <id>` output. Never via trace strings.
- **Skill-tool sub-skills → denied or stubbed.** The complex/member path drives
  `superpowers:brainstorming` / `executing-plans` / `subagent-driven-development` /
  `finishing-a-development-branch` via the Skill tool. For scenarios that assert only
  classification/routing, these are **denied** (`--disallowedTools`) and the scenario asserts the
  lane verdict then STOPs before downstream routing. For full-path scenarios, provide sandbox
  stub-skills. (PATH shims cannot intercept Skill-tool calls — same mechanism as the worker.)

### Pause contract (B1)

Because the mandated `AskUserQuestion` widget is unavailable headless, a pause is expressed via the
injected sentinel (gate-0 #1) and graded as: **terminal kind == `pause`** (sentinel present) **and**
no terminal mutating op in the call-log. The sentinel convention is applied identically to both A/B
variants, so it never biases a comparison. Every scenario asserts an **expected terminal kind**
(`pause` / `completed` / `timeout`-is-always-fail) so a hang or a wrong-completion cannot false-pass
— this also covers the sanctioned *prose* stops (`e8`+PR `OPEN` → re-print & STOP; zero-candidates →
report & stop), which assert `terminal: pause` via the same path.

## Measurement (M1, M2)

`claude -p --print --verbose --output-format stream-json` (CLI 2.1.187) provides per-turn `usage`
(`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`),
`total_cost_usd`, `duration_ms`, `ttft_ms`, `num_turns`.

- **The prose-size proxy is a cache-inclusive sum.** `usage.input_tokens` alone is the *uncached
  remainder* (~tens of tokens) — the prose lives in `cache_creation`/`cache_read`. The metric is
  `first_turn_prose_tokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  read at the turn where the skill's `SKILL.md` loads (for a `disable-model-invocation` skill that is
  the turn following the Skill/command load, not turn 1), **minus a fixed sandbox-context floor**
  measured once via a no-op control scenario (the trimmed `CLAUDE.md` slab does not move with β). It
  is a low-noise *component* of the prose signal, not the whole cost.
- **Cost is computed deterministically**, `cost.mjs` = Σ(per-turn tokens × fixed published price)
  with documented cache multipliers (`cache_creation` ≈ 1.25×, `cache_read` ≈ 0.1×). CLI
  `total_cost_usd` is demoted to a cache-state-controlled secondary (three identical runs swung ~88%
  on cold/warm cache alone).
- **Cache state is pinned.** Each measured run uses a fresh sandbox cwd (cold) *or* a uniform warm-up;
  `compare A B` **interleaves variants per iteration** (A,B,A,B…) and reports each variant's
  `cache_creation` vs `cache_read` so an ordering artifact is visible rather than silently fed into
  the verdict.
- **Latency is split.** `num_turns` + token counts are the **primary** efficiency signals (low-noise).
  `duration_ms`/`ttft_ms` are **informational, high-noise** (>100% deterministic-prompt spreads
  measured) and are **never** the sole basis for a regression/value verdict.

### Metrics (per scenario × variant × iteration)

| Metric | Source | Used for |
|---|---|---|
| `gate_pass` (0/1) | grade layers 1+2 all pass + terminal kind matches | quality regression oracle |
| `rubric_score` (1–5) | judge | quality-drift / tiebreak |
| `cost_usd` | `cost.mjs` (deterministic) | value (primary) |
| `first_turn_prose_tokens` | per-turn `usage` (cache-inclusive, floor-subtracted) | β prose-size proxy |
| `num_turns` | run | efficiency (primary, low-noise) |
| `duration_ms`, `ttft_ms` | run | informational only (high-noise) |

Headline quality = **gate-pass-rate**; mean `rubric_score` is the secondary quality-drift signal.

## Grading (3 layers)

1. **Golden** — resulting `docs/backlog/*.md` frontmatter (`epic`/`epic_role`/`status`/`type`/
   `closed`/`validation_gate`), explicit YAML scalar-type checks where needed (e.g. `notes:` is a
   string — not caught by "lint exit 0"), and `lint.mjs` exit 0. Reuses `backlog-lint/lib/{frontmatter,rules}.mjs`.
2. **Invariants** — split by source per the op taxonomy: **call-log** (`called`/`neverCalled` over the
   four stub binaries, from `stubs.log`), **state** (`state:`/`postState:` over FS/git/run-state), and
   **terminal kind**. Positive ("worker shipped member X", "pause sentinel emitted") and **negative**
   ("`gh pr merge` never in `stubs.log`", "no second epic `active` in state").
3. **LLM judge** — fuzzy dimensions only: core-vs-captured correctness, severity sensibility, routing
   judgment, finding write-quality, clustering quality (themes).

All three layers assert **outcomes**, never procedure internals (constraint 1).

## Scenario model

Each `*.scenario.mjs` exports (note `runstate`/`state` are **intent**, not raw schema):

```js
export default {
  id: 'bne-resume-merged-tail-only',
  skill: 'backlog-next-epic',
  fixture: 'epic-3members-2shipped',         // dir under fixtures/
  runstate: { phase: 'pr-open', pr: 42 },    // intent — sandbox shells runstate.mjs init+set-e8
  gh: { prState: 'MERGED' },                 // gh-stub state
  prompt: '/backlog-next-epic acme-epic',
  terminal: 'completed',                     // expected terminal kind
  golden: { /* frontmatter + lint expectations */ },
  callLog: { neverCalled: ['gh pr merge'] }, // ONLY the four stub binaries
  state: {                                   // internal git/worktree/run-state — observable state
    branchDeleted: 'feat/epic-acme-epic',    // branch gone after the post-merge tail
    runstateAbsent: true,
    originMainContains: 'ship acme-epic',
    memberLoopEntered: false,                // derived: no worker stub call in stubs.log
  },
  rubric: ['Did it run ONLY the post-merge tail and not re-enter the member loop?'],
};
```

## Scenario corpus

### `backlog-next-epic` — HIGH (~35, the bulletproof target)

- **Resume gate ×5:** absent→fresh; present+partial→resume (no re-promote, no re-create branch,
  re-derives next open member); `e8`+PR `MERGED`→**post-merge tail only** (state: ff origin/main,
  branch gone, run-state absent; worker never called; `gh pr merge` never called); `e8`+PR `OPEN`→
  re-print link & STOP (`terminal: pause`; no worker call); **corrupt run-state (F-11/F-13)→clean
  STOP** (no re-promote/branch/member loop).
- **Selection ×5:** no-arg impact-rank → `terminal: pause` (sentinel surfaces top candidate; queued
  epics keep `rank`, parking tail ordered by severity); `--like` criterion-rank → pause; bare arg
  that IS an epic-id → skip menu; zero candidates → report & STOP (`terminal: pause`);
  **computed-selection-must-confirm-even-in-`--auto`** (`/backlog-next-epic --auto` no-id → pause at
  selection; no promote/worktree/deploy before confirm).
- **Rule-11 / promote ×3:** a *different* epic already active → STOP + pause (target NOT activated in
  state); clean promote (epic `active`, `done_when`/`scope`/`out_of_scope` present, **promotion
  marker present on origin/main** via state, index updated); already-drainable at start → still
  create worktree + run E6, not skip to ship.
- **`--auto` decisions ×6:** `type: design` member fork → pause; in-member fork + blast-radius exit 0
  → auto-resolve picking the `(Recommended)` reusable option + append decision-log; blast-radius exit
  1 → floor pause; catch-all unknown prompt → floor pause; irreversible/outward op → floor pause;
  floor surfaced via the **pause sentinel** (terminal kind == pause), not a silent completion.
- **Member-loop / per-member gates ×4:** **E4.3 ≤3 debug-cycle floor** (worker stub `failCycles:4`
  → floor pause, no 4th deploy.sh call); **E4.3 F-21 shared-surface typecheck** pair (member touches
  `libs/event-types/src/*` → `nx … -t typecheck` in call-log / non-shared touch → not called);
  **E4.5 checkpoint/clear** (assert the clear-recommendation + resume-command surface — semantics, not
  literal emoji); **E1 promotion-marker push** (state: origin/main advanced — asserted via state, not
  a trace string).
- **Ship / captured audit ×4:** drainable but e2e red/never-ran → must NOT ship (no `gh pr create`);
  e2e green but **stale sha** → back to E6, not ship; captured audit promotes a load-bearing captured
  member to `core` → back to member loop (epic_role flips, ship blocked); clean ship → spin orthogonal
  captured into `<id>-leftovers`, set `shipped` + `closed` + `validation_gate`.
- **E6 false-green ×1:** **zero-tests-collected (F-24)** — nx stub `{exitCode:0, collectedCount:0}`
  → treated as RED, no ship.
- **Merge-ownership ×2:** at E8 → PR route (`gh pr create` called), body composed from `decisions[]`,
  `terminal: pause`, `gh pr merge` NEVER called, branch KEPT (state), worktree removed (state), `e8`
  marker set (state); **`--auto` at E8 still pauses at the open PR** (no self-merge under `--auto`).
- **Merge-conflict resolution ×1 (M6, NEW):** **`bne-e8-conflict-resolution`** — seed a sandbox where
  `origin/main` carries the E1 promotion marker (`<id>.md` = `active`, no `closed:`) + a divergent
  `BACKLOG.md`, branch carries shipped frontmatter; drive a **real local rebase** (resolution fires at
  E8.1, pre-merge — no `gh pr merge` needed); grade the OUTCOME (`<id>.md` ends `shipped`+`closed`+
  `validation_gate`; `BACKLOG.md` regenerated by `lint --fix`; lint exit 0; rule-11 unblocked). This
  is one of γ's three named extraction targets.
- **Lower-priority sub-gaps (fold into the same corpus):** E0 epic-start dirty-tree preflight stop;
  E2 worktree-pruned re-attach (`worktree add` without `-b`); E7.1 captured-promote → chained-E6
  (2nd e2e run after re-work); E5 append-only decision-log under reversal (entry[0] intact);
  E8.4 postflight-from-`$MAIN` cwd-survival (F-23, run-state gone at the helper-resolved path).

### `backlog-add` — MEDIUM (~9)

5 router branches (fold-core, fold-captured, join-theme, mint-aggregation-suggest, orphan) +
atomicity-split + **commit-prefix-per-route & touched-files-only `git add`** (state) + **id-collision
`-2` suffix** + **minted theme-epic template correctness** + **`notes:` double-quoted-scalar** (YAML
string-type golden, not caught by lint). The full micro-flow runs end-to-end in the sandbox cheaply.

### `backlog-next` — MEDIUM (~6)

Lane classification per distinct cut-point: doc-layer; simple; public-interface-change → complex;
deploy-gated → complex; spec-only `type: design` stays doc-layer. Plus dirty-tree preflight stop and
≥1 closing-phase scenario grading the deploy / doc-derivation **detector outcomes via the call-log**.
Classification-only scenarios deny the downstream Skill-tool sub-skills and assert the lane verdict +
worktree-adoption, then STOP.

### `backlog-themes` — LIGHT (~2)

A real cluster-by-root-cause scenario **plus a decoy/singleton discrimination scenario** (only the
genuine cluster aggregates; singletons stay orphan) + a judge "clustering quality" dimension — the
skill's whole purpose is cluster-not-by-symptom + don't-force-singletons + extend-vs-mint.

### `backlog-lint` — COVERED (invoked, not re-tested)

The top-level runner also shells out to the existing `node --test
.claude/skills/backlog-*/test/*.test.mjs` suites, so a single `/benchmark-backlog` run reports the
whole system's health (deterministic layer pass/fail + orchestration metrics).

## Modes (the regression / value mechanism)

- **`regression`** — run current skills, N iterations; diff per-scenario median vs committed
  `baseline.json`; flag any **gate-pass flip** (any single flip is a finding — see quality contract)
  or any cost/token metric outside its band.
- **`compare <refA> <refB>`** — same scenarios head-to-head against two skill sources (git refs/dirs),
  **interleaved per iteration**, cache-state pinned; report per-metric deltas → the "did the
  simplification regress / add value" verdict. Primary use for `backlog-skills-simplification`.
- **`rebaseline`** — explicit user step; overwrites `baseline.json` after an intended improvement.

**Quality vs cost N (m7).** Quality is a discrete oracle with an explicit contract: **any single
gate-pass flip across iterations = regression** ([[feedback-flake-means-broken]]), so small N
(default 3) is sound for quality. For the continuous cost/token metrics, rely on the (corrected,
near-deterministic) `first_turn_prose_tokens` proxy; a metric outside a band **escalates iteration
count** (the `benchmark-agents` semantics — advisory rerun, not an automatic regression verdict).

## Reusable seam (m3 — the project's primary objective)

`run.mjs` (the mode/iteration loop), `runner.mjs` (headless invocation + stream-json parsing +
terminal-kind classification), `cost.mjs`, and `report.mjs` are **skill-agnostic** and sit behind a
single config surface:

```js
defineSuite({
  buildSandbox,   // (scenario, skillRef) → sandbox dir   (skill-family-specific)
  stubs,          // [{ seam, install, logTo }]            (skill-family-specific)
  grade,          // (scenario, runResult, sandbox) → { gatePass, golden, invariants, terminal }
  scenarios,      // the corpus
})
```

`buildSandbox`, `stubs`, `grade`, and `scenarios` are the only backlog-coupled pieces. The pattern is
liftable to other skill families (e.g. the `superpowers` skills) by supplying a new config. Precedent:
`scripts/benchmark-agents/run.ts` (the orchestration/cost template) and `.github/workflows/pr-audit.yml`
(an existing `claude -p` headless invocation in this repo — the harness is not net-new ground).

## Invocation surface

A `/benchmark-backlog` skill (user-triggered only; carries `disable-model-invocation: true` — sourced
from `backlog-next-epic/SKILL.md:4`, not from `benchmark-agents` which uses a prose guard — keep both:
the flag + a prose "invoke only via the command" guard):

```
/benchmark-backlog [regression | compare <refA> <refB> | rebaseline]
                   [--skill=backlog-next-epic] [--iterations N]
```

Reports to gitignored `benchmarks/backlog/`; `baseline.json` is committed. **Cost-conscious:** estimate
the run's $ before a full sweep and gate it via the pause sentinel / `AskUserQuestion` (interactive)
above the cost-conscious threshold ([[feedback-e2e-cost-conscious]]).

## Validation (how we know the framework itself works)

- **Gate-0 spike** (above) — each item is accept/reject; the corpus is provisional until it lands.
- **Structural lint** — the procedure-coupling guard: every `called`/`neverCalled` entry must be one
  of the four stub binaries; `runstate:`/`state:` seeds must be helper-intent, not raw schema; no
  assertion may reference a procedure step-name or a helper-call sequence. (Replaces the insufficient
  token-grep.)
- **Self-consistency** — `regression` against current `main` immediately after baselining reports
  zero regressions (the baseline reproduces within band).
- **Quality-oracle teeth (m5)** — inject a **prose-only** behavior break that the deterministic lint
  cannot independently catch (e.g. delete the E8 "never `gh pr merge`" guard `SKILL.md:234` → confirm
  `neverCalled:['gh pr merge']` flips; or delete the resume "skip E0/E1" line → confirm the resume
  scenario fails). Constraint: the mutation must not be caught by `lint` (else it proves nothing about
  the orchestration oracle γ refactors).
- **Value-oracle teeth (m6)** — inject a known ~K-token prose block; confirm `first_turn_prose_tokens`
  rises ~K and cost clears its band — calibrates the minimum detectable effect.

## Sequencing dependency

Build framework → gate-0 spike → baseline on current `main` → **then** work
`backlog-skills-simplification` → `compare main feat/epic-backlog-skills-simplification`. The
framework must ship and baseline before β/γ start.

## Open implementation questions (for the plan, not blocking design)

- Exact default pinned `--model` and default `--iterations` (cost vs stability trade-off).
- The precise turn-index at which a `disable-model-invocation` skill's prose enters `usage` (pinned by
  gate-0 #2's spike alongside the worker-seam check).
- Whether any scenario genuinely needs a full Skill-tool sub-skill stub vs deny-and-stop.
