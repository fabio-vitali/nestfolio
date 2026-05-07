---
id: sandbox-pipeline-trigger-gap
status: shipped
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_pipeline_trigger_gap.md
validation_gate: "SF now starts on WORKFLOW_TRIGGER_CREATED and full agent chain runs end-to-end against deployed dev. Four defects fixed (SF-start wiring, putEvents envelope, InvokeAgentRuntime on endpoint ARN, SendTask* grants)."
closed: "2026-04-20"
notes: "RESOLVED 2026-04-20 — SF starts on WORKFLOW_TRIGGER_CREATED + full agent chain runs end-to-end."
---

# Sandbox pipeline-trigger gap

RESOLVED 2026-04-20: SF now starts on `WORKFLOW_TRIGGER_CREATED` and the full agent chain runs end-to-end against deployed dev. Four defects fixed:

1. SF-start wiring (EventBridge rule + SF target).
2. `putEvents` envelope shape mismatch.
3. `InvokeAgentRuntime` on the endpoint ARN (not the runtime ARN).
4. `SendTask*` grants on the SF role policy.

Shipped on branch `feat/decision-workflow-sf-start-wiring`.

This unblocked Plan 3 Phase 4. See `project_pipeline_trigger_gap.md` for diagnostic narrative + topic dossier.
