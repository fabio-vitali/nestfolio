---
id: dwc-sfn-callback-reason-blockreason-gap
status: parking
epic: typed-subject-consumer-contract-gaps
epic_role: core
type: bug
notes: "Surfaced 2026-06-10 by typed-subject-contracts-advisory (Task 2 code-quality review + the e2e gate codifying the real ComplianceCheck shape). decision-workflow-ctrl/src/handlers/sfn-callback.ts reads `subject.reason` off the DECISION_APPROVED/DECISION_BLOCKED event to set DecisionPacket.blockReason — but the real ComplianceCheck row (now codified by compliance-ctrl/contracts ComplianceCheckSchema) carries `violations: [{rule, description, severity}]` and NO `reason` string. So `subject.reason` is always undefined → DecisionPacket.blockReason is never written in production on the blocked path. The DWC sfn-callback unit test fixture FAKES a `reason` field, masking the gap (the [[event-subject-contracts]] co-wrong-fixture anti-pattern). CONSUMER-side drift (WS-3 territory) — the typed-subject-contracts-advisory slice only authored the producer contract that makes it provable; it did not retype the consumer read. Fix: derive blockReason from `violations` (e.g. the first BLOCKING violation's description, or a joined summary), update the sfn-callback unit fixture to the real ComplianceCheck shape (no fake `reason`), and add an assertion that blockReason is populated on a real blocked decision."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# DWC sfn-callback reads a non-existent `reason` → blockReason never set

`decision-workflow-ctrl/src/handlers/sfn-callback.ts` reads `subject.reason` from the
DECISION_BLOCKED event to populate `DecisionPacket.blockReason`. The real compliance-ctrl
`ComplianceCheck` row (codified as `ComplianceCheckSchema` in the advisory slice) has no
`reason` field — it carries `violations: [{rule, description, severity}]`. So `blockReason`
is silently never written for blocked decisions in production, and a co-wrong unit fixture
that injects a fake `reason` hides it.

This is a consumer-side read fix (WS-3 — the `consumer-parse-subject` workstream), not a
producer-contract change. Promote when the WS-3 consumer-parse-subject workstream runs, or
when a blocked-decision UX needs the real block reason — at which point derive `blockReason`
from `violations` and fix the co-wrong sfn-callback fixture.
