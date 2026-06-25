---
id: eps-epic
status: parking
type: epic
notes: "Higher-severity theme: a data-loss / correctness root cause (events silently dropped on write contention)."
done_when: "The write-contention drop is closed and a regression test proves no event is lost under concurrent writes."
scope: "The eps surface: the conditional-write path that drops events and its regression coverage."
out_of_scope:
  - Broader event-schema redesign.
  - Any real deploy or e2e run — this fixture exists solely for sandbox tests.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Epic: Eps (data-loss correctness theme)

Higher-severity theme epic. Its root cause is a correctness/data-loss defect: events
are silently dropped under concurrent writes. Promotable as-is.
