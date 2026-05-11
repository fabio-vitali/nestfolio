---
id: hoist-named-tool-retry-to-orchestrator
status: dropped
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Dropped 2026-05-11 boundary review — trigger-driven entry that never triggered. Refile if advisory agents start showing the same Sonnet flakiness onboarding-bff originally had."
---

# Hoist named-tool retry to `libs/agent-orchestrator`

**Dropped 2026-05-11 (boundary review).** Original parking rationale: "Only if advisory agents start showing the same Sonnet flakiness; not seen yet (Spec 3 retain-as-defense decision)." No such flakiness observed in the ~6 weeks since parked. The `onboarding-bff` named-tool retry guard remains in place as defense-in-depth. Refile from scratch if/when advisory agents exhibit the same `final_message_with_tool_use` failure mode.
