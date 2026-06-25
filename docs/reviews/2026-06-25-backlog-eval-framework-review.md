# Backlog-Skill Eval Framework Review

**Target:** `scripts/benchmark-backlog` (the `/benchmark-backlog` harness)
**Date:** 2026-06-25
**Scope:** Two questions — (Q1) is coverage correctly *weighted* relative to the backlog system under test, and (Q2) is a full test session reasonable in time and tokens. All claims below survived adversarial verification; the one refuted finding is called out explicitly.

---

## 1. Verdict

**Q1 — Weighting: qualified yes on rank, no on one magnitude gap.** The corpus gets the *ordering* right (the two execution engines top the eval, the lowest-risk skill gets the lightest touch), and `backlog-add`'s load-bearing core-vs-captured decision IS hard-gated (by deterministic golden `epic_role` teeth — the alleged "no teeth" gap was **refuted**). The one material, verified misalignment is **`backlog-next`**: the #2-blast-radius skill (where the real `deploy.sh`, `git push origin main`, and destructive `worktree remove --force`/`branch -d` fire) has **zero heavy/drive-to-ship coverage** — all 6 of its scenarios pause at classification, and `deploy.sh` is never asserted as having fired *anywhere* in the corpus. `backlog-next-epic` is correspondingly over-indexed (35/52 scenarios) with thinly-gated select/resume variants.

**Q2 — Cost: yes for the committed 6-exemplar gate, no for a routine full sweep.** The committed baseline subset (~28M tokens, ~2 hr) is a reasonable pre-merge gate. A full 52×3 regression (~300M tokens, est. ~8–19 hr strictly-sequential) is a full-day quota burn unsuitable for routine use; compare-mode (~600M tokens) is one-time-only. Cost concentrates overwhelmingly in `backlog-next-epic` (~88% of tokens — robustly measured).

---

## 2. Q1 — Coverage vs complexity weighting

> **Caveat (verified):** the per-skill *complexity-weight* percentages are the assessor's external analytic model — scenario files carry no weight/heaviness/teeth/complexity field, so the headline ratios (e.g. 2.1x) rest on an out-of-band denominator, not a measured one. The **count, gate, and heavy/light facts below are all code-derived and verified.**

| Skill | Cx-wt (analytic) | Scenarios | Cnt-share | rubricGate (hard teeth) | Heavy drive-to-ship | Surviving Q1 read |
|---|---|---|---|---|---|---|
| backlog-next-epic | 32% | 35 | 67.3% | 16 | 21 (all heavy live here) | Over-indexed (directional); redundant 5 `select-*` / 5 `resume-*` |
| **backlog-next** | **28%** | **6** | **11.5%** | **6** | **0** | **UNDER-covered: #2 risk, 0 heavy, outward ops never driven** |
| backlog-lint | 20% | 0 | 0% | 0 | 0 | Defensible offload (5 unit suites) + 1 residual gap |
| backlog-add | 13% | 9 | 17.3% | 2 | 0 | Count-vs-teeth concern **REFUTED** — golden teeth gate the core call |
| backlog-themes | 7% | 2 | 3.8% | 1 | 0 | Correctly proportioned to lowest risk |
| **Total** | 100% | **52** | 100% | **25** | **21** | — |

### Material misalignments that survived verification

**(M1, high) `backlog-next` is under-covered for its blast radius — and its outward ops are never positively asserted.** All 6 `skill:'backlog-next'` scenarios are `terminal:'pause'` at the routing/preflight decision; none drives `preflight → worktree → deploy.sh → finishing-a-development-branch PR → postflight → cleanup`. Corpus-wide, `deploy.sh` appears in call-logs **only as `neverCalled`** — no scenario ever asserts a deploy fired. Positive `callLog.called` assertions exist in exactly **3** scenarios, all `backlog-next-epic` (`gh pr create` ×2, `nx` ×1). The framework is overwhelmingly a "didn't-do-the-bad-thing" negative-invariant oracle for the one skill where the bad-and-good things actually execute. *Correction to source:* `next-lane-complex` is **not** "pure advisory" — it carries a deterministic `state:{branchCreated:true}` proxy (graded by `gradeInvariants`); 5 of 6 next-* use that proxy, and only `next-closing-detector` is purely rubric+terminal.

**(M2, medium) Thin-gated bne STOP/select scenarios can pass for the wrong reason (~6 scenarios).** Scenarios whose entire purpose is a judgment call gate only on `terminal:'pause'` + `branchCreated/memberLoopEntered:false`, leaving the discriminating behavior to an **ungated advisory rubric** (`rubricGatePasses` returns true when `rubricGate` is unset). A model that pauses asking "which epic?" *without* ranking by impact still passes `bne-select-impact-rank`/`-like-criterion`. `bne-resume-corrupt-stop` asserts only `memberLoopEntered:false` (no `branchCreated`), so a silent re-branch on corrupt run-state — the exact danger it exists to catch — is not caught deterministically. Affects `bne-select-{zero-candidates,impact-rank,like-criterion,auto-confirm}` and `bne-resume-{partial,corrupt-stop}`. The irony: `rubricGate` *was* applied to `bne-rule11-different-active` and `e8-conflict` but not to the thinnest-gated scenarios.

