# `--auto` decision discipline + merge ownership

**Date:** 2026-06-22
**Backlog item:** `auto-decision-discipline-and-merge-ownership` (core member #2 of `backlog-skills-hardening`, worked standalone as a bootstrap fix)
**Audit source:** `docs/reviews/2026-06-22-backlog-skills-audit.md` § Cluster 3 (F-33 HIGH, F-5, F-6, F-7, F-8)

## Problem

The only thing between `--auto` and scope-creep / irreversible action is soft, judgment-heavy, and prose-only:

- **F-33 (HIGH, user-reported)** — the epic close printed a *prose* "PR up for merge", then read the user's one-word `go` as merge authorization and **self-merged via `gh pr merge`** — despite the agent itself stating "the merge to main is left to the user".
- **F-7** — that close pause was free-text, not the mandated AskUserQuestion (zero AskUserQuestion calls in the whole run).
- **F-5** — E5's hard floor is over-broad (the "large downstream blast radius" clause swallows every fork) AND prose-only; the code-level backstop the reviewer asked for was punted.
- **F-6** — case-3 auto-resolved a contract fork *before* its blast radius was known, then silently reversed it via an in-place run-state log edit (the wrong call vanished from the PR trail).
- **F-8** — worker epic-member mode carries no self-contained floor/design rule; it forward-references the orchestrator's E5 in another file.

## Scope boundary

All changes target the **epic orchestrator** (`.claude/skills/backlog-next-epic/SKILL.md` E5/E8 + a new helper script) and the **worker's epic-member floor** (`.claude/skills/backlog-next/SKILL.md`). The standalone `/backlog-next` 6.7 finishing menu — where a *user-selected* local merge is legitimate (e.g. member #1's close) — is **not** touched. F-33 is specifically the *epic* close self-merging on a bare "go".

Verified pipeline facts (2026-06-22, against `backlog-next-epic/SKILL.md`):
- **E5 line 114** auto-picks finishing Option 2 ("Push + create PR") — the F-33 root.
- **E5 line 115** (case-3) auto-resolves in-member forks with no blast-radius gate and an editable log.
- **E5 line 120** floor clause "No defensible recommended option — … large downstream blast radius" (F-5).
- **E5 line 123** floor surfaces via AskUserQuestion (already says so) but is undermined by line 114's auto-pick.
- **E8 lines 161–179** handle the PR + cleanup; line 163 forbids manual merge but never owns the actual merge step.
- Shared-surface paths confirmed present: `libs/event-types/src`, `flows/*.flow.yaml`, `libs/*/src/index.ts` (agent-orchestrator, event-processor, event-types, integration-testing), `libs/cdk-constructs/src`.

## Design

### 1. New script `detect-fork-blast-radius.mjs` (`.claude/skills/backlog-next-epic/`)

