---
id: from-run-next-pre-ship-judge-binding-gap
type: bug
status: queued
rank: 4
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

**Promoted parking → queued 2026-07-08** (user-approved via AskUserQuestion in `/backlog-next <id> --auto`): the parking hold was roadmap sequencing — the migration-completion path locked 2026-07-08 (epic `done_when` clause 7 added at the soak-gate ship boundary) names this item the next core in order (`from-run-next-pre-ship-judge-binding-gap` → `runtime-operational-surface` → `runtime-legacy-retirement`). The soak-gate close fired the hold.

resolve: run-next.mjs and run-epic.mjs build capabilities via makeClaudeCodeCapabilities({}) with NO procedures map, so deriveJudge fail-closes any skill: judgment check the diff-scoped item-pre-ship / epic-pre-done batch selects (evaluator error: unknown procedure) — only run-audit.mjs wires makeAuditProcedures. Un-masked 2026-07-08 by the classifyLane fix (runtime diffs now lane=simple): the from-classify-lane drive's pre-ship batch selected audit-system and fail-closed; unblocked by floor-curating audit-system scope (docs/** -> docs/architecture/**), but any future drive whose diff touches services/libs/docs-architecture/.claude-skills will select audit-* judgment checks and fail-close again. Fix: wire makeAuditProcedures({model: RUNTIME_AUDIT_MODEL}) into both drivers' main() (mirror run-audit.mjs:28-29), with the cost note that a selected audit then really runs headless — which is the designed epic-batch/item-pre-ship cadence (epic done_when clause 1).

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named parking item at Step-1 dispatch: promote or refuse
- **Options:** Promote to queued (rank 4) + proceed | Promote only, stop | Abort
- **Chosen:** Promote to queued (rank 4) + proceed
- **Rationale:** User-approved via AskUserQuestion (refusal-stop is never auto-resolved). Parking hold was roadmap sequencing; the 2026-07-08 migration-completion lock names this item the next core in order, so the hold fired at the soak-gate close.
- **Rejected:** Promote-only and Abort would leave the locked migration path stalled with no in-flight workstream.
