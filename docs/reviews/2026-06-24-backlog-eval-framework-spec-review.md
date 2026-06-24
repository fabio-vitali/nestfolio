# Adversarial review — `backlog-eval-framework` design spec

**Spec:** `docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md`
**Date:** 2026-06-24
**Reviewer:** synthesis of a 6-dimension adversarial review (feasibility, comparability, bne-coverage, other-skill coverage, measurement methodology, spec hygiene). All findings grounded in spec lines + code file:line.

---

## Executive verdict

**Not yet sound enough to proceed to writing-plans.** The design's *intent* is strong — the dual oracle (quality-identical + cost-should-drop) is a genuinely crisp fit for a behavior-preserving refactor, the 3-layer grader is well-conceived, and the corpus is unusually dense. But three of its **load-bearing mechanisms are factually broken against the real CLI and the real skills**, and they all sit on the framework's self-declared "bulletproof target" (`backlog-next-epic`):

1. **The headless pause oracle cannot fire.** `AskUserQuestion` is not in the headless `claude -p` toolset — verified live. Dozens of corpus invariants key off "AskUserQuestion emitted." (BLOCKER)
2. **The whole op-stub interception model is wrong.** The `/backlog-next` worker runs in-process via the Skill tool (not a subprocess), and `deploy.sh`/`nx` are not PATH-resolved either — so the PATH-shim design intercepts almost nothing it claims to. (BLOCKER)
3. **The β value metric measures the wrong field** (`usage.input_tokens` ≈ tens of tokens; skill prose lives in the cache fields), and **`compare`/cost has no cache-state control**, so a 30%-band oracle can't contain ~88% cache-driven swing. (MAJOR cluster)

Plus a recurring comparability bug: the spec's own flagship scenario asserts `git` shell strings in the call-log — exactly the commands γ relocates into helpers — guaranteeing false regressions.

**What MUST change first:** promote the four "bring-up smoke" assumptions to a *gating spike* that resolves the headless pause signature, the worker/skill interception seam, the per-op stub mechanism, and sandbox isolation **before** the corpus is authored. Fix the measurement metrics (cache-aware token proxy, deterministic cost, cache-state control). Re-base every `called`/`neverCalled` git invariant on observable FS/post-state. With those resolved, the corpus and grader are largely reusable.

---

## Blockers

### B1. `AskUserQuestion` is unavailable in headless `claude -p` — the central pause oracle cannot fire
**Severity:** blocker
**Spec:** Execution & instrumentation, runner.mjs (L100-101); Grading layer 2 (L157-159); corpus invariants (L195, L198, L205, L212).
**Issue:** The runner's only pause-detection mechanism is "an emitted `AskUserQuestion` tool_use is the pause signal → record it and stop the run." Verified against CLI 2.1.187: the `init` event's `tools[]` contains **no** `AskUserQuestion`; when forced, the model answers in prose / `ToolSearch` and terminates `subtype: success`/`completed` — indistinguishable from a normal completion. The skills mandate the widget everywhere (`backlog-next-epic/SKILL.md:179` "the surface MUST be an AskUserQuestion widget … a prose pause is a skill violation"; `:234` "STOP via AskUserQuestion"). Headless, every floor/selection/E8-STOP scenario collapses to an undetectable prose stop. The framework's headline quality metric (gate-pass-rate) cannot be computed for the high-value scenarios.
**Fix:** Promote pause-detection from a Task-0 smoke assumption to a *resolved* design decision. Define a code-detectable headless pause contract: a recognizable sentinel marker in the final assistant text + "no terminal mutating op in the call-log" (the prose-stop `result` event subtype). Rewrite the grading-layer-2 positive invariant and every "AskUserQuestion emitted" corpus invariant against that sentinel. The **negative** call-log invariants (`gh pr merge` never called, no second epic activated) remain valid as-is — they read the call-log, not AskUserQuestion. Make this a blocking item in §Open questions, not a deferred smoke check.

> **Related (folded in):** the prior multi-signal critique — that some sanctioned stops are *prose* (`e8`+PR `OPEN` → "re-print link and STOP", `SKILL.md:42`; zero-candidates → "report & stop") and so are also invisible to an AskUserQuestion-only oracle. The B1 fix (treat the `result` event + last text as a first-class terminal kind, and assert an explicit `terminal: 'askuserquestion' | 'prose-stop' | 'completed' | 'timeout'` per scenario) subsumes this. Even after AskUserQuestion is replaced, scenarios must assert the *expected terminal KIND* so a hang/wrong-completion can't false-pass.

