---
id: dashboard-bff-advisory-status-dead-code-cleanup
status: queued
rank: 13
type: refactor
notes: "w3 left 3 AdvisoryStatus vestiges in dashboard-bff: unused upsertAdvisoryStatus + unwritten lastRecommendationAt/lastDecisionStatus fields."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# dashboard-bff AdvisoryStatus dead-code cleanup (post-w3)

After `bff-readmodel-w3-advisory-decision-packet` replaced the dashboard-bff
`AdvisoryStatus` `accumulate` with a P3 `projectVersioned` projection of advisory-bff's
authoritative announcement, three vestiges remain. None affect e2e green — parking.

1. **`DashboardRepository.upsertAdvisoryStatus` is now unused.** Its sole caller was
   the old accumulate transform path (`transforms/advisory-status.ts`, now rewritten to
   `projectVersioned`). `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts:287`.
   Two repository unit tests still exercise it directly. Remove the method + its tests.

2. **`AdvisoryStatus.lastRecommendationAt` + `lastDecisionStatus` are no longer written
   by any producer.** The P3 full-row projection only carries `pendingDecisionsCount`
   (mapped from advisory-bff's `inFlightCount`). The dashboard GraphQL type
   (`services/investor/dashboard-bff/src/schema.graphql`) + MFE still declare these two
   nullable fields, but nothing populates them anymore (they were written by the old
   accumulate via `upsertAdvisoryStatus`). **Decide:** either carry
   `lastRecommendationAt`/`lastDecisionStatus` on advisory-bff's `ADVISORY_STATUS_UPDATED`
   payload (advisory-bff would need to derive them — it has the decision rows), or drop
   the two fields from the dashboard schema + MFE.

3. **Confirm no remaining `MANDATE_ISSUED` vestige** in dashboard-bff (it was dropped
   from Ingress as an orphan with no handler in w3; verify the old `TRIGGER_TYPES`
   set / any stale reference is fully gone).

Cheapest next step: grep `upsertAdvisoryStatus|lastRecommendationAt|lastDecisionStatus|MANDATE_ISSUED`
across `services/investor/dashboard-bff` + `apps/dashboard-mfe`; remove (1)+(3) outright;
raise (2) as a product decision. See [[project_read_model_redesign]].
