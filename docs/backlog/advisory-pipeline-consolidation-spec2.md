---
id: advisory-pipeline-consolidation-spec2
status: shipped
type: refactor
references: []
out_of_scope: []
spec: docs/superpowers/specs/2026-04-30-advisory-pipeline-consolidation-design.md
plan: docs/superpowers/plans/2026-04-30-advisory-pipeline-consolidation-plan.md
topic_memory:
  - project_advisory_pipeline_consolidation.md
validation_gate: "advisory-ctrl deleted (33→32 services); CFN stack dev-advisory-ctrl destroyed in dev; AgentCore Memory write/read contract aligned; SYSTEM-ARCHITECTURE.md §7.1+§10.1+§17.1 resolved."
closed: "2026-04-30"
notes: "Deleted advisory-ctrl entirely; aligned AgentCore Memory write/read contract; closed §21 OQ #3 + #7."
---

# Advisory pipeline consolidation (Spec 2)

SHIPPED 2026-04-30 on `main` (commits `7c91abb9`..`2c706015`): deleted advisory-ctrl entirely (33→32 services, CFN stack `dev-advisory-ctrl` destroyed in dev), aligned AgentCore Memory write/read contract (`BatchCreateMemoryRecordsCommand` + `ListMemoryRecordsCommand` against `/{service}/{tenant}/decisions/{decisionId}` namespace — symmetric replacement for the legacy `CreateEventCommand`-on-sessionId vs `RetrieveMemoryRecordsCommand`-on-namespace divergence), migrated advisory-bff + compliance-ctrl + e2e-feature-tests imports from `@nestfolio/advisory-ctrl/events` to `@nestfolio/decision-workflow-ctrl/events` (event names already typed in `DecisionWorkflowEventTypes`), pruned the `decisionLifecycle` agent-trace probe and migrated its two consumer tests (`first-decision`, `reconciliation-correction`) to the surviving `advisoryNarrative` trap, regenerated the stale `compliance-ctrl/CLAUDE.md` (real subscriptions are `RECOMMENDATION_PROPOSED + 3 mandate events`, not the pre-emptively documented `DECISION_PACKET_*` set).

Resolves SYSTEM-ARCHITECTURE.md §7.1 + §10.1 + §17.1 → "Resolved 2026-04-30 (Spec 2)"; closes §21 OQ #3 + #7. Spec commit `f298f55b`, amended `60a17680` after `RECOMMENDATION_PROPOSED` was verified canonical not dead. Spec 3 (onboarding agent reliability) and §21 OQ #11 (recover missing originating specs) remain.
