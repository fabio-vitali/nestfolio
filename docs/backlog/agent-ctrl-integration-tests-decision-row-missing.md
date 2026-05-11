---
id: agent-ctrl-integration-tests-decision-row-missing
status: queued
rank: 4
type: bug
notes: "3 agent-ctrl integration tests time out 60s waiting for `pk=DECISION#…`. Root cause: handlers throw UnknownOperatingModeError before DDB write because tests don't include `operatingMode` in event subject. Post-ship fixture rot from `non-investor-profile-trigger-operating-mode-lookup` workstream."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Agent-controller integration tests: handlers throw `UnknownOperatingModeError` before DDB write

**Failing integration tests (3 services, identical shape, same root cause):**

| service | test | event triggered |
| ------- | ---- | --------------- |
| `advisory-narrative-ctrl` | `GENERATE_NARRATIVE → AgentInvocation DDB write + CDC › should write AgentInvocation record to DDB on GENERATE_NARRATIVE` | `GENERATE_NARRATIVE` |
| `portfolio-engine-ctrl` | `CONSTRUCT_PORTFOLIO → AgentInvocation DDB write + CDC › should write AgentInvocation record to DDB on CONSTRUCT_PORTFOLIO` | `CONSTRUCT_PORTFOLIO` |
| `investor-profile-ctrl` | `ANALYZE_INVESTOR_PROFILE → AgentInvocation DDB write + CDC › should write AgentInvocation record to DDB on ANALYZE_INVESTOR_PROFILE` | `ANALYZE_INVESTOR_PROFILE` |

All three fail identically: `TableAssertions: timeout waiting for item pk=DECISION#integ-... sk=(any) after 60000ms`.

## Root cause

Verified 2026-05-11. The handler chain is:

```
event-listener.ts → validate operatingMode → agent-service.runPipeline → DDB Put
```

Each `event-listener.ts` now **gates on `operatingMode`** before reaching the DDB write:

- `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:31-38`:
  ```ts
  const operatingMode = subject.operatingMode as string | undefined;
  if (!operatingMode) {
    throw new UnknownOperatingModeError({ decisionId, resolutionPath: 'subject.operatingMode (propagated by SF from InvokeInvestorProfile result)', ... });
  }
  ```
- `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts:33-35` — same gate.
- `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts:33-39` — gates on `subject.investorProfile.operatingMode || subject.investorProfile.mandate.operatingMode`.

These guards were added by the recently shipped `non-investor-profile-trigger-operating-mode-lookup` workstream (commit `38a0478e..main`) to fail-fast instead of silently defaulting to `BALANCED`. The integration tests still publish the pre-guard payload shape:

```ts
detail: { tenantId, decisionId, taskToken }
```

→ handler throws → row never written → 60 s timeout.

## Fix shape

Update each test fixture's `eb.putEvent` call to include the contract the handler now requires:

| service | subject shape needed |
| ------- | -------------------- |
| advisory-narrative-ctrl | `{ tenantId, decisionId, taskToken, operatingMode: 'BALANCED' }` (any valid mode) |
| portfolio-engine-ctrl | `{ tenantId, decisionId, taskToken, operatingMode: 'BALANCED' }` |
| investor-profile-ctrl | `{ tenantId, decisionId, taskToken, investorProfile: { operatingMode: 'BALANCED', ... } }` |

No production code changes.

## Process gap surfaced

The `non-investor-profile-trigger-operating-mode-lookup` ship updated the handlers but not the integration tests. This pattern recurs (see ranks 5 and 6 below) — three of four integration failures this sweep are post-ship fixture rot. Worth a single workstream-ship checklist item: "run the affected service's integration suite before flipping status: shipped".

Surfaced 2026-05-11 during full-system test sweep.
