---
id: tier2-epic-orchestrator-hardening
status: dropped
closed: 2026-06-23
type: epic
notes: "Residual hardening of the `/backlog-next-epic` Tier-2 subagent-isolation orchestrator harness, surfaced after the subagent-isolation program + first live --auto dry-run shipped. Theme epic, 4 members."
done_when: "Each residual Tier-2 `/backlog-next-epic` orchestrator-harness hardening item is shipped or dropped: the unattended-run irreversible-action floor is a mechanical deny-hook, the dormant Tier-1 `/clear` fallback is removed (after its 3-epic soak), the cwd/payload-format invariants are explicit in the orchestrator prose, and the worktree setup symlinks per-package node_modules. All members shipped or dropped."
scope: "Residual hardening of the `/backlog-next-epic` Tier-2 subagent-isolation orchestrator harness left after the subagent-isolation program (and its first live --auto dry-run) shipped: the unattended-floor deny-hook, the dormant Tier-1 `/clear` fallback removal, the implicit cwd/payload-format invariants, and the worktree per-package node_modules symlink gap."
out_of_scope:
  - "The shipped Tier-2 machinery itself (subagent dispatch, run-state recovery, orchestrator-worker seam) — these are post-ship hardening leftovers, not the core mechanism"
  - "General worktree-deploy friction unrelated to backlog-next(-epic) setup (user-memory worktree-deploy-friction)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Tier-2 epic-orchestrator hardening

> **DROPPED 2026-06-23 — Tier-2 reverted to Tier-1.** The `/backlog-next-epic` subagent-isolation
> refactor this epic existed to harden was reverted. The first live run on a real member
> (`epic-member-floor-deny-hook`) showed the member worker had lost `AskUserQuestion` + live
> visibility (decisions became slow `SendMessage` round-trips), and — fatally — a worker-spawned
> sub-agent's output leaked back into the orchestrator's context anyway (~118k tokens), so the
> isolation's whole reason to exist failed on exactly the non-trivial members it was built for; the
> run looped ~250k tokens with zero file changes and was aborted. Members run **inline with full
> powers** again (Tier-1). The 3 Tier-2-specific members are dropped;
> `worktree-missing-per-package-node-modules-symlink` was un-pointed back to standalone parking
> (a general worktree-setup bug that survives the revert).

Root cause (program residue): the `/backlog-next-epic` Tier-2 subagent-isolation program shipped (members `backlog-next-epic-member-subagent-isolation`, `backlog-next-epic-orchestrator`, `orchestrator-worker-seam-prose`, `runstate-write-contract-and-recovery`, `tier2-live-end-to-end-dry-run`) but left a tail of hardening items the core machinery doesn't need to function yet would need before unattended use or fallback removal. They share the trigger ("surfaced hardening the Tier-2 orchestrator") and the harness they touch, so one focused `/backlog-next-epic`-hardening pass drains them together. Honest caveat — the fixes differ per member (a deny-hook vs prose vs a symlink loop); what binds them is the Tier-2 harness as the subject and the post-ship-hardening trigger.

Members (derived from `epic:` pointers):
- `epic-member-floor-deny-hook` (mechanical `permissions.deny` / `PreToolUse` deny-hook so the irreversible-action floor is a true gate for unattended `--auto` runs — spike proved a dispatched subagent runs destructive Bash unprompted)
- `remove-tier1-clear-fallback` (delete the dormant Tier-1 `/clear` fallback once 3 successful Tier-2 epics have soaked the new mechanism)
- `tier2-orchestrator-prose-cwd-payload-invariants` (make the verbatim-fenced payload relay, worktree-not-`main` roster/postflight cwd, and HEAD-relative-from-worktree invariants explicit in the orchestrator prose)
- `worktree-missing-per-package-node-modules-symlink` (worktree setup symlinks only root node_modules, not per-package libs/*/node_modules → false-red affected test/lint for event-processor/agent-orchestrator/cdk-constructs)
