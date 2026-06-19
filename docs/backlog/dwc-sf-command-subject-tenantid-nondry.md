---
id: dwc-sf-command-subject-tenantid-nondry
status: parking
type: bug
notes: "DWC SF emits CONSTRUCT_PORTFOLIO/GENERATE_NARRATIVE with tenantId in subject — non-DRY; consumers read context"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: typed-test-fixtures-leftovers
epic_role: core
---

# DWC SF command events carry tenantId in subject (non-DRY)

`decision-state-machine.ts` `createAgentInvocationState` always injects `'tenantId.$': '$.tenantId'` into the event subject alongside the task-token and agent inputs:

```ts
// services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts ~line 62-68
const subject: Record<string, unknown> = {
  'decisionId.$': '$.decisionId',
  'tenantId.$': '$.tenantId',   // <-- non-DRY: identity belongs in context only
  'taskToken.$': '$$.Task.Token',
};
```

Affects **CONSTRUCT_PORTFOLIO** (InvokePortfolioEngine) and **GENERATE_NARRATIVE** (InvokeAdvisoryNarrative).

**Why harmless today:** both consumers (`portfolio-engine-ctrl` and `advisory-narrative-ctrl` `event-listener.ts`) read identity DRY from `ctx.tenantId` (EventContext), not `subject.tenantId`. The extra field is silently ignored at runtime.

**Why it matters:** the typed-test-fixtures schemas (`ConstructPortfolioSchema`, `GenerateNarrativeSchema`) are authored DRY — no `tenantId` field — so the runtime `EventSubjects[detailType].parse(subject)` backstop will strip the extra field (zod strips unknown keys by default) rather than reject. This is the correct behaviour. However, the SF is a spec-violating producer that could confuse future consumers who read the subject naively.

**Fix:** remove `'tenantId.$': '$.tenantId'` from `createAgentInvocationState` in `decision-state-machine.ts`. Verify no consumer reads `subject.tenantId` (grep confirms none currently do). Low risk but requires a SF definition redeploy.

Surfaced during typed-test-fixtures Phase 2 Task 5 schema authoring (2026-06-17).
