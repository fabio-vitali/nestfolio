# backlog-next — LESSONS (pitfalls log)

The *why* behind the non-obvious guardrails in `SKILL.md`. The procedure keeps a terse, load-bearing
guardrail inline at the step that needs it; the multi-sentence backstory explaining *why* it must be
done that way lives here, referenced from the step by tag (e.g. "see LESSONS F-30"). Entries are keyed
by F-number so the PR-review trail stays intact. **This file changes no behavior** — moving a lesson
here never removes the inline warning at its step.

`backlog-next-epic/LESSONS.md` cross-references **F-23** and **F-30** here rather than re-narrating
them — these two lessons are shared across both skills and this is their canonical home.

---

## F-2 — epic-member doc-derivation base must be member-start HEAD, not `origin/main`

**Guardrail (SKILL.md Step 6.1, epic-member mode):** pass `--base=<member-start-HEAD>` to
`detect-doc-derivation.mjs`.

**Why.** Diffing the cumulative epic branch against the default `origin/main` always reports
`derivation=true` while *any earlier* member's source differs — even when that earlier member already
regenerated and committed its derived docs. That false "always-true-on-resume" signal would re-run
`generate-c4-diagrams` / `audit-service` / `validate-flow` on every resume. Pinning the base to the
member-start HEAD (the tip of all prior members' work, captured before this member's adoption commit)
makes the detector report only THIS member's source delta. Standalone/non-epic runs keep the default
`origin/main` base — there is no prior member, so the cumulative diff IS the member delta.

## F-8 — the epic-member floor is restated in the worker, self-contained

**Guardrail (SKILL.md "Floor (self-contained)"):** in `--auto` epic-member mode, a `type: design`
brainstorming approval gate and any irreversible/outward-facing action are NEVER auto-resolved — pause
via AskUserQuestion.

**Why.** This mirrors the orchestrator's E5 hard floor. It is restated inside the worker so the worker
does not need the orchestrator's E5 in view to behave correctly — the floor travels with the procedure
that can trip it.

## F-23 — postflight must run from `$MAIN`, not the removed worktree (shared with backlog-next-epic)

**Guardrail (SKILL.md Step 7):** `cd "$MAIN"` before invoking `postflight.mjs`.

**Why.** Step 6.8 (complex lane) just `git worktree remove`d the worktree, which may be the agent's
pinned cwd. Running postflight from that removed directory would fail to start at all. `$MAIN` is a
guaranteed-live dir (resolved via the git-common-dir parent); started there, postflight's `REPO_ROOT`
also resolves from the git-common-dir parent and survives the removed worktree. The epic-level
post-merge tail (`backlog-next-epic` E8.4) hits the same hazard and applies the same fix.

## F-30 — always stamp `closed: <today>` at ship (shared with backlog-next-epic)

**Guardrail (SKILL.md Step 6.5):** edit `docs/backlog/<id>.md` → fill `closed: <today>` at ship time.

**Why.** The shipped item's "Recently Shipped" date is derived in `index-render.mjs` as
`closed: ?? (dirty → today) ?? git-last-commit-date`. The explicit `closed:` stamp is the authoritative
date and the only one immune to an across-midnight drift: a `dirty → today` write could disagree with a
later `git-commit-date` regen and trip postflight `[index-matches]`. The `dirty → today` and git-date
fallbacks remain only for items shipped without `closed:` and for pre-F-30 history (no backfill needed).
Set `closed:` to a date other than today only when backfilling.

---

## Phantom worktree session (SKILL.md Step 4.1 self-heal)

**Guardrail (SKILL.md Step 4.1):** if `EnterWorktree` errors `Already in a worktree session`, confirm
disk is clean (on `main`, `git status --short` empty, `git worktree list` shows no unexpected entry),
`git worktree prune` if a stale registration shows, then `ExitWorktree action: "keep"` to clear the
dead flag, then retry `EnterWorktree`. Only stop and ask the user if there is genuine uncommitted work
in a real leftover worktree.

**Why.** A prior session left its worktree session flag set: Step 6.8 git-removed the worktree on disk
but `ExitWorktree` could not clear the harness flag from a cwd-pinned session, so the harness still
thinks it is inside a worktree that has since been removed from disk. Preflight cannot catch this —
Node can't see harness session state, and the phantom case leaves no disk artifact. `ExitWorktree
action: "keep"` works HERE (unlike Step 6.8) precisely because the phantom worktree is already gone
from disk: there is no live worktree cwd for it to mutate (the cwd has already recovered to `main`), and
`keep` never deletes so real work is never lost. This phantom is almost always the residue of a prior
run that could not `ExitWorktree`; Step 6.8's git cleanup is what prevents it. A root fix (auto-reconcile
a removed-on-disk session, or allow `ExitWorktree` from a cwd-pinned session) lives in the harness, not
this repo.

## `ExitWorktree` fails in cwd-pinned sessions — use git cleanup (SKILL.md Step 6.8)

**Guardrail (SKILL.md Step 6.8):** clean up with the git commands from the **main repo root** (worktree
`remove --force` + `branch -d` + `prune`, after the `merge-base --is-ancestor` safety check). Do NOT
call `ExitWorktree` here and do NOT retry it.

**Why.** `finishing-a-development-branch` merges, but for a harness-owned worktree (under
`.claude/worktrees/`) it deliberately leaves the directory on disk and cannot `git branch -d` the
still-checked-out branch — so cleanup lands here. `ExitWorktree` is the nominal tool, but in a
cwd-pinned/isolated session it reliably fails with `cannot be called from a subagent with a cwd
override … use Bash with cd` — and `/backlog-next` sessions are *typically* launched/resumed pinned to
a worktree cwd, so this is the common case, not an edge case. `git worktree remove` must run from the
main root (not inside the worktree being removed, which would fail). This git cleanup is also the
**durable fix for the phantom-session leak cycle** (see above): a worktree left on disk is what the
next session gets launched pinned to. Once removed, the next session's pinned path no longer exists →
its cwd recovers to `main` → Step 4.1's `ExitWorktree action: "keep"` then works. You may optionally
`ExitWorktree action: "keep"` best-effort now to clear the flag; if it errors with the cwd-override
message, ignore it — on-disk state is already correct and Step 7 postflight checks on-disk truth
(worktree gone, branch deleted, `main` synced), not the harness session flag. Root fix lives in the
harness; the git cleanup above is the path — verified end-to-end 2026-06-03.
