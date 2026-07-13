---
id: continuity-vs001-resumable-agent-work-session
status: shipped
type: implementation
notes: "Authorized architecture-validation slice from continuity-lab TA-002. Proves one bounded resumable Claude Code-oriented agent work session; not a broad runtime migration."
references:
  - runtime/continuity/README.md
out_of_scope:
  - "Broad migration or replacement of the current runtime/ feature families."
  - "Unrelated Nestfolio product work, external writes, parallel fan-out, full Epic orchestration, deploy/release, hosted collaboration, multi-executor parity, and automatic Lesson or Guard promotion."
spec: null
plan: null
topic_memory: []
validation_gate: "Continuity VS-001 Run run-vs001: all required criteria passed with criterion-linked Evidence; final Checkpoint run-vs001-final-2."
closed: 2026-07-13
---

# VS-001 — Resumable Agent Work Session

Implement and dogfood the minimum Continuity path:

```text
select work → Working Set → Scope/context/Packs/Guards/Decisions
→ Claude Code adapter Run → keyed effect → verified Checkpoint
→ interrupted Session → fresh Session resume → no duplicate effect
→ validation + Evidence → Work completion → candidate Lesson
```

The canonical design and acceptance contract remain in the separate `continuity-lab` repository. This Nestfolio item owns only the bounded implementation, tests, project binding, and dogfood evidence.
