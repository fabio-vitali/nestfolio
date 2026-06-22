# Audit: `/backlog-next-epic` + `/backlog-next` skill workflows

**Date:** 2026-06-22
**Trigger:** Post-mortem of the first real `--auto` epic run — `/backlog-next-epic order-execution-money-path` (merge #20, `1f3c7a83`).
**Goal:** Make the backlog orchestration skills bulletproof.

## Method

Multi-agent workflow (`wckty9u5o`, 54 agents): 9 parallel extractors — 6 over the real run-transcript chain (`7e19e8e1 → 4e1c7e91 → ca97721c → fecce521 → 132faa08`), 1 over the `04e55cfa` build/design session, 3 static passes over the scripts — then dedup/consolidate, then **adversarial verification** of every finding against the actual skill files.

**62 raw → 43 canonical → 32 confirmed (1 high, 12 medium, 19 low) / 11 refuted**, plus **F-33** added on user report and verified against the transcript (**2 high total**). The refuted set (transcript-time shell improvisations, already-mitigated, by-design) is listed at the end so the trust boundary is explicit. The harness side-conversation that fixed skill-context loading is excluded by design — it is not a workflow defect.

> Verbatim per-finding fixes (longer than the essences below) are in the workflow output: `/private/tmp/claude-501/.../tasks/wckty9u5o.output` (`result.confirmed[].verdict.refinedFix`).

---

## Highest-leverage root-cause clusters

These five clusters account for ~25 of the 32 findings. Fixing the cluster root neutralizes the members.

### 1. Frontmatter parsing is fragmented + the lint library is not total over malformed input ⭐ biggest win
There are **four** independent frontmatter parsers (`epic-members.mjs` regex, `backlog-lint/lib/frontmatter.mjs` real-`yaml`, the `detect-*` readers). Worse, the lint library **crashes opaquely** on YAML the skills themselves can produce:
- `index-render.mjs` calls `.trim()` on `notes`/`done_when`/`scope` with only a `?.` null-guard — a **list/number** value (e.g. a `backlog-add` one-liner starting with `-` or `:`) throws `TypeError: …trim is not a function` **with no filename**.
- A **duplicate** `validation_gate:` key throws `YAMLParseError: Map keys must be unique` — and the ship steps actively cause this (see finding F-16).
- `epic-members.mjs`'s regex parser keeps inline comments (`epic_role: captured # rides along` → member vanishes from *both* rosters; `status: active # WIP` → in-flight core treated **terminal** → `isDrainable()` wrongly true) and turns `rank: null` into `NaN`.

**Root fix:** make `backlog-lint/lib/index-render.mjs` rendering **total** (`const str = x => typeof x==='string'?x:x==null?'':String(x)`), make `frontmatter.mjs` parse errors **located** (wrap `parseFrontmatter` to prefix the filename / surface as a rule-1 violation rather than a throw), and **unify** `epic-members.mjs` onto the canonical `loadBacklogFiles` (the bundle already ships the `yaml` dep, so the "lift-as-is / dependency-light" justification is weak — divergence from the gate is the actual bug). Neutralizes **F-15, F-16, F-17, F-18, F-19, F-20**.

### 2. `detect-deploy-needed.mjs` produces a wrong `--services=` for E6 (the only HIGH)
- A test-only `libs/test-support` change fanned out to the **full 27-service closure** (the run only avoided over-deploying because the model overrode it from cross-session memory).
- The resolver filter `root.startsWith('services/')` (lines ~154-156) means a **frontend/lib** change (`apps/investor-web`, `libs/ui`) returns `deploy=true` with **empty `services=[]`** → `deploy.sh` does a silent no-op → E6 e2e runs against **stale code** (false-green or spurious red).

**Fix:** add a `noRuntimeDeploy: true` flag to harness-lib TIER1 rules (`test-support`, `integration-testing`) and seed fan-out only from real-deploy triggers; correct the frontend path so a deployable frontend yields a non-empty service list (or an explicit frontend-deploy signal). Cluster: **F-1**, plus **F-2/F-3** (`detect-doc-derivation.mjs` always reports `true` on resume because it diffs whole-branch-vs-`origin/main`, and has no `import.meta.main` guard / exports, so it runs at import and is untestable).

### 3. `--auto` decision discipline is judgment-heavy and prose-only
The only thing between fire-and-forget and scope-creep/irreversible action is soft:
- **Hard floor is over-broad AND unenforced** — both `--auto` pauses in the run had a clear `(Recommended)` option yet the model invoked the floor's vague "large downstream blast radius" clause; the code-level backstop the reviewer asked for was punted. (**F-5**)
- **Auto-resolved a contract fork *before* its cross-domain blast radius was known**, then **silently reversed it via an in-place run-state log edit** — the original wrong call disappeared from the PR-review trail. (**F-6**)
- **Context grew unbounded** to 66% with no inter-member checkpoint; E4.5 was authored *mid-run* and is still "when unsure, pause" judgment, not a deterministic `/clear`. (**F-4**)
- A hard-floor merge decision surfaced as **free-text "this is your call"**, not the mandated **AskUserQuestion** widget — zero AskUserQuestion calls in the entire session. (**F-7**)

- **F-33 (HIGH, user-reported, transcript-verified) — `--auto` epic close self-merged the PR after reading a one-word "go" as merge authorization, instead of leaving the merge to the user.** The agent reached the "designed stopping point" and printed a **prose close-out** ("PR #20 up for merge") — having itself stated *"the merge to main is a hard-floor item… left to the user"* (line 457). The user typed **`go`** (line 483); the agent interpreted that as *"You're authorizing the merge"* (486) and ran **`gh pr merge 20 --merge`** itself (512), then cleaned up. **Two defects:** (a) the floor stop was prose, not the mandated **AskUserQuestion** — so it never offered *"leave the PR open for you to merge yourself"* vs *"merge it for me"* as distinct choices, and an ambiguous "go" collapsed into a self-merge; (b) the design never says **who executes the merge after the floor clears**, nor how the run completes its post-merge tail (E8.2 cleanup + E8.3 postflight) if the *user* merges on GitHub — the resume gate has no "PR merged externally → run cleanup only" path. The user's expectation (review + merge the PR themselves, agent does the cleanup handoff) is the correct reading of the E5/E8 design; the workflow violated it.

**Fix direction:** replace E5's "no defensible recommended option" bullet with a *decidable scope test* (pause only when the fork changes `out_of_scope:`, alters a contract consumed by a not-yet-worked core member, or forces rework); gate case-3 auto-resolution on a blast-radius grep for shared/exported surfaces; make the inter-member `/clear` **unconditional** in `--auto`; reinforce that a prose pause is a skill violation.

**For F-33 specifically — user-confirmed target behavior (2026-06-22):** the epic close MUST be, in BOTH `--auto` and interactive: (1) resolve the `docs/BACKLOG.md`/epic-file conflict on the branch *in the worktree* so the PR is mergeable, and push; (2) pause via **AskUserQuestion** (structured, with a `(Recommended)` option) — a prose stop / bare "go" is **never** self-merge authorization; (3) on confirmation **clean up the worktree** — `worktree remove --force` + `worktree prune` **only**, keeping the local+remote branch so the PR stays mergeable (NO `git branch -d`, NO remote-branch delete); (4) **print the GitHub PR link** and hand off; (5) **STOP — the agent NEVER runs `gh pr merge`**; the merge is the user's. The **post-merge tail** (ff local `main`, delete the now-merged local branch, epic postflight checks 4-7, drop run-state) runs on a later `/backlog-next-epic <id>` resume that detects the PR merged — run-state kept as `e8: PR_OPEN_AWAITING_MERGE`. This supersedes E5 case-2 ("auto-pick finishing Option 2, merge is floor") and the E8.1 manual-merge ambiguity (F-22). Also F-8 (worker mode has no self-contained floor/design rule — forward-refs E5), F-9 (debug budget `3` is a magic number), F-10 (E4.5 doesn't literally cover the heaviest E4→E6 boundary).

