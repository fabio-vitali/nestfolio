---
id: epic-member-floor-deny-hook
status: dropped
closed: 2026-06-23
type: tooling
notes: "The Tier-2 design (2026-06-23-backlog-next-epic-member-subagent-isolation-design.md §D) names this a HARD precondition before any UNATTENDED (GitHub-runner) use of /backlog-next-epic --auto. The harness spike proved a dispatched subagent runs destructive Bash UNPROMPTED — so default permission-prompting is NOT a floor backstop. Today the floor's gates are the blast-radius helper + the worker's irreversible-action checklist + AskUserQuestion-exclusion (sufficient for ATTENDED dev --auto, where a human is present for floor pauses). Promote before wiring /backlog-next-epic --auto onto an unattended runner."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: tier2-epic-orchestrator-hardening
epic_role: core
---

# `permissions.deny` / `PreToolUse` deny-hook for the epic-member floor

Install a `settings.json` `permissions.deny` and/or a `PreToolUse` deny-hook covering the irreversible-action set so the floor is a TRUE **mechanical** gate (not prose the worker is asked to honor), for use when `/backlog-next-epic --auto` runs unattended:

- `git push --force`, `git branch -D`, `git reset --hard` on a shared branch
- destructive deletes, anything outside this repo
- real-money / broker actions, staging/prod-account ops, mutations outside `dev-*` naming

Rationale (spike evidence): a dispatched subagent executed `git branch -D <nonexistent>` and `rm -rf <nonexistent>` with **no prompt, no block** — harmless no-ops, but a *real* destructive command would have run. The worker's irreversible-action checklist + `AskUserQuestion`-exclusion bound the attended case; an unattended runner has no human at the floor pause, so it needs the deny-hook as the mechanical backstop. See the spec §D + `2026-06-23-tier2-harness-spike.md` item 8.
