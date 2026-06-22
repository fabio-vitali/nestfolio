---
id: auto-decision-discipline-and-merge-ownership
status: shipped
type: tooling
notes: "--auto floor is prose-only + over-broad, and the epic close self-merged the PR on a bare 'go'. Make the floor a decidable scope test surfaced via AskUserQuestion; the close ALWAYS stops at an open PR (cleanup worktree + print PR link), never self-merges."
references: []
out_of_scope:
  - "Run-state write-convention / closed schema / path-format / e2e-freshness mechanics (F-11..F-14) — owned by runstate-write-contract-and-recovery. THIS member only mandates the decision-log be append-only (no in-place reversal edit), not the run-state write/schema contract itself."
  - "The post-merge resume tail mechanics (ff main, delete merged local branch, epic postflight 4-7, drop run-state) + E8.3 postflight cwd-crash + cross-member tsc + e2e false-green + conflict-scope (F-22/F-23/F-21/F-24/F-25) — owned by ship-and-merge-mechanics. THIS member fixes WHO merges (stop-at-open-PR, never self-merge) + the AskUserQuestion floor; ship-and-merge-mechanics owns the resume-and-cleanup plumbing it hands off to."
  - "The orchestrator<->worker callable-seam / subagent-isolation refactor (F-26/F-27/F-28) — owned by backlog-next-epic-member-subagent-isolation. F-8 (worker-mode self-contained floor rule) IS in scope here — it is a decision-discipline rule, not the seam refactor."
  - "detect-deploy-needed.mjs / detect-doc-derivation.mjs gating — deploy-tooling-integrity."
spec: docs/superpowers/specs/2026-06-22-auto-decision-discipline-and-merge-ownership-design.md
plan: docs/superpowers/plans/2026-06-22-auto-decision-discipline-and-merge-ownership.md
topic_memory: []
validation_gate: "Commits cea6caae (detect-fork-blast-radius.mjs code backstop), fa781109 (E5: decidable floor scope test + blast-radius gate + append-only log + AskUserQuestion-mandatory — F-5/F-6/F-7), a3ed2526 (E8: epic close ALWAYS stops at open PR, never self-merge, e8: PR_OPEN_AWAITING_MERGE marker + resume tail — F-33), 2de6491b (worker self-contained floor — F-8). 3/3 node --test on detect-fork-blast-radius; CLI exit-code 0/1 mapping confirmed (nonexistent symbol → 0, shared-surface hit → 1). Done-when grep checklist across both skills all green: AskUserQuestion-mandatory floor (1), zero 'auto-pick Option 2' remaining (0), blast-radius gate wired (1), append-only log (4), worker floor (1), e8 marker (6); branch-delete appears only in the post-merge tail (1x). lint green (340 files, 11 rules). Tier-0: no deploy, no nx-affected, no doc-derivation."
epic: backlog-skills-hardening
epic_role: core
---

# --auto decision discipline + merge ownership

Audit findings F-33 (HIGH, user-reported + verified), F-5, F-6, F-7, F-8.
See `docs/reviews/2026-06-22-backlog-skills-audit.md` § Cluster 3.

## Root cause

The only thing between `--auto` and scope-creep / irreversible action is soft and judgment-heavy:

- **F-5** — E5 hard floor is over-broad (the "large downstream blast radius" clause swallows every
  fork) AND prose-only (unenforced). Both `--auto` pauses in the run had a clear `(Recommended)`
  option yet invoked the floor.
- **F-6** — case-3 auto-resolved a contract fork *before* its cross-domain blast radius was known,
  then silently reversed it via an in-place run-state log edit (the wrong call vanished from the PR
  trail).
- **F-7 / F-33** — the close surfaced as **prose, not AskUserQuestion** (zero AskUserQuestion calls
  in the whole run); the agent then read the user's one-word `go` as merge authorization and
  **self-merged via `gh pr merge`** (line 512) — though it had itself stated "the merge to main is
  left to the user" (line 457).
- **F-8** — worker epic-member mode carries no self-contained floor/design-pause rule; it
  forward-references the orchestrator's E5 in another file.

## Fix pattern

1. **Decidable scope test.** Replace E5's "no defensible recommended option" bullet: pause ONLY when
   the fork (a) changes the epic's `out_of_scope:` boundary, (b) alters a contract/event/interface
   consumed by a not-yet-worked core member, or (c) forces rework of a shipped member.
2. **Blast-radius before auto-resolve.** Gate E5 case-3 on a grep of shared/exported surfaces
   (event contract, schema field, CDK API, flow spec, shared-lib export) before committing the choice.
3. **AskUserQuestion is mandatory at the floor** — a free-text "this is your call" prose pause is a
   skill violation; the floor surface MUST be an AskUserQuestion widget with a `(Recommended)` option.
4. **Merge ownership (user-confirmed 2026-06-22) — the epic close ALWAYS, in `--auto` AND interactive:**
   - resolve the `docs/BACKLOG.md` / epic-file conflict on the branch *in the worktree* so the PR is
     mergeable, and push;
   - pause via **AskUserQuestion** (structured, `(Recommended)`); a bare "go" is never self-merge
     authorization;
   - on confirmation **clean up the worktree** — `worktree remove --force` + `worktree prune` ONLY,
     **keeping the local+remote branch** so the PR stays mergeable (NO `git branch -d`, NO remote
     delete);
   - **print the GitHub PR link** and hand off;
   - **STOP — the agent NEVER runs `gh pr merge`.** The merge is the user's.
   - keep run-state as `e8: PR_OPEN_AWAITING_MERGE`; the post-merge tail (ff `main`, delete the
     merged local branch, epic postflight checks 4-7, drop run-state) runs on a later
     `/backlog-next-epic <id>` resume that detects the PR merged. (Ordering/cleanup mechanics are
     shared with `ship-and-merge-mechanics`.)
5. **Worker floor self-containment** — give worker epic-member mode a one-line floor/design rule so a
   worker-phase prompt isn't self-resolved when E5 isn't in view.

## Done when

A floor decision can only be resolved via AskUserQuestion; `--auto` never self-merges an epic PR (it
stops at an open PR with the worktree cleaned and the link printed); a contract fork is blast-radius-
scoped before auto-resolution; the decision log is append-only (no in-place reversal edits).