### B2. The op-stub PATH-interception model is structurally wrong for 3 of 4 ops
**Severity:** blocker
**Spec:** Constraint 2 (L60-62); Op-stubs + call-log (L109-122); stubs/ listing (L83); Task-0 smoke "intercept on PATH" (L271).
**Issue:** The spec installs stub executables "ahead of the real ones on `PATH`" for `deploy.sh`, `gh`, `nx`, and "a fake `/backlog-next` worker." Only `gh` is a true PATH command. The other three fail:
- **`/backlog-next` worker** is **not a subprocess at all** — the orchestrator loads it *in-process via the Skill tool, inline into its own context* (`backlog-next-epic/SKILL.md:140`; reciprocally `backlog-next/SKILL.md:8`, where `disable-model-invocation` was removed precisely to enable this). No process → no PATH lookup → nothing to intercept. The real member work would run for real. This is load-bearing for the **entire ~20-scenario bulletproof corpus** (every member-loop / `memberLoopEntered` invariant assumes a cheap stubbed worker).
- **`deploy.sh`** is invoked as `bash infrastructure/scripts/deploy.sh …` (`SKILL.md:188`) — a relative path handed to `bash`; PATH is never consulted.
- **`nx`** is invoked as `pnpm nx run …` (`SKILL.md:194-195`); empirically verified `pnpm` resolves the project-local `node_modules/.bin/nx` ahead of inherited PATH, so a PATH shim never fires.
**Fix:** Specify per-op interception keyed to each op's *actual* invocation form, not a blanket PATH assumption:
- **worker** — ship a *stub `backlog-next` SKILL.md* into the sandbox `.claude/skills/` (the Skill tool reads it from sandbox cwd; sandbox.mjs already copies skill files per L90). Its body deterministically flips the named member to `shipped`, commits on the branch, and echoes a line to `stubs.log`. This is the real, interceptable seam and preserves the call-log oracle for the worker.
- **deploy.sh** — write the stub *at* `infrastructure/scripts/deploy.sh` inside the sandbox repo.
- **nx** — drop a stub at `node_modules/.bin/nx` inside the sandbox (or shim `pnpm`).
- **gh** — PATH shim is correct.
Update L60-62/L111 to drop "ahead of the real ones on PATH" as a blanket claim, and rewrite the Task-0 smoke to test each op's real invocation form.

### B3. git / worktree / merge-base ops are NOT on the external boundary — call-log invariants over them produce false regressions across γ
**Severity:** blocker (theme; merges 3 confirmed findings)
**Spec:** Constraint 2 stability premise (L60-62); negative invariant on `branch -d` (L120); flagship scenario example (L178-184); procedure-coupling ban grep (L272-275).
**Issue:** Constraint 2 asserts the call-log oracle is "stable across β/γ" because op-stubs sit on the external boundary. But the spec then asserts invariants over `git` commands that are **not stubbed and that γ explicitly relocates into helpers**:
- The flagship example asserts `called: ['git checkout main', 'git branch -d feat/epic-acme-epic']` (L179). The *actual* post-merge tail is `git -C "$MAIN" checkout main && git -C "$MAIN" pull --ff-only` and `git -C "$MAIN" merge-base --is-ancestor … && git -C "$MAIN" branch -d …` (`SKILL.md:251-252`). The asserted strings don't even substring-match today (`-C "$MAIN"` prefix, `&&`-chain), and γ moves exactly this into a `.mjs` helper (`backlog-skills-procedure-to-tested-helpers.md:21-22`), after which the git call runs inside `node …helper.mjs` and disappears from the top-level trace. Either way the invariant flips with **zero behavior change** — the canonical false regression the design exists to prevent.
- The L120 negative invariant ("branch NEVER `-d`'d before merge") rides on the same un-stubbed, γ-relocated `git branch -d`.
- The procedure-coupling-ban grep (`runstate.mjs get`, `E1`, `E2`, step-names) **cannot catch this**: literal shell strings in `called`/`neverCalled` and raw `runstate:{…}` seeds contain none of those tokens, so the spec's own flagship example sails through the ban while being doubly coupled to γ-mutable internals.
**Fix:** Split the op taxonomy explicitly: (a) **external stubbed ops** (`deploy.sh`/`gh`/`nx`/worker) → call-log invariants, stable; (b) **internal git/worktree/merge-base ops** (γ-relocated, not stubbed) → assert via resulting FS/git **state** only (branch existence, HEAD, worktree presence, run-state file), never trace strings. Rewrite the L120 invariant as a state check at the E8.1 stop (branch present + `e8` marker set + worktree gone). Rewrite the example's `invariants` to a `postState`/`state` block; keep `called`/`neverCalled` strictly for stubbed externals; define the match semantics (substring of the stub call-log line). Replace the token-grep procedure ban with a **structural lint**: forbid any `called`/`neverCalled` entry whose command is not one of the four external stub binaries; require `runstate:` seeds expressed as helper-intent, not raw schema.