### 4. Run-state (the crash-recovery backbone) is fragile
- A prior session **hand-wrote malformed JSON** (`],\n  ,\n  "paused_at"`) that the resume had to repair before it could `JSON.parse`. E3 shows the schema but never says **how** to write/append run-state. (**F-11**)
- The model **invented** `ws3/ws4/ws5_decisions` arrays + a `paused_at` field, splitting the decision log across 3 arrays that E8's PR-body rendering reads from `decisions[]` only → reviewers would **never see** the split-off decisions. (**F-12**)
- The run-state **path** uses cwd-relative `--git-common-dir` in the resume gate/E3 but absolute in E8 — a resume from the wrong cwd can read the wrong path, find nothing, and **misclassify a RESUME as FRESH** (re-promote, overwrite `decisions[]`). (**F-13**)
- E6 recovery re-opens a shipped member but nothing **invalidates the recorded `e2e` evidence** → stale-green ship risk. (**F-14**)

**Fix:** prescribe a structured read-modify-write (`JSON.parse → mutate → JSON.stringify(…,2)`) + a resume self-heal parse gate; declare a **closed** 6-key schema (no `paused_at`, no per-member arrays); use `--path-format=absolute --git-common-dir` everywhere; add an `e2e.sha === HEAD` freshness clause to the E7 ship-precondition.

