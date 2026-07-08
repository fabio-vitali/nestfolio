---
id: from-run-next-pre-ship-judge-binding-gap
type: bug
status: active
out_of_scope:
  - "run-item.mjs's identical empty-procedures gap — separate closure verdict (generic SPEC-3 CLI; may be retired at P6 instead of wired) — filed via backlog-add"
  - "audit-* check content/scope changes — the floor-curated audit-system scope (docs/architecture/**) stays as-is"
  - "flake-contract calibration / judgment eval corpus — parked as runtime-judgment-flake-calibration"
  - "legacy strangler seam removal (RUNTIME_ENGINE flag, prose bodies) — P6 runtime-legacy-retirement"
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

### D2 — 2026-07-08
- **Decision:** Wire makeAuditProcedures into driver mains: literal 2-line mirror per main vs one shared makeDriverCapabilities() seam in the adapter ring
- **Options:** Mirror run-audit.mjs:28-29 inline into run-next + run-epic mains (3 duplicate sites) | Extract makeDriverCapabilities() in driver-capabilities.mjs; use in run-next, run-epic, run-audit mains
- **Chosen:** Extract makeDriverCapabilities() seam
- **Rationale:** detect-fork-blast-radius exit 0 (new symbol, no shared-surface refs; makeClaudeCodeCapabilities signature untouched). Reusability rule: one named composition seam is testable (runScenario injection through makeAuditProcedures) and is the liftable pattern — main()-only wiring is exactly what made this bug unreachable by the existing unit tests. Satisfies done_when: both drivers wire makeAuditProcedures({model: RUNTIME_AUDIT_MODEL}).
- **Rejected:** Inline mirror keeps the untestable main()-wiring pattern that caused the gap and triplicates the composition.