> Note: the corpus bullet at L194-195 already phrases this scenario *correctly* as outcomes ("ff main, branch -d, drop run-state; member loop NOT entered; gh pr merge never called"). The flagship `invariants` example simply contradicts the principle it illustrates — fix it to mirror the bullet so the wrong pattern isn't copied wholesale into ~20 scenarios.

---

## Major

### M1. β value proxy `first_turn_input_tokens` measures the wrong field; cost has no cache-state control
**Severity:** major (cluster; merges 6 confirmed findings on caching/measurement)
**Spec:** Execution & instrumentation (L129-133); Metrics table (`first_turn_input_tokens` L146, `total_cost_usd` L145); Modes/Noise handling (L246-250); `compare` (L240-243).
**Issue:** Multiple independent probes confirm: `usage.input_tokens` is the *uncached remainder only* (~tens of tokens); the skill prose + CLAUDE.md land in `cache_creation_input_tokens` / `cache_read_input_tokens`. So the named β proxy is near-blind to prose size — the opposite of "low-noise direct proxy." Compounding problems:
- **No cache-state control.** Three identical deterministic runs showed `total_cost_usd` swing ~88% purely on cold/warm cache (cache_creation ~1.25× vs cache_read ~0.1×). A 30%-of-median noise band cannot contain this → false regressions / masked deltas. `compare refA refB` runs A-then-B with no interleaving, so whichever variant runs second gets the warm-cache discount — a pure ordering artifact fed into the primary β/γ verdict.
- **Precedent mismatch.** The spec leans on `benchmark-agents` for cost + the 30% band, but `benchmark-agents` computes cost from **tokens × fixed price** (`scripts/benchmark-agents/pricing-loader.ts:19`, `run.ts:165`), immune to cache-pricing; and its 30% rule is an **advisory** human rerun caveat (`benchmark-agents/SKILL.md:143`), not an automated gate.
**Fix:**
1. Rename the metric `first_turn_prose_tokens` / `first_turn_total_input_tokens`, defined as `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` on the first turn (cache-warmth-immune sum). State `usage.input_tokens` alone is the wrong field.
2. Compute cost **deterministically from the per-turn `usage` token breakdown × fixed published prices** (mirror `computeCostUSD`), with documented cache multipliers — demote CLI `total_cost_usd` to a cache-state-controlled secondary.
3. **Pin cache state:** fresh sandbox cwd per run (cold) *or* a uniform warm-up before each measured run; for `compare`, **interleave variants per iteration** and report per-variant `cache_creation` vs `cache_read` so an ordering artifact is visible.
4. Reframe the 30% band: a metric outside the band **escalates iteration count** (the benchmark-agents semantics), not an automatic regression verdict.
5. Keep `num_turns` + token counts as the primary efficiency signals.

### M2. Latency (`duration_ms`/`ttft_ms`) is too noisy to be a value signal — must be down-weighted vs `num_turns`
**Severity:** major→minor (self-rated minor; kept here for the metrics edit)
**Spec:** Metrics table (L147 "latency value"); Goal #2 (L25).
**Issue:** Deterministic-prompt spreads of >100% on ttft/duration (measured) mean wall-clock latency deltas reflect API queueing, not prose. The Metrics table lumps `duration_ms`/`ttft_ms`/`num_turns` into one "latency value" row.
**Fix:** Split the row: `num_turns` = primary efficiency (low-noise); `duration_ms`/`ttft_ms` = informational, HIGH-noise, **never the sole basis for a regression/value verdict**. Reword Goal #2 to lead with tokens/turns; wall-clock reported only as informational.