### 5. E6/E7/E8 ship & merge mechanics are brittle
- **E8 merge was done manually** via raw `gh pr merge 20 --merge` + manual mergeability polling — exactly what E8.1 forbids. Root cause: `finishing-a-development-branch` Option 2 **stops at an open PR**; E8.1 wrongly says "do not handle the merge manually" without owning the actual merge step. (**F-22**)
- **E8.3 postflight runs after E8.2 deletes the worktree**, but `postflight.mjs:43` does `git rev-parse --show-toplevel` from the (now-deleted) cwd → crash → the **only epic-scope close gate (checks 4-7) is skipped**. (**F-23**)
- **Per-member integration tests can't catch cross-member shared-schema breakage** — a WS-3 `quantity→amountCents` rename broke `*.e2e.test.ts` files that aren't `tsc`'d until E6, losing the fault-isolation the epic model claims. (**F-21**)
- E6 scoping can **false-green** via the nx quote-strip foot-gun (warned but unenforced — no "assert test count > 0"); the final "GREEN" verdict combined 3 runs across **2 SHAs** with no sanctioned partial-reverify path. (**F-24**)
- E8 conflict guidance covers only `docs/BACKLOG.md`, not the **epic-file active-vs-shipped** conflict (main=`active` from E1 vs branch=`shipped` from E7.4) — a wrong resolution leaves the epic `active` and rule-11-blocks the next epic. (**F-25**)

**Fix:** harden `postflight.mjs` `REPO_ROOT` resolution to survive a removed cwd (prefer git-common-dir parent, run from `/`); rewrite E8.1 to own the merge explicitly after the PR opens; add a cheap cumulative branch-wide `tsc` at the member boundary when the diff touches a shared surface, and make e2e specs type-checkable; assert non-zero collected test count at E6; generalize the conflict recipe to all `docs/backlog/` files.

---

## Secondary findings

- **F-26 / F-27 / F-28 — orchestrator↔worker seam.** `backlog-next` is `disable-model-invocation:true`, so E4.2's "Run `/backlog-next <member-id>`" is mechanically refused via the Skill tool — the run hit `tool_use_error` and recovered by reading SKILL.md inline (which *is* the intended design, per the parked `backlog-next-epic-member-subagent-isolation` Tier-2 item, but the prose never says so). The resume gate says "re-enter the worktree as cwd" but the only tool that does (`EnterWorktree`) is forbidden in worker mode with no named substitute. The whole loop handoff is honor-system prose with no callable seam. → one-line mechanism notes in E4.2 + E2 (do **not** restructure — the "two files contradict each other" framing was refuted).
- **F-29 — `lint --fix` is ~25s and spawns ~388 `git log` subprocesses/run** (`index-render.mjs` calls `gitLastCommitDate(f.path)` per shipped file *before* the `.slice(0,10)`, twice per run). Pure waste that tempts pipe/background masking. → one batched `git log --name-only` call.
- **F-30 — midnight clock-crossing** makes the committed `BACKLOG.md` date drift from a fresh regen → postflight `[index-matches]` fails. → stamp `closed: <today>` at ship time in both ship steps.
- **F-31 — `node --test <dir>` fails on Node 24** (only the glob form runs suites); no copy-pasteable test command in either SKILL.md; render tests shell out to real git (`fatal: Invalid path '/dummy'` spew, non-hermetic). → document the glob invocation + make render tests hermetic.
- **F-32 — E1 Rule-11 guard is prose-only**; the model hand-rolled a frontmatter `grep`. Note: the E0 preflight does **not** already cover this (at promotion time only 0-or-1 epics are active), so the pre-promotion guard is load-bearing — just give it a command.

