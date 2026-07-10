---
id: runtime-epic-gate-unmapped-audit-integration-test-procedure
type: bug
status: queued
rank: 4
done_when: "resolve: the epic-pre-done / item-pre-ship batch selects the `integration-test-completeness` check (evaluator `run: skill:audit-integration-test`), but `makeAuditProcedures` (runtime/adapters/claude-code/audit-procedures.mjs) maps only 4 audit skills — `audit-service`, `audit-domain`, `audit-system`, `audit-e2e-test` — so `audit-integration-test` is UNMAPPED. `makeRunProcedure` returns `{status:'failed', summary:'unknown procedure: audit-integration-test'}`, `deriveJudge`'s judge throws, `runWatch` records a `#err` finding, and `preShipBatch` returns findings ⇒ the epic-pre-done gate returns status `failed`. Any epic-pre-done batch (changedScope `['**/*']`) OR item-pre-ship whose scope includes `services/**/test/integration/**` hard-fails on this. Fix: either map `audit-integration-test` into `AUDIT_SKILLS`/`makeAuditProcedures` (READ_ONLY headless, identical to the other four), or make an unmapped judge procedure a non-fatal skip (a check with no wired procedure should not manufacture a spurious finding)."
topic_memory: [project_runtime_realization.md]
---

# runtime-epic-gate-unmapped-audit-integration-test-procedure

**Surfaced 2026-07-10** during the `backlog-item-frontmatter-integrity` epic ship (E6 epic-pre-done gate),
agent-observed.

The `integration-test-completeness` check (`runtime/content/checks/integration-test-completeness.yaml`,
`cost_tier: expensive`, `contexts: [audit]`, `run: skill:audit-integration-test`) is selected by the
epic-pre-done expensive batch but has **no wired procedure** — `makeAuditProcedures.AUDIT_SKILLS` is
`['audit-service','audit-domain','audit-system','audit-e2e-test']`. Trace:

- `deriveJudge(runProcedure)` → `runProcedure('audit-integration-test', {check})`
- `makeRunProcedure`: `if (!proc) return {status:'failed', summary:'unknown procedure: audit-integration-test'}`
- the judge sees `status !== 'done'` and **throws**
- `runWatch` catches → pushes a `${check.id}#err` finding
- `preShipBatch` returns a non-empty findings array → `runOrchestrator` returns `status: 'failed'`

So the mechanized epic-pre-done gate **cannot pass** while this procedure is unmapped — it blocks the
runtime's epic path broadly, not just this epic.

Shares a root cause with [[runtime-epic-pre-done-scope-hardcoded-star]] (both are epic-pre-done gate
defects surfaced together); `backlog-themes` may cluster them into a runtime-epic-gate theme epic.
