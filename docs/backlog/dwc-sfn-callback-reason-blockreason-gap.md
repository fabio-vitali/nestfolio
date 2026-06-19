---
id: dwc-sfn-callback-reason-blockreason-gap
status: parking
type: bug
notes: "RE-HOMED 2026-06-16 out of typed-subject-consumer-contract-gaps: the typed-subject portion is DONE in code — decision-workflow-ctrl/src/handlers/sfn-callback.ts now does `parseSubject(payload, ComplianceCheckSchema)` (line ~80), the phantom `subject.reason` read is removed/documented, and the unit fixture uses the real `violations` shape (NOT a fake `reason`), so the co-wrong-fixture anti-pattern is already corrected. What REMAINS is purely BEHAVIORAL and outside a typed-subject epic's scope: DecisionPacket.blockReason is preserved as `undefined` on the blocked path because the real ComplianceCheck carries `violations: [{rule, description, severity}]` and no `reason` string — so blocked decisions surface no human-readable block reason. Fix: derive blockReason from `violations` (e.g. the first BLOCKING violation's description, or a joined summary) and assert it is populated on a real blocked decision; the fixture already encodes the real shape. Promote when a blocked-decision UX needs the real block reason."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: blocked-decision-reason-from-violations
epic_role: core
---

# DWC sfn-callback: blockReason never populated on blocked decisions (behavioral)

> **RE-HOMED 2026-06-16 out of `typed-subject-consumer-contract-gaps`.** The typed-subject gap
> this item originally tracked is CLOSED: `decision-workflow-ctrl/src/handlers/sfn-callback.ts`
> now does `parseSubject(payload, ComplianceCheckSchema)` (no phantom `subject.reason` read), and
> the unit fixture (`test/unit/sfn-callback.test.ts`) uses the real `violations` shape — the
> co-wrong-fixture anti-pattern is corrected. This is no longer a contract-shape gap, so it is no
> longer a member of the typed-subject epic. It is reframed as the standalone **behavioral** bug
> below.

`decision-workflow-ctrl/src/handlers/sfn-callback.ts` preserves `DecisionPacket.blockReason` as
`undefined` on the blocked path. The real compliance-ctrl `ComplianceCheck` row (codified as
`ComplianceCheckSchema`) carries `violations: [{rule, description, severity}]` and no `reason`
string, so there is no single field to copy into `blockReason`. The handler documents this
explicitly (lines ~99-100) and the test asserts `blockReason` is `undefined` as a known gap.
Result: blocked decisions surface no human-readable block reason to the UX.

Fix: derive `blockReason` from `violations` (e.g. the first BLOCKING violation's `description`, or
a joined summary of blocking violations) and add an assertion that `blockReason` is populated on a
real blocked decision. The fixture already encodes the real `violations` shape — only the
derivation + assertion remain. Promote when a blocked-decision UX needs the real block reason.
