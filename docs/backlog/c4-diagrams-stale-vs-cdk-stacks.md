---
id: c4-diagrams-stale-vs-cdk-stacks
status: queued
rank: 5
type: doc
notes: "C4 D2 diagrams under docs/architecture are stale vs the CDK stacks (dashboard-bff Ingress event count, two advisory-to-investor cross-domain event counts)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# C4 diagrams stale vs CDK stacks

Regenerating Stage 1 (`node tools/generate-c4-sources.mjs`) produces a diff against committed C4
D2 sources: `dashboard-bff` Ingress rule label shows `[13 events]` but the stack now subscribes to
14; the advisory→investor cross-domain flow shows `5 Events` but is now 6 (`DECISION_PACKET_UPDATED`
added to the forward); investor-adpt→dashboard-bff shows `10 Events` but is now 11. Needs a
`generate-c4-diagrams` re-run + commit.

Evidence: `docs/architecture/c3/dashboard-bff.d2:17` (13→14 events);
`docs/architecture/nestfolio.d2:251` (advisory-to-investor 5→6 Events, +`DECISION_PACKET_UPDATED`),
`:538` (advisory-to-investor-adpt 5→6), `:549` (investor-adpt-to-dashboard-bff 10→11).

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-system-arch-docs#0); filing deferred to
this session per Entry 33.