### M3. Sandbox isolation is incomplete — global `~/.claude` config, hooks, MCP, plugins, and AWS env leak in
**Severity:** major
**Spec:** sandbox.mjs/runner.mjs responsibilities (L90-101); Open questions #1-#2 (L290-292).
**Issue:** Probed `claude -p` from a throwaway temp dir (cwd-independent): the `init` event loads the **user's global config regardless of cwd** — `permissionMode: auto`, `mcp_servers: [pencil connected]`, `plugins: [superpowers]`, and a `SessionStart` hook injecting the full `superpowers:using-superpowers` skill. None addressed by the spec. This defeats (a) cost attributability of the trimmed CLAUDE.md (a hook re-injects context) and (b) safety: repo `.env` carries `AWS_PROFILE=nestfolio-dev` (live in shell), inherited by spawned subprocesses; a non-stubbed `aws`/network tool would run authenticated against dev account 771924376645. **Verified:** `--setting-sources project` fully neutralizes (init shows `mcp:[]`, `plugins:[]`, `permissionMode:default`); `--bare` does **not** (still loads superpowers + auto mode).
**Fix:** Promote isolation into the design (not a deferred question). Always invoke with `--setting-sources project` (lead with this; do NOT rely on `--bare`), `--strict-mcp-config`, neutralized hooks, a default-deny `--disallowedTools` (WebFetch/WebSearch/Task + outward git remotes), an explicit spawn `env` that strips `AWS_*` and a sandbox `HOME`. Add a Task-0 hard assertion: init event shows `mcp_servers:[]`, `plugins:[]`, no SessionStart hook, no `AWS_*` in env.

### M4. Op-stub boundary misses the sub-skills a real worker invokes
**Severity:** major
**Spec:** Constraint 2 (L60); backlog-next complex-lane corpus (L222).
**Issue:** The boundary `{deploy.sh, gh, nx, worker}` omits the Skill-tool sub-skills the complex/member path drives: `superpowers:brainstorming` / `executing-plans` / `subagent-driven-development` / `finishing-a-development-branch` (`backlog-next/SKILL.md:79-82, 168`) and the direct `pnpm nx run-many -t test,lint` / `-t test-integration` calls (`backlog-next/SKILL.md:101,122`) — distinct from the stubbed "nx e2e targets." A real complex `backlog-next` run would drive real plan execution and (absent stubs) real deploys/tests. PATH stubs cannot intercept Skill-tool calls (same mechanism as B2).
**Fix:** Redefine the boundary in two layers: PATH-executable stubs (add `pnpm nx run-many`) and Skill-tool sub-skills (deny via `--disallowedTools Skill(…)` for scenarios asserting only classification/routing, or provide sandbox stub-skills). Constrain the backlog-next "complex" scenario to assert the lane verdict + worktree-adoption and STOP before downstream routing, or define stub-skills for the full path. Promote the deferred `--disallowedTools` open question into this enumerated list.

### M5. Resume-scenario sandbox setup is under-specified — bare `git init` lacks an `origin`, and run-state must be helper-derived
**Severity:** major (merges 2 confirmed findings)
**Spec:** sandbox.mjs (L89-96); scenario `runstate:` (L174).
**Issue:** Two related gaps on the highest-value (resume) surface:
- **Run-state seeding.** `runstate.mjs` writes to `<git-common-dir>/backlog-next-epic-<id>.json` (`runstate.mjs:50-53`) under a **closed 6-key schema** (`runstate.mjs:42`); a partial `{e8: …}` seed is rejected (missing required keys) and the resume gate then reads it as malformed (exit 2) — NOT a PR-awaiting resume. So `runstate: { e8: 'PR_OPEN_AWAITING_MERGE' }` (L174) is invalid as a literal write and the seed format is itself γ-coupled.
- **Git remote.** A bare `git init` sandbox has no `origin`, so `git fetch origin main`, `worktree add … origin/main` (`SKILL.md:100,106`) and the `main == origin/main` preflight (`SKILL.md:78`) all fail — for fresh epic runs too, not just resume.
**Fix:** sandbox.mjs must (1) seed run-state by **shelling the skill's own helper** (`node runstate.mjs init … && set-e8 …`) so the path + closed schema are always correct and auto-track γ schema changes; redefine the scenario `runstate:` field as a high-level intent (`{phase:'pr-open'}`) the sandbox translates; (2) build a fully-resumable repo with a local `origin` so fetch/add/preflight succeed; (3) add a Task-0 smoke: `runstate.mjs get <id>` from sandbox cwd returns the seeded state (exit 0), not FRESH.

