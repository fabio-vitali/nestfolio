---
id: advisory-status-recompute-monotonic-version
status: active
rank: 11
type: refactor
out_of_scope:
  - "No change to dashboard-bff's advisory-status.ts P3 transform beyond confirming it stays correct under a monotonic counter __version (the carried version is consumed as-is; a counter is automatically monotonic)."
  - "No change to the inFlightCount recompute logic itself (countInFlightDecisions / the non-terminal DecisionReadModel count is correct)."
  - "No backfill/migration of existing AdvisoryStatus rows — the same-ms collision is benign and self-heals; the first new write seeds/continues the counter."
  - "No re-attempt of the stream SequenceNumber approach (known dead end, code comment explains why)."
  - "No application of any new reusable intent helper to other P3/derived aggregates in this workstream — generalisation beyond AdvisoryStatus is a separate promote-on-second-use-case item."
notes: "advisory-bff advisory-status-projector recompute versions the AdvisoryStatus P3 row with Date.now(). Two recomputes for the same tenant in the same millisecond produce equal versions and the `#__version < :version` guard drops the fresher count. Benign today (the next DecisionReadModel change re-triggers the recompute; 1ms-apart counts are near-identical). The C1 attempt to fix this with max stream SequenceNumber was WRONG and reverted (2026-06-03, dashboard-advisory-readmodel-fixes): DecisionReadModel rows are keyed Decision#<tenant>#<id> (per-decision pk) so a tenant's decisions span DIFFERENT stream shards whose SequenceNumbers are non-comparable — max() is non-monotonic and the recompute never wrote (caught by the advisory-bff integration recompute test). A correct strictly-monotonic version needs a different mechanism (e.g. an atomic self-increment ADD #__version :1 on the AdvisoryStatus row, which changes the write from projectVersioned-with-external-version to a command-owned-style self-increment, and must keep dashboard-bff's P3 projection keyed on the carried __version monotonic)."
references:
  - services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts
topic_memory: [project_read_model_redesign.md]
spec: null
plan: null
validation_gate: null
---

# AdvisoryStatus recompute: strictly-monotonic version (correct C1 fix)

The `Date.now()` version on the AdvisoryStatus P3 recompute has a benign same-ms
collision footgun (see notes). The SequenceNumber approach is a known dead end —
do not re-attempt it (the projector carries a code comment explaining why).

A correct fix would make the per-tenant AdvisoryStatus version strictly monotonic
regardless of which DecisionReadModel shards triggered the batch — most likely an
atomic `ADD #__version :1` self-increment, reconciled with the read-model model
(AdvisoryStatus is advisory-bff's own aggregate; dashboard-bff projects it P3
keyed on the carried `__version`, which must stay monotonic).

In QUEUED as the lowest-urgency read-model residual: in-scope for the program's
"drain QUEUED = the model is fully correct" framing, but the live footgun is
benign (rare same-ms collision that self-heals on the next DecisionReadModel
change). Opens with a small design decision on the self-increment vs the carried
P3 `__version` contract.