(Decision 2026-06-22: a **script + curated surface manifest**, not prose — gives F-5's punted code-level backstop a real, reusable, testable mechanism.)

`node detect-fork-blast-radius.mjs <pattern> [<pattern>…]` — patterns are the fork's subject symbols (an event name, a schema field, a shared-lib export, a construct prop).

```js
// Curated manifest of shared / exported surfaces. Globs that match nothing are skipped,
// so the script is resilient to repo layout drift.
const SHARED_SURFACES = [
  'libs/event-types/src/**/*.ts',   // event contracts / names
  'libs/*/src/index.ts',            // shared-lib public exports
  'flows/*.flow.yaml',              // cross-domain flow specs
  'libs/cdk-constructs/src/**/*.ts',// CDK construct public APIs
];
```

- **Pure core** `scanSurfaces(patterns, fileEntries) -> hits[]` where `fileEntries = [{path, content}]` and each hit is `{path, line, pattern, text}`. This is the unit-tested seam — no fs, no git.
- **CLI wrapper** resolves `SHARED_SURFACES` to real files (from repo root via `git rev-parse --show-toplevel` + glob), reads them, calls `scanSurfaces`, prints hits.
- **Exit code:** `0` when no hit (safe to auto-resolve), `1` when ≥1 hit (escalate to the floor). `import.meta.main`-guarded so importing the module for tests does not run the CLI.

### 2. E5 rewrite — decision handling

- **Case 2 (line 114, F-33 root):** replace "auto-pick Option 2 (Push + create PR)" with:
  > **`finishing-a-development-branch` menu (E8) → the close is governed by E8's merge-ownership rule.** In `--auto`, answer the menu by taking the PR route (push + create PR), then **STOP via AskUserQuestion** for the user to merge. `--auto` **never** self-merges — see E8.
- **Case 3 (line 115, F-6):** before auto-resolving a non-design in-member fork, run `node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs <fork-subject>`. **Exit 1 (shared-surface hit) → escalate to the floor** (AskUserQuestion); exit 0 → auto-resolve by the `(Recommended)` = most-reusable option. **Append** the outcome to the decision log — the log is **append-only**: a later reversal is a NEW entry that references the prior one by index, **never** an in-place edit or delete (so the original call stays visible in the PR trail).
- **Floor — decidable scope test (line 120, F-5):** replace the "No defensible recommended option / large downstream blast radius" bullet with:
  > **Scope-boundary fork** — pause ONLY when the fork (a) changes the epic's `out_of_scope:` boundary, (b) alters a contract / event / interface / shared-lib export consumed by a not-yet-worked core member (as reported by `detect-fork-blast-radius.mjs` exit 1), or (c) forces rework of an already-shipped member. (A genuinely balanced fork where reusability does not break the tie also still pauses.)
- **Floor surface mandatory (line 123, F-7):** strengthen to:
  > The floor surface MUST be an **AskUserQuestion** widget with a `(Recommended)` option. A free-text "this is your call" prose pause is a **skill violation** — it is what let an ambiguous "go" collapse into a self-merge (F-33).

### 3. E8 rewrite — merge ownership (F-33 user-confirmed target, 2026-06-22)

The epic close MUST, in **both** `--auto` and interactive:

1. Resolve the `docs/BACKLOG.md` / epic-file conflict **mechanically on the branch** (take branch side, re-run `lint.mjs --fix`) and **push**, so the PR is mergeable.
2. **Pause via AskUserQuestion** (structured, with a `(Recommended)` option). This is the *handoff confirmation*, not a merge prompt — **no option runs `gh pr merge`**. The `(Recommended)` option is "PR #N is up at `<link>` — I'll review & merge it on GitHub myself; agent stops here"; other options cover "keep iterating / inspect first". Its purpose is to replace the ambiguous prose stop (F-7) so a bare "go" can never collapse into a self-merge. A bare "go" / prose stop is **never** merge authorization.
3. On confirmation, **clean up the worktree** — `git worktree remove --force` + `git worktree prune` **ONLY**, **keeping the local + remote branch** so the PR stays mergeable. **No `git branch -d`, no remote-branch delete.**
4. **Print the GitHub PR link** and hand off.
5. **STOP — the agent NEVER runs `gh pr merge`.** The merge is the user's, on GitHub.

Run-state keeps `e8: PR_OPEN_AWAITING_MERGE`. The **post-merge tail** runs on a later `/backlog-next-epic <id>` resume that detects the PR merged (`gh pr view <n> --json state -q .state == "MERGED"`): fast-forward local `main`, delete the now-merged local branch, run epic postflight checks 4–7, drop the run-state file. The **resume gate** (SKILL.md "Resume gate" section) gains a branch: run-state `e8 == PR_OPEN_AWAITING_MERGE` → if PR merged, run the tail only; if still open, re-print the link and STOP (still the user's merge).

### 4. Boundary handoffs (out of scope — sibling members)

- This member **defines** `e8: PR_OPEN_AWAITING_MERGE` as the single sanctioned `e8` run-state value and documents it in E3/E8, and writes a **working** post-merge tail. The **closed run-state schema** that formalizes the `e8` field + the structured write-convention is `runstate-write-contract-and-recovery` (#3).
- The post-merge-tail **robustness** — `postflight.mjs` surviving a removed cwd (E8.3 crash), conflict-scope generalization beyond `docs/BACKLOG.md` — is `ship-and-merge-mechanics` (#4). This member writes the behavior; #4 hardens the plumbing.

### 5. F-8 — worker floor self-containment (`.claude/skills/backlog-next/SKILL.md`)

Add a self-contained bullet to the "Epic-member mode" section (after the Step 5 bullet, line ~173) so a worker-phase prompt is never self-resolved when E5 is not in view:

> - **Floor (self-contained).** In `--auto` epic-member mode, a `type: design` brainstorming approval gate and any irreversible / outward-facing action (staging/prod ops, real-money/broker actions, `git push --force`, `git branch -D`, destructive deletes, anything outside `dev-*`) are **NEVER** auto-resolved — pause via **AskUserQuestion** and surface to the orchestrator. (Mirrors orchestrator E5; restated here so the worker does not need E5 in view — F-8.)

### 6. Testing

- `detect-fork-blast-radius.mjs` → hermetic unit test (`test/detect-fork-blast-radius.test.mjs`): `scanSurfaces` over in-memory `fileEntries` where a known symbol appears in a surface-path entry AND a non-surface entry → only the surface hit is reported; empty patterns / no hits → `[]`. (CLI exit-code behavior is covered by asserting the hit-count → exit-code mapping in a small wrapper test.)
- The SKILL.md prose changes (E5, E8, resume gate, worker floor) are validated by a **self-consistency review against the Done-when checklist** — prose is not unit-testable. The review confirms: no remaining "auto-pick Option 2"/self-merge language; the floor reads as a 3-clause decidable test; every floor/close pause says AskUserQuestion; the decision-log append-only rule is stated; the worker floor bullet exists.

## Out of scope

- Run-state write-convention / closed schema / path-format / e2e-freshness (F-11..F-14) — `runstate-write-contract-and-recovery` (#3). This member only mandates the decision-log be append-only, and defines the `e8` marker for #3 to formalize.
- Post-merge-tail robustness (postflight cwd-survival, conflict scope, cross-member tsc, e2e false-green) (F-22/F-23/F-21/F-24/F-25) — `ship-and-merge-mechanics` (#4).
- Orchestrator↔worker callable-seam / subagent-isolation refactor (F-26/F-27/F-28) — `backlog-next-epic-member-subagent-isolation` (#5). (F-8 worker floor IS in scope here.)
- `detect-deploy-needed.mjs` / `detect-doc-derivation.mjs` gating — `deploy-tooling-integrity`.
- The standalone `/backlog-next` 6.7 finishing menu — unchanged; F-33 is the epic close only.

## Done when

A floor decision can only be resolved via AskUserQuestion (a prose pause is a stated skill violation); `--auto` never self-merges an epic PR (the close always stops at an open PR with the worktree cleaned, the branch kept, and the link printed); a non-design contract fork is blast-radius-scoped via `detect-fork-blast-radius.mjs` before auto-resolution; the decision log is append-only (no in-place reversal); the worker epic-member mode carries a self-contained floor rule; `detect-fork-blast-radius.mjs` has a hermetic regression test.
