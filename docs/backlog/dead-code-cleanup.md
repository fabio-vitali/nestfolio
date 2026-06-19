---
id: dead-code-cleanup
status: parking
type: epic
notes: "Vestigial code left behind by prior refactors that no checker flags — unread wrappers, unused repo methods, stale comments, a dead consumer read. Debt-class theme epic, 4 members."
done_when: "Each piece of vestigial code in scope is deleted after a zero-caller/zero-reader verification; all members shipped or dropped."
scope: "Dead/vestigial code surviving a refactor: unread wrappers, unused repository methods, stale comments referencing removed APIs, and consumer reads of fields the producer never emits."
out_of_scope:
  - "Live code with a latent type error (typecheck-diagnostics-masking) — masked-but-reachable, not dead"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Dead-code cleanup

Root cause (debt class): refactors left vestigial code that no checker flags. Honest caveat — the *code* differs per member; what they share is the cleanup action and the 'left behind by a refactor' trigger, so this is a debt-class cluster, not one literal root cause. Fix pattern: verify zero callers/readers (grep), then delete.

Members (derived from `epic:` pointers):
- `an-ctrl-wrap-agent-output-vestigial` (wrapAgentOutput unread after the callback refactor)
- `execution-ctrl-orderrepository-prune-unused-methods` (createOrder/createStagedOrder unused after the OrderLifecycleService delete)
- `stale-memory-write-comments-phase-a-cleanup` (6 comments referencing removed Memory APIs)
- `yahoo-finance-mi-ctrl-subject-region-dead-code` (MI-ctrl reads subject.region the producer never emits)
