---
id: stale-read-upstream-output-advisory-ctrl
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Agents losing context channel since 2026-04-30 ship; trivial fix."
---

# Stale `session.readUpstreamOutput('advisory-ctrl')` in 2 AgentCore graph.ts files

Surfaced 2026-05-06 during Operating Mode Phase 2 implementation. `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:90` and `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:72` both call `session.readUpstreamOutput('advisory-ctrl')`. advisory-ctrl was REMOVED 2026-04-30 in Spec 2 (advisory pipeline consolidation), so the namespace `/advisory-ctrl/{tenantId}/decisions/{decisionId}` is never written to. Result: `upstreamRecords` is always empty, `upstreamContext` always empty string. Latent — agents have been losing a context channel since 2026-04-30 ship without anyone noticing. Trivial fix: either delete the dead code, or replace with reads of the actual upstream agents (investor-profile, market-intelligence, portfolio-engine for narrative). Promote when next investigating advisory pipeline behavior or when working on agent context quality.
