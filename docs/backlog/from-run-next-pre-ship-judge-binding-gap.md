---
id: from-run-next-pre-ship-judge-binding-gap
type: bug
status: parking
done_when: "resolve: resolve: run-next.mjs and run-epic.mjs build capabilities
  via makeClaudeCodeCapabilities({}) with NO procedures map, so deriveJudge
  fail-closes any skill: judgment check the diff-scoped item-pre-ship /
  epic-pre-done batch selects (evaluator error: unknown procedure) — only
  run-audit.mjs wires makeAuditProcedures. Un-masked 2026-07-08 by the
  classifyLane fix (runtime diffs now lane=simple): the from-classify-lane
  drive's pre-ship batch selected audit-system and fail-closed; unblocked by
  floor-curating audit-system scope (docs/** -> docs/architecture/**), but any
  future drive whose diff touches services/libs/docs-architecture/.claude-skills
  will select audit-* judgment checks and fail-close again. Fix: wire
  makeAuditProcedures({model: RUNTIME_AUDIT_MODEL}) into both drivers' main()
  (mirror run-audit.mjs:28-29), with the cost note that a selected audit then
  really runs headless — which is the designed epic-batch/item-pre-ship cadence
  (epic done_when clause 1)."
provenance:
  from_finding: run-next-pre-ship-judge-binding-gap
epic: runtime-operationalization
---

# from-run-next-pre-ship-judge-binding-gap

resolve: run-next.mjs and run-epic.mjs build capabilities via makeClaudeCodeCapabilities({}) with NO procedures map, so deriveJudge fail-closes any skill: judgment check the diff-scoped item-pre-ship / epic-pre-done batch selects (evaluator error: unknown procedure) — only run-audit.mjs wires makeAuditProcedures. Un-masked 2026-07-08 by the classifyLane fix (runtime diffs now lane=simple): the from-classify-lane drive's pre-ship batch selected audit-system and fail-closed; unblocked by floor-curating audit-system scope (docs/** -> docs/architecture/**), but any future drive whose diff touches services/libs/docs-architecture/.claude-skills will select audit-* judgment checks and fail-close again. Fix: wire makeAuditProcedures({model: RUNTIME_AUDIT_MODEL}) into both drivers' main() (mirror run-audit.mjs:28-29), with the cost note that a selected audit then really runs headless — which is the designed epic-batch/item-pre-ship cadence (epic done_when clause 1).
