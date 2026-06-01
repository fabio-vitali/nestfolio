---
id: w3-advisory-versioned-packet-hardening
status: queued
rank: 10
type: refactor
notes: "3 non-blocking hardening nits from the w3 final review: AdvisoryStatus Date.now() version, terminal taskToken cleanup, WorkflowStatus enum guard."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# w3 advisory versioned-DecisionPacket — hardening follow-ups

Non-blocking nits from the w3 final whole-branch review (verdict: APPROVE-WITH-NITS).
None affect e2e green — all three w3 e2e paths pass on deployed dev. Parking.

1. **AdvisoryStatus P3 version uses `Date.now()`** —
   `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts` stamps
   the AdvisoryStatus row `__version` with `Date.now()`. Two stream records for the
   same tenant in the same millisecond produce an equal version; the projectVersioned
   guard (`#__version < :version`) drops the second. Self-healing because each recompute
   reads the authoritative row set, but a same-ms collision could drop the fresher
   count until the next change. Prefer a strictly-monotonic version (e.g. the DDB
   stream `SequenceNumber`, or `Date.now()*1000 + perBatchIndex`).

2. **`taskToken` retained on terminal rows** — the sfn-callback user-response update
   (`services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts`) sets
   `status: CONFIRMED|REJECTED` but does not `removes:['taskToken']`, so the projected
   `DecisionReadModel` keeps a consumed token. Not exploitable (the SF execution is
   already resolved; a replayed token fails InvalidToken/TaskTimedOut, tolerated by the
   resolver), but it is dead data on a terminal row. Add `removes: ['taskToken']` to the
   terminal user-response update.

3. **`WorkflowStatus` union has unreachable members** —
   `services/advisory/decision-workflow-ctrl/src/domain/models.ts` still includes
   `INITIATED|PROFILING|CONSTRUCTING|NARRATING|PROPOSED|COMPLIANCE_REVIEW|FAILED`. None
   reach the `DecisionReadModel` post-w3 (verified: the SF UpdateStatus* states are
   comment-only Pass states; no write path emits them onto the row), so the non-null
   GraphQL `status: DecisionStatus!` holds by construction — but only incidentally.
   Narrow the union to the 6 enum-valid values, OR add a status-enum guard in
   `decision-snapshot.ts`, to make the contract provable rather than incidental.

See [[project_read_model_redesign]].