**(M2b, latent harness bug) `denySubskills` is a dead/no-op field.** `runner.mjs` spawns the worker with a fixed `--allowedTools` list (which *includes* `Skill`) and never passes `--disallowedTools` or reads `scenario.denySubskills`; no settings deny-rule is written. So `bne-resume-partial`'s `memberLoopEntered:false` is a genuine behavioral check (not "structurally guaranteed" — that sub-claim was refuted), **but** 8 scenarios silently rely on a field the harness ignores.

**(M3, medium) `backlog-next-epic` is over-indexed (directional).** 35/52 scenarios for a skill 4 analytic points above `backlog-next`. The investment is justified by rank (only skill with `--auto` fork-resolution, the single self-merge failure F-7/F-33, the batched deploy+e2e+Playwright ship), and all 21 heavy runs legitimately live here — but the `5 select-* / 5 resume-*` light variants carry redundancy that could be thinned to fund M1.

**(M4, medium) `backlog-lint` has zero eval scenarios — defensible, with one residual gap.** Lint is the sole enforcement of all 11 invariants yet is never a top-level scenario; it is exercised only via `lintExit0:true` end-state goldens (in 11 scenarios: 8 add-*, 2 themes-*, 1 bne-*). This is the right offload — lint is pure, deterministic, loud-failing, and the most unit-tested skill (5 suites). **Residual gap:** every `lintExit0` golden proves lint *passes*; no scenario feeds a rule-violating state to confirm the agent *detects and repairs* it.

**(M5, also affects Q1 trust) Committed baseline covers only 6/52 — regression mode is inoperative for 46.** `baseline.json` holds 6 rows; the `/benchmark-backlog` regression workflow treats a scenario missing from baseline as itself a finding, so 88.5% of the corpus is **structurally-sound-but-live-unproven**. The full-corpus baseline is deferred to parking item `backlog-eval-framework-baseline-run`.

### Refuted — do not act on

> **`backlog-add` core-vs-captured "advisory-only, no teeth" — REFUTED.** The defining risk (misfiling a core member as captured silently drops it from a done-definition) **is** hard-gated: `add-fold-core`/`add-fold-captured` assert frontmatter `epic_role` in the **golden** layer, and `gatePass` requires `golden.pass`, so a core↔captured misfile **deterministically fails the run**. The two `rubricGate` scenarios are gated precisely because deterministic golden cannot reach them (`add-mint-aggregation` pauses with no file write; `add-commit-scope`'s git behavior isn't stub-assertable) — the opposite of "they gated the mechanical branch." Adding `rubricGate` here would be redundant fuzzy teeth over stronger deterministic teeth.

---

## 3. Q2 — Full-session time & token cost

> Token figures are grounded in measured `baseline.json` rows and verified. **Wall-clock is an estimate** — `durationMs` is captured at runtime (`runner.mjs:31`) but **not persisted**, so hours are turn-count proxies, not measured.

| Session variant | Worker runs | Judge calls | Est. tokens | Est. wall-clock (sequential) | Reasonable? |
|---|---|---|---|---|---|
| **(a) Committed baseline:** 6 exemplars × 3 | 18 | 18 (sonnet) | **~28M** | **~2 hr** (×N de-flake passes) | **Yes** — intended pre-merge gate |
| **(b) Full regression:** 52 × 3 | 156 | 156 | **~300M** | est. **~8–19 hr** | **No** for routine use |
| **(c) Compare A/B:** 52 × 3 × 2 | 312 | 312 | **~600M** | est. **~16–38 hr** | **No** — one-time before/after only |
| — of which `backlog-next-epic` (in b) | 105 | 105 | **~262M (~88%)** | dominant | the cost driver |
| add + next + themes (in b) | 51 | 51 | ~36M (~12%) | minor | negligible |

**Per-run priors (measured):** add ≈0.40M (`add-fold-captured` 0.371M), next ≈1.1M (`next-lane-complex` 1.079M), themes ≈0.9M (0.890M), **bne ≈2.5M blended** — a *loose upper bound*; the 3 measured bne exemplars mean **2.32M** (1.67M / 2.25M / 3.04M). Judge ≈0.02M/call on sonnet (capped: result+diff sliced to 4000 chars), so all judges across the full sweep are a ~3M rounding error vs opus workers. On Max quota, cost is **tokens/quota, not dollars** (`add-fold-captured` $1.13, `bne-e8-conflict` $7.25 are informational only).

