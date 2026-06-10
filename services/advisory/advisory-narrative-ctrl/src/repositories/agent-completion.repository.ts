// AgentCompletion / AgentFailure row key helpers.
//
// advisory-narrative-ctrl writes one of these rows per GENERATE_NARRATIVE event:
//   - AgentCompletion on successful agent run (carries taskToken + agentOutput)
//   - AgentFailure    on caught agent error  (carries taskToken + errorType/Message)
//
// The Egress CDC publisher emits NARRATIVE_COMPLETED / NARRATIVE_FAILED on INSERT,
// which DWC's CallbackIngress (Task 10) consumes to call states:SendTaskSuccess /
// states:SendTaskFailure. AN-ctrl's Lambda role therefore no longer needs
// states:SendTask* grants — those move exclusively to DWC.
//
// Writes go through the standard event-processor `record()` intent; this file
// deliberately exposes only key formulas (no custom SDK code).
//
// Key helpers are re-exported from @nestfolio/agent-orchestrator (camelCase functions)
// under SCREAMING_SNAKE aliases so call sites in event-listener.ts remain unchanged.

export {
  agentCompletionPk as AGENT_COMPLETION_PK,
  agentCompletionSk as AGENT_COMPLETION_SK,
  agentFailurePk as AGENT_FAILURE_PK,
  agentFailureSk as AGENT_FAILURE_SK,
} from '@nestfolio/agent-orchestrator';