### M6. Merge-conflict resolution (F-25) — claimed as the framework's deepest coverage — is never exercised
**Severity:** major (merges 3 confirmed findings)
**Spec:** "Why the comparison is valid" (L49-51); Merge-ownership ×2 (L210-212).
**Issue:** The spec twice claims γ's risk and the framework's coverage "coincide" on the merge-conflict surface, but **no scenario produces a real conflict** (the word "conflict" appears once in the whole spec, at L49). The Merge-ownership ×2 scenarios grade merge-*ownership* (never-self-merge / branch-kept), not the E8.1 `docs/BACKLOG.md`-vs-`<id>.md` two-kinds resolution (take-branch-side + `lint --fix` ordering, where a wrong resolution leaves the epic `active` and rule-11-blocks the next epic — `SKILL.md:228-231`). It is structurally unreachable: `gh` is stubbed and no real PR/merge ever happens, so no conflict is generated. This is one of γ's three named extraction targets (`backlog-skills-procedure-to-tested-helpers.md:23-24`).
**Fix (prefer a):** (a) Add `bne-e8-conflict-resolution`: seed a sandbox where `main` carries the E1 promotion marker (`<id>.md` = `active`, no `closed:`) + a divergent `BACKLOG.md`, branch carries shipped frontmatter; drive a real **local** rebase/merge (no `gh pr merge` needed — resolution fires at E8.1 before merge); grade the OUTCOME (`<id>.md` ends `shipped`+`closed`+`validation_gate`, lint exit 0, rule-11 unblocked). Add to the Merge-ownership group (×3) and bump the corpus count. OR (b) scope it OUT and **delete the "merge-conflict / most deeply" claims** at L49-51 and in `backlog-eval-framework.md`, adding a Non-goal that merge-conflict is covered by γ's own characterization tests.

### M7. backlog-next-epic coverage gaps in the "bulletproof" corpus (cluster of named F-fixes)
**Severity:** major (cluster of confirmed coverage findings on the HIGH target)
**Spec:** corpus L189-212.
Each is a load-bearing, named behavior on the β/γ risk surface, with zero or split coverage:
- **Corrupt run-state (exit 2 self-heal, F-11/F-13)** — Resume gate ×4 covers absent + 2 present variants, not the malformed→clean-error-STOP branch (`runstate.mjs:174`, `SKILL.md:33`). Add `bne-resume-corrupt-runstate` (seed a malformed JSON; assert clean STOP, no re-promote / branch / member loop).
- **E4.5 context-checkpoint /clear (F-4/F-10)** — the per-member + pre-E6 `/clear` recommendation (`SKILL.md:144-148`) is observable result text but unasserted; a β trim could silently drop it while quality stays green AND cost *drops* (read as a win). Add `bne-member-boundary-checkpoint` asserting the clear-recommendation + resume-command surface (semantics, not literal emoji).
- **E4.3 F-21 cumulative shared-surface typecheck** — gated by `detect-fork-blast-radius.mjs` exit 1 (`SKILL.md:142`); no scenario where a member touches `libs/event-types/src/*.ts`. Add a member-boundary pair asserting `nx … -t typecheck` called (shared touch) / not called (non-shared) via the call-log.
- **E4.3 ≤3 debug-cycle floor** — the "Bounded-effort exceeded" floor (`SKILL.md:176`) has no scenario AND is structurally unreachable: the worker stub only ever ships. Add a worker-stub `failCycles: N` knob + `bne-member-debug-budget-floor` (assert floor pause after budget; no 4th deploy).
- **E1 promotion-marker push to main** — clean-promote asserts only frontmatter; the `git push origin main` (`SKILL.md:91`, crash-recovery) is unasserted. Add `called: ['git push origin main']` via the **tool-call trace** (git is NOT a stub — do not add git to the stub set).
- **E6 zero-tests-collected false green (F-24)** — corpus covers stale-sha + red/never-ran, not the nx-quote-strip "exit 0 / 0 tests" foot-gun (`SKILL.md:200`). Add `bne-e6-zero-collected-green` (nx stub prints "0 tests" + exit 0 → treated as RED, no ship). Make the nx stub per-scenario configurable for {exit code, collected-count}.
- **E8.1 merge-conflict** — see M6 (same root).
**Fix:** Add the scenarios above; bump the corpus count from ~20.