**Where cost concentrates (verified):** `backlog-next-epic` is 35/52 scenarios and ~88% of tokens — robust. Even its "light" early-pause runs cost 1.7–2.2M tokens because the large `backlog-next-epic` SKILL.md (35.6KB) is cache-re-read every turn (`tokens.total` is the value signal). **Execution is strictly serial** (`for…await` over scenarios *and* iterations; compare interleaves A,B,A,B) yet scenarios are **embarrassingly parallel** (each `buildSandbox` makes a unique tmpdir + bare origin with per-scenario cleanup — no shared state). The only forcing function for serial is shared subscription rate-limits, not a data dependency — so a bounded worker pool is a clean 2–4x wall-clock lever. **No scenario sets `timeoutMs`** — a blanket 600s ceiling applies to all 52 (the field is plumbed but unused; `runner.mjs` defaults 240s, `run.mjs` deliberately raises it to 600s).

---

## 4. Recommendations

Primary repo goal is **reusable patterns** — the do-now items favor liftable assertion/parallelism patterns, not one-off coverage.

### Do now

1. **Add 1–2 HEAVY `backlog-next` drive-to-ship scenarios** (M1, M-outward-ops). Drive a single non-epic complex item through `preflight → worktree → deploy.sh → finishing-a-development-branch PR → postflight (7 checks) → cleanup`, with **positive** assertions: `callLog.called:['deploy.sh']`, `state.originMainContains` (push happened), branch deleted. The `deploy.sh`/`nx`/`gh` stubs already exist (`sandbox.mjs` copies them in), so this is mechanically feasible. *This is the single biggest gap — the #2-risk skill currently has zero positive outward-op coverage.* The positive-outward-op assertion is a **reusable pattern** for any future skill that ships/deploys.
2. **Add `rubricGate:4` to the 6 thin-gated bne STOP/select scenarios** + add `state:{branchCreated:false}` to `bne-resume-corrupt-stop` (M2). Their advisory rubrics already pose the right yes/no question; this converts "pass-for-wrong-reason" into hard teeth on exactly the judgment the scenarios exist to test.
3. **Fix or remove the dead `denySubskills` field** (M2b). Either wire `runner.mjs` to emit `--disallowedTools` from `scenario.denySubskills`, or delete the field from 8 scenarios + the schema. Today it silently does nothing — a latent correctness bug in the harness itself.
4. **Run the deferred full-corpus baseline before `backlog-skills-simplification`** (M5), at minimum live-validating the newly-`rubricGate`d discriminators from (2). Until then, treat the 46 uncovered scenarios as *provisional* in any "no regression" verdict.

### Nice to have

5. **Opt-in `--concurrency=N` (default 1, cap 2–4) worker pool** over the scenario list. Cuts the rare full sweep 2–4x; preserve per-scenario try/catch + the `[bef]` progress line. The bounded-parallel headless-eval harness is itself a reusable pattern.
6. **Per-scenario `timeoutMs` tiering.** Tighten the default to ~240s on the ~31 light runs (catch silent loops as failures) and set explicit overrides only on the ~21 genuine 18–24-turn epic ships.
7. **One light `backlog-lint` "agent-repairs-violation" scenario** (M4 residual gap) — hand the agent a rule-9/11-violating state and assert it runs lint, detects, and repairs rather than proceeds. Closes the one-sidedness of the `lintExit0`-pass goldens (redundant with unit suites, so low priority).
8. **Thin ~5–8 redundant bne `select-*`/`resume-*` light variants** (M3) and reallocate the budget to (1). Lower priority than adding the missing coverage.
9. **Content-aware iterations** — *only* as a documented opt-in, not a default. Verified caveat: golden gates **do** flip on regressions (deterministic grader over stochastic model output), so defaulting golden-only scenarios to `iterations=1` removes regression-flip detection. Keep 3 as the safe default; `--iterations=N` already exists for a quick smoke.

---

## 5. What's working well

- **Right-sized, not gold-plated.** ~671-line harness core + ~459 lines of unit tests grading 5 skills. The 3-layer grader is ~100 lines and **reuses `backlog-lint`'s own frontmatter/rules libs** (no duplication); the call-log op-taxonomy, 46-line structural-lint (procedure-decoupled grading), and interleaved A,B,A,B compare (justified by the measured ~88% cold/warm cache swing) each earn their keep.
- **The load-bearing `backlog-add` decision is well-covered** (the refuted finding's silver lining): core-vs-captured is gated by deterministic golden `epic_role` teeth — stronger than a fuzzy rubric.
- **Calibration risks genuinely resolved** and never undermined the live signal: the dead prose-token proxy is fully removed (value signal is now `tokens.total`, proven to have teeth: +53,831 on a ~2k-token injection vs +2 for the dead proxy); the unit-test tmpdir-leak was always test-disk hygiene (the live runner already cleans up in `finally`).
- **Judge economics are right:** 1:1 with workers but on cheaper sonnet with a capped prompt — a rounding error vs opus workers.
- **Cheap targeted gating already exists:** `--skill`, `--scenario`, and `--iterations` compose, so most pre-merge work can run a sub-10-run smoke without the full 52×3.
- **The eval's ordering is directionally correct:** the execution engines top it, themes gets the lightest touch, and the oracle-teeth experiments proved the grader has real teeth (positive + negative deterministic invariants) on the heavy ship/`--auto` paths.
