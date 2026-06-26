---
id: an-ctrl-wrap-agent-output-vestigial
status: shipped
closed: 2026-06-26
type: refactor
notes: "advisory-narrative-ctrl handler still wraps result via wrapAgentOutput but the wrap is unread after the callback refactor"
references: []
out_of_scope:
  - "Building the deferred S3-pointer output-offload path (the `// future:` s3 variant of WrappedAgentOutput) — it was never needed (p99 ~6KB) and is being deleted, not completed"
  - "Other advisory agent handlers (investor-profile/market-intelligence/portfolio-engine) — already off wrapAgentOutput; only PE-ctrl's orphaned OutputTooLargeError test-mock entry is swept here"
spec: null
plan: null
topic_memory: []
validation_gate: "Commit eae66249 on feat/epic-dead-code-cleanup. Verified zero callers/readers workspace-wide before deletion (grep: wrapAgentOutput/OutputTooLargeError/WrappedAgentOutput/INLINE_SIZE_THRESHOLD_BYTES → no residual refs). Deleted: AN-ctrl handler import+size-guard call, agent-orchestrator wrap-agent-output.ts + index export + its test, orphaned OutputTooLargeError test-mocks (AN-ctrl + PE-ctrl), AN-ctrl card line. 6.2 gate GREEN: `nx run-many -t test lint` across 33 true-affected projects (agent-orchestrator 19/19 suites · 129 tests; advisory-narrative-ctrl + portfolio-engine-ctrl unit suites green). Deploy + integration/e2e deferred to epic E6 batched gate per logged run-state decision (change is a behavioral no-op; agent-orchestrator-dependent services redeploy cumulatively at E6)."
epic: dead-code-cleanup
epic_role: core
---

# Remove vestigial `wrapAgentOutput` in advisory-narrative-ctrl handler

Surfaced during Task 7 code review of the advisory-cycle-agent-precomputation-impl workstream (commit `b2ed212c`).

**Evidence:** `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:104` calls `wrapped = wrapAgentOutput(result)` and assigns `output.agentOutput: wrapped.value` (~line 107). Under the pre-Task-7 flow this was the >25KB explainability size guard before SF received the output. Under `materializeToTable`, SF no longer reads the handler's `output` field — DWC's CallbackIngress reads the raw `result` directly from the `AgentCompletion` CDC row (`record('AgentCompletion', { ..., agentOutput: result, ... })`, line 117).

The wrap path is therefore dead. Left in place during Task 7 because the workstream scope said "only callback transport changes" — removing it would be a behavioural change to AN-ctrl's output handling beyond callback transport, and AN-ctrl's `agent-service`/orchestrator still uses the same agent definition.

**Cheapest next step:** delete the `wrapAgentOutput` call + `wrapped.value` assignment from the handler; keep the import-removal verifiable via lint. The original >25KB guard rationale (SF state size limits) no longer applies — the row goes to DDB, and DDB item-size limits are 400KB, well above any plausible explanation text.

Confirm before doing this:
1. No other consumer reads `output.agentOutput` (the materializeToTable output path).
2. The `AgentCompletion` CDC row consumer (DWC CallbackIngress, see plan Task 10) doesn't expect the wrap envelope.
3. `wrapAgentOutput` isn't imported elsewhere in AN-ctrl.

If true, drop the import + helper call. If any of (1)–(3) is false, keep the wrap and document why.
