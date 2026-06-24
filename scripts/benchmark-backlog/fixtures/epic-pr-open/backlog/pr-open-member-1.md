---
id: pr-open-member-1
status: shipped
type: task
epic: epic-pr-open
epic_role: core
notes: "Stub member — already shipped before the PR-open phase, used to exercise the merged-tail-only path."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: "Verified: integration tests green before PR was opened."
---

# pr-open-member-1: Stub shipped member

Pre-shipped core member of the epic-pr-open epic. All member work is done; the epic
is parked at the PR_OPEN_AWAITING_MERGE phase. On resume after merge, only the
post-merge cleanup tail runs — no member loop re-entry.
