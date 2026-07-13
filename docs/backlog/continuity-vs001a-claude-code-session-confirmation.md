---
id: continuity-vs001a-claude-code-session-confirmation
status: active
type: implementation
notes: "Corrective validation slice authorized by continuity-lab VS-001A. Closes the VS-001 executor-provenance evidence gap (acceptance criteria 4, 7, 8) with two genuine Claude Code Sessions driven by project-local SessionStart/SessionEnd hooks; no architecture expansion, no rerun of run-vs001."
references:
  - runtime/continuity/README.md
out_of_scope:
  - "Changing Continuity Core semantics, architecture boundaries, or the accepted VS-001 slice."
  - "Rerunning or rewriting run-vs001."
  - "Migrating another feature family, PX-001, MA-001, broader implementation, product-experience design, external writes, parallel orchestration, multi-executor parity, and automatic Lesson or Guard promotion."
spec: null
plan: null
topic_memory: []
validation_gate: null
closed: null
---

# VS-001A — Interactive Claude Code Session Confirmation

Corrective validation slice for the VS-001 FAIL verdict (criteria 4, 7, 8): the accepted VS-001
implementation is exercised by **two genuine Claude Code Sessions** whose provenance is recorded by
project-local `SessionStart`/`SessionEnd` hooks, without changing Continuity Core semantics.

Fixed identities:

```text
Work Item    continuity-vs001a-claude-code-session-confirmation
Working Set  ws-continuity-vs001a
Run          run-vs001a
Session 1    session-vs001a-1   (genuine Claude Code startup, adapter start view)
Session 2    session-vs001a-2   (distinct genuine Claude Code startup, adapter resume view)
Effect key   vs001a-material-effect → continuity/dogfood/vs001a-effect.txt
```

Session 1 executes the keyed effect, checkpoints with the exact next action, and interrupts to
publish the Handoff; ending Claude Code records the termination. Session 2 is a separately invoked
fresh Claude Code process that resumes from repository-local state (never a Claude transcript),
replays the effect key to prove `deduplicated: true`, then validates and completes.

Executor provenance is recorded under `.continuity/executor-sessions/` and proven by
`runtime/continuity/tools/validate-vs001a-executor-provenance.mjs`, wired as deterministic
completion criteria in the VS-001A Nestfolio binding.

The canonical design and acceptance contract remain in `continuity-lab`
(`sessions/VS-001A-claude-code-session-confirmation/context-pack.yaml`). Required Nestfolio baseline:
`34f7c86d0bea256f2fbe8c0c63ca2b04f924f62f` or an exact descendant.