> **Lower-priority bne sub-gaps (minor, list for completeness, fold into the same corpus edit):** E0 epic-start preflight stop (no dirty-tree scenario for the epic entry); E2 worktree-pruned re-attach (assert `worktree add` *without* `-b`); E7.1 captured-promote → forced-E6 *chained* invariant (assert 2nd e2e run after re-work); E5 append-only decision-log under reversal (2-fork, entry[0] intact); E5 computed-selection-must-confirm-even-in-`--auto` (`/backlog-next-epic --auto` no-id → still pauses at selection, no promote/worktree/deploy before confirm); E8.4 postflight-from-`$MAIN` cwd-survival (F-23) — assert run-state gone at the helper-resolved absolute path + postflight succeeded.

### M8. Other-skill coverage gaps (backlog-add, backlog-next)
**Severity:** major (merges 2 confirmed findings)
**Spec:** backlog-add MEDIUM (L214-218); backlog-next MEDIUM (L220-222).
- **backlog-add** omits four route-distinct, load-bearing behaviors: (1) commit-message **prefix** per route + `git add` touched-files-only / never `git add .` (`SKILL.md:62`); (2) id-collision `-2`/`-3` suffix (`SKILL.md:59`); (3) minted theme-epic **template** correctness (`SKILL.md:90-117`) — currently only the *suggestion* is verified; (4) the double-quoted-scalar YAML rule for `notes:` (`SKILL.md:88`) — NOT caught by "lint exit 0" since the parse gate is now total, so it needs an explicit string-type golden.
- **backlog-next** at 3 lane scenarios under-samples a multi-clause disqualifier that gates the suite's most expensive routing (worktree/deploy/e2e/finishing). Add scenarios per distinct cut-point: public-interface change → Complex; deploy-gated → Complex; spec-only `type: design` → stays Doc-layer (`SKILL.md:62`); plus ≥1 closing-phase scenario grading deploy/doc-derivation detector outcomes via the call-log. Raise to ~6.
**Fix:** Add the above; note both are MEDIUM-tier and the spec defers corpus detail to the plan, but these are silent regressions a behavior-preserving refactor could introduce.

---

## Minor / nits

