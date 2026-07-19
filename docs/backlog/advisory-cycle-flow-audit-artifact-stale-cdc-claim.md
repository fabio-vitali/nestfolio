---
id: advisory-cycle-flow-audit-artifact-stale-cdc-claim
status: parking
type: doc
notes: "flows/advisory-cycle.flow.yaml:265 claims compliance-ctrl emits AUDIT_ARTIFACT via CDC, but that egress mapping was removed 2026-06-11."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-cycle flow spec claims stale AUDIT_ARTIFACT CDC emission

`flows/advisory-cycle.flow.yaml:265` claims compliance-ctrl emits `AUDIT_ARTIFACT` (CDC) on
`AuditArtifact:INSERT`, but `services/advisory/compliance-ctrl/src/service.stack.ts:24-34` has no
CDC egress mapping for the `AuditArtifact` table (only `ComplianceCheck`). The
`AUDIT_ARTIFACT_CREATED` emission was deliberately removed 2026-06-11; the sibling flow
`flows/portfolio-rebalance.flow.yaml:122` correctly documents the DDB-only write for the same code
path, but `advisory-cycle.flow.yaml` still carries the stale claim.