## Full confirmed list (id → severity)

| id | sev | skill |
|----|-----|-------|
| detect-deploy-fanout-and-empty-services | **high** | detect-deploy-needed.mjs + E6 |
| auto-close-self-merge-on-ambiguous-go (F-33) | **high** | E5/E8.1 (--auto merge ownership) |
| unbounded-auto-context-no-checkpoint | med | E4/E4.5 |
| auto-floor-overbroad-and-prose-only | med | E5 |
| auto-resolve-before-blast-radius-known | med | E5 case 3 |
| runstate-handwritten-json-no-write-convention | med | E3 |
| runstate-schema-drift-split-decisions | med | E3/E5/E8 |
| lint-crashes-on-nonstring-or-duplicate-key-frontmatter | med | backlog-lint lib |
| ship-fill-existing-validation-gate-stub | med | 6.5 / E7.4 |
| e6-cross-member-type-break-no-cumulative-tsc | med | epic-member 6.4 / E6 |
| e8-merge-manual-not-via-finishing-branch | med | E8.1 |
| e8-postflight-cwd-deleted-worktree | med | E8.2/E8.3 + postflight.mjs |
| lint-fix-slow-and-o-shipped-files | med | index-render.mjs |
| detect-doc-derivation-always-true-on-resume | med | 6.1 / detect-doc-derivation.mjs |
| orchestrator-cannot-invoke-backlog-next | low | E4.2 |
| floor-pause-via-prose-not-askuserquestion | low | E5/E8.1 |
| runstate-path-cwd-relative-git-common-dir | low | resume/E3/E8 |
| runstate-frontmatter-drift-on-member-reopen | low | E3 vs E6.2/E7.2 |
| epic-members-regex-parser-mis-parses-frontmatter | low | epic-members.mjs |
| epic-members-crash-on-missing-status | low | epic-members.mjs |
| epic-members-rolls-own-parser-4th-fork | low | epic-members.mjs |
| e6-scoping-false-green-and-split-sha | low | E6 |
| e8-conflict-resolution-scoped-only-to-backlog-md | low | E8.1 |
| worktree-cwd-mechanism-undefined-and-contradicted | low | E2/Resume + worker |
| orchestrator-worker-loop-no-callable-seam | low | seam |
| worker-floor-and-design-gate-not-self-contained | low | worker / E5 |
| midnight-clock-crossing-index-date-drift | low | 6.6 / index-render.mjs |
| backlog-add-nonstring-notes-no-write-validation | low | backlog-add |
| detect-doc-derivation-no-main-guard-untestable | low | detect-doc-derivation.mjs |
| node-test-dir-form-fails-no-documented-command | low | all test dirs |
| auto-debug-budget-magic-number | low | E4.3 |
| e4-rule11-guard-no-command-improvised-grep | low | E1 |
| e4.5-checkpoint-scope-ambiguous-pre-e6 | low | E4.5 |

## Refuted / dropped (11 — for trust)

Execution-fluke (not skill defects): masked-exit-code via piped commands; `paused_at`/`e8` resume jump; parallel-Bash "hides exit code"; self-authored+self-reviewed plan. Already-mitigated: postflight `validation_gate` regex; run-state-vs-frontmatter prose-only; skill-edited-on-main conflict; E1 "already-drainable must run E6"; Step-6.4 e2e-block "mental bisect"; E7.1 captured-audit `| tail` truncation. By-design: Tier-2 subagent isolation parked-not-queued.

## Recommended remediation order

1. **Cluster 1** (lint library total + located + unify parsers) — fixes 6, removes the opaque mid-`--auto` crash class.
2. **F-1** (detect-deploy correctness) — the only HIGH; E6 deploys against the right services.
3. **F-23 + F-11/F-13** (postflight cwd survival + run-state write convention/path) — crash-recovery backbone.
4. **Cluster 3 + F-33** (`--auto` floor decidability + unconditional `/clear` + AskUserQuestion enforcement + **merge-ownership: stop at open PR, never self-merge on a bare "go", define the post-merge resume tail**) — fire-and-forget safety. F-33 is HIGH and the user-reported symptom; pair it with F-22.
5. **F-22 + F-25** (E8 merge ownership + conflict scope) — single-PR close reliability.
6. Remaining low-severity prose/polish edits, batched.