- **m1. `--verbose` is omitted but the CLI hard-requires it** with `-p --output-format stream-json` (verified: `Error: When using --print, --output-format=stream-json requires --verbose`). The documented invocation (L97-99, L125, "verified") fails on the first run. Add `--verbose` to the runner command and the Task-0 checklist. *(merges 2 identical findings)*
- **m2. backlog-themes at 1 scenario** can't test the cluster-by-root-cause-not-symptom + don't-force-singletons + extend-vs-mint judgment that is the skill's whole purpose (`SKILL.md:42-45,82-85`). Add ≥1 decoy+singleton discrimination scenario (only the real cluster aggregates) and a judge "clustering quality" dimension. *(self-rated nit; cheap, reuses the judge layer)*
- **m3. "core is skill-agnostic / reusable" is asserted (L68-69) but never substantiated** — no reusable seam defined; most components are backlog-coupled. Per the project's reusability-primary rule, either add a §"Reusable seam" naming `runner.mjs`+`report.mjs`+the mode loop as the skill-agnostic core vs a `defineSuite({buildSandbox, stubs, grade, scenarios})` config surface (cite `scripts/benchmark-agents/run.ts` as the template + `.github/workflows/pr-audit.yml:46` as the existing `claude -p` precedent — correcting the spec-adjacent "net-new" assumption), or downgrade the claim to an explicit future-deferral.
- **m4. `first_turn_input_tokens` "isolates β" overclaims** — the sandbox injects a fixed trimmed-CLAUDE.md slab (CLAUDE.md:75-125, ~9KB) into first-turn input that doesn't move with β, and the SKILL body loads on Skill-tool invocation (disable-model-invocation skills), not turn 1. Soften to "a low-noise *component* of the prose signal," subtract the fixed floor, and read the metric from the turn following the Skill tool_use. *(folds into M1)*
- **m5. Mutation check targets the wrong layer** — "delete the rule-11 guard" (L278-280) flips the gate via the *deterministic* lint layer (`ruleSingleActiveEpic`, `rules.mjs`), which the spec already trusts — it proves nothing about the orchestration oracle γ refactors. Pick a prose-only target (delete the E8 "never `gh pr merge`" guard `SKILL.md:234` → confirm `neverCalled:['gh pr merge']` flips; or the resume "skip E0/E1" line `SKILL.md:41`). Add a constraint that the mutation must not be independently caught by lint.
- **m6. No value-oracle teeth test** — the mutation check proves the *quality* gate has teeth but not that the cost/value side can detect a known token delta (and M1 shows that side is exactly what's in doubt). Add a value-oracle mutation: inject a known ~K-token block, confirm the (corrected) prose proxy rises ~K and cost clears its band — calibrating the minimum detectable effect.
- **m7. Single N=3 conflates the discrete quality oracle and the continuous cost/latency metrics** — 3/3 Bernoulli ≠ a 100% estimate. State the quality contract explicitly as "any single gate flip = regression" ([[feedback-flake-means-broken]]) so small N is sound for quality; for the noisy continuous metrics, lean on the (corrected) near-deterministic first-turn-token proxy or escalate N on band breach, rather than a blanket N≥8. *(self-rated minor)*
- **m8. Problem statement size figure is loose** — "~3,900 lines of SKILL.md prose plus helpers" (L11): SKILL.md prose is ~800 lines; ~3,900 is the whole suite incl. already-tested `.mjs` helpers (out of scope). Sharpen to "~800 lines of orchestration prose (the target) plus ~3,500 lines of already-unit-tested helpers." *(nit)*
- **m9. `/benchmark-backlog` "mirrors /benchmark-agents; disable-model-invocation: true"** — benchmark-agents has **no** such flag (it uses prose guard); the flag is real elsewhere (`backlog-next-epic/SKILL.md:4`). Reword to source the flag from backlog-next-epic, keep the user-triggered analogy + add the prose guard. *(nit)*
- **m10. Scenario invariants assert git calls but no capture source is bound** — layer 2 says "call-log + tool trace" but never states git invariants resolve from the *Bash-tool trace* (git is real, never in `stubs.log`). Split the invariant schema by source and add the binding sentence + a Task-0 check that git surfaces in the trace. *(folds into B3's structural-lint fix)*

---

## Uncertain (needs a decision)

These were verified as *real underlying issues* but their headline framing/severity did not survive scrutiny — decide based on the empirical caveats below, not the original blocker framing.

- **U1. β proxy "reads ~3 tokens" (originally blocker).** The general caching fact is correct and authoritative (prose lands in cache fields; see M1), but the specific empirical claim ("`input_tokens` = 3 every run") was **not reproducible** — fresh runs on CLI 2.1.187 showed `input_tokens` = 6583 — and it **misreads** the spec, which already says "`usage.input_tokens` + `cache_*`" (L129). The real, decidable issue is the *ambiguous metric name/source* + *no cache-state control*, both covered by **M1**. **Decision:** adopt M1; do NOT cite "input_tokens = 3" as evidence.
- **U2. Problem-statement size = ".mjs helper total" (originally minor).** The accurate critique (figure is loose) is captured in **m8**, but the finding's *explanation* — "3,900 = the `.mjs` total (3,509)" — is itself wrong (3,509 ≠ 3,900; 3,900 ≈ the whole prose+helpers+tests suite). **Decision:** apply the m8 wording fix; do NOT adopt the "973 / 3,509 .mjs" framing.
- **U3. "Spec is borderline as a single plan" (originally minor → nit).** The *substance* (Task-0 unknowns are load-bearing and gate the corpus) is real and is the backbone of the Executive verdict. The *framing* overreaches — the spec is explicitly `Status: design` and defers to the plan layer, so "borderline as one plan" attacks something it doesn't assert. **Decision:** don't restructure the spec; instead make the two additive edits (label the corpus provisional-until-Task-0; reframe the four Task-0 confirmations as accept/reject gates). See "Recommended edits" #1.

---

## What the spec gets right (fair)

- **The dual oracle is genuinely well-chosen.** Because `backlog-skills-simplification`'s contract is "no behavior/invariant changed," *any* gate diff is unambiguously a regression — no intended-vs-regression disambiguation. That is a real, elegant fit and the right foundation.
- **The 3-layer grader** (deterministic golden+lint / call-log+trace invariants / fuzzy LLM judge, with judge cost tracked separately) is sound and reuses `backlog-lint/lib` rather than reimplementing.
- **Corpus density and the "assert outcomes, not procedure internals" principle** (constraint 1) are exactly right in spirit — the bne corpus enumerates the real F-fix surface unusually thoroughly; the gaps found are additive, not structural.
- **Baseline-first sequencing** and the self-consistency + mutation-check validation gates show genuine methodological care.
- **Reusing `benchmark-agents`** as the orchestration/cost template is the right instinct (the precedent mismatch in M1 is fixable, not fatal).
- **The spec is honest about its unknowns** — Task-0 smoke + Open questions already name skill-discovery, `--disallowedTools`, and `--setting-sources`; the fix is to *gate* on them, not invent them.

---

## Recommended spec edits before writing-plans (ordered checklist)

1. **Convert Task 0 into a gating spike** (resolve before authoring the corpus): pin the **headless pause signature** (B1 — AskUserQuestion is absent; choose a sentinel convention), the **worker/skill + per-op interception seam** (B2 — sandbox stub-SKILL.md for the worker; in-repo `deploy.sh`; `node_modules/.bin/nx`; PATH `gh`), the **sandbox isolation set** (M3 — `--setting-sources project`, strip MCP/hooks/plugins/`AWS_*`), and **`--verbose`** (m1). Label the corpus **provisional until the spike lands** (U3). Each Task-0 item is accept/reject.
2. **Rewrite the op taxonomy + call-log oracle** (B2 + B3 + M4): two layers — external stubbed ops (call-log) vs internal git/worktree (FS/state). Replace the token-grep procedure-ban with a structural lint (call-log entries ∈ {deploy.sh, gh, nx, worker}; seeds as helper-intent). Fix the flagship example to a `postState` block. Enumerate the Skill-tool sub-skills to deny/stub.
3. **Fix the measurement layer** (M1 + M2): rename/redefine the prose proxy to the cache-inclusive sum; compute cost deterministically from tokens × price; pin cache state + interleave `compare`; reframe the 30% band as escalation; split the latency row (num_turns primary, wall-clock informational); add the value-oracle teeth test (m6) and the explicit quality-N contract (m7).
4. **Specify resume-scenario sandbox setup** (M5): helper-derived run-state seeds + a local `origin` remote + a `runstate.mjs get` smoke; redefine the `runstate:` scenario field as intent.
5. **Resolve the merge-conflict coverage claim** (M6): add `bne-e8-conflict-resolution` (preferred) OR delete the "merge-conflict / most deeply" claims and add a Non-goal.
6. **Close the named bne coverage gaps** (M7): corrupt run-state, checkpoint/clear, F-21 typecheck, debug-budget floor (+ worker `failCycles` knob), E1 push, E6 zero-collected; plus the minor sub-gaps. Fix the mutation check to a prose-only target (m5).
7. **Add the other-skill coverage** (M8 + m2): backlog-add four behaviors; backlog-next disqualifier scenarios + closing-phase detector grading; backlog-themes discrimination scenario.
8. **Tidy the prose** (m3, m8, m9): substantiate or defer the reusability claim; correct the size figure; fix the `disable-model-invocation` attribution.

---

### Severity tally
- **Blockers:** 3 (B1 pause oracle, B2 op-stub interception, B3 git-on-call-log comparability)
- **Major:** 8 (M1 cache/cost metrics, M2 latency noise, M3 isolation, M4 sub-skill boundary, M5 resume sandbox, M6 merge-conflict coverage, M7 bne coverage cluster, M8 other-skill coverage)
- **Minor/nit:** 10 (m1–m10)
- **Uncertain:** 3 (U1–U3)
