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

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-10
- **Decision:** Which workstream /backlog-next --auto launches
- **Options:** runtime-epic-gate-unmapped-audit-integration-test-procedure (named <id>, status:queued rank 4) | default rank pick (top of QUEUED)
- **Chosen:** runtime-epic-gate-unmapped-audit-integration-test-procedure
- **Rationale:** Explicit <id> argument overrides the rank pick; file is status:queued (dispatch table -> proceed regardless of rank), type:bug, no epic: pointer -> standalone non-epic. Deterministic launch under --auto.
- **Rejected:** Deferring to the default rank pick — the explicit id argument is authoritative.

### D2 — 2026-07-10
- **Decision:** How to fix the unmapped audit-integration-test procedure so the epic-pre-done / item-pre-ship gate stops hard-failing
- **Options:** Map audit-integration-test into AUDIT_SKILLS (makeAuditProcedures) — READ_ONLY headless, identical to the other four | Make an unmapped judge procedure a non-fatal skip (no finding)
- **Chosen:** Map audit-integration-test into AUDIT_SKILLS
- **Rationale:** detect-fork-blast-radius.mjs AUDIT_SKILLS -> exit 0 (no shared-surface refs, safe to auto-resolve). Mapping makes the integration-test-completeness check (minted 2026-07-01 to run this audit) execute as designed AND preserves the deliberate fail-closed behavior driver-capabilities.mjs relies on (unknown procedure fail-closes genuinely-unwired checks). Additive + reusable: every future skill: check just registers in AUDIT_SKILLS. Reusability breaks the tie (CLAUDE.md Hard Constraints). Also added a recurrence-guard test asserting every registry skill: check has a wired procedure.
- **Rejected:** Non-fatal skip — silently passes any check whose procedure is unwired, undermining the fail-closed guard and hiding real wiring bugs; less reusable footgun.
