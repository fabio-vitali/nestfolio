---
id: publish-decision-update-omits-null-fields
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Latent — IAM-published mid-cycle frame would erase confirmedAt/rejectedAt fields."
---

# `publishDecisionUpdate` omits decision-detail null fields

`PUBLISH_DECISION_UPDATE` in `services/advisory/advisory-bff/src/handlers/decision-publisher.ts` sets only {decisionId, tenantId, status, trigger, explanation, proposedTrades, version, createdAt, updatedAt}. `confirmedAt`/`rejectedAt`/`rejectionReason`/`confirmationRequired` arrive as null at decision-detail's `onDecisionUpdate` handler, which calls `store.setDecision(updated)` (replace, not merge — `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:380`). Latent: any IAM-published mid-cycle frame would erase those fields. Currently masked because `confirmDecision`/`rejectDecision` re-broadcast via DDB readback. Surfaced 2026-05-02 during decision-list Pattern B workstream.
