---
id: an-ctrl-wrap-agent-output-vestigial
status: parking
type: refactor
notes: "advisory-narrative-ctrl handler still wraps result via wrapAgentOutput but the wrap is unread after the callback refactor"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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
