// Error classes for the structured-output reliability workstream
// (Spec 4, 2026-05-06).
//
// DegradedAgentOutputError: the orchestrator's wave-node output marks an
//   agent as degraded (its withFallback decorator returned `ok: false`).
//   Per-service `agent-service.ts` raises this instead of laundering the
//   degraded path into AgentCore Memory, so SF observes a TaskFailure with
//   a clear cause instead of silent success → proposedTrades:[].
//
// DegradedStructuredOutputError: the LLM call returned an empty / shallow
//   structured-output payload TWICE — once on the bare invoke and once
//   after retry with tool_choice pinned + REINFORCE_SUFFIX appended. Mirrors
//   onboarding-bff's named-tool retry guard from Spec 3 (2026-05-01).
//
// EmptyAgentResponseError: hoisted from portfolio-engine-ctrl (the only
//   service that previously had a guard) so investor-profile,
//   market-intelligence, and advisory-narrative all share the same shape.

export class DegradedAgentOutputError extends Error {
  readonly decisionId: string;
  readonly agent: string;
  readonly reason: string;
  readonly responseKeys: string[];
  constructor(args: { decisionId: string; agent: string; reason: string; responseKeys: string[] }) {
    super(
      `Agent "${args.agent}" returned a degraded output for decision ${args.decisionId}: ${args.reason}. ` +
        `Response keys=[${args.responseKeys.join(',')}].`,
    );
    this.name = 'DegradedAgentOutputError';
    this.decisionId = args.decisionId;
    this.agent = args.agent;
    this.reason = args.reason;
    this.responseKeys = args.responseKeys;
  }
}

export class DegradedStructuredOutputError extends Error {
  readonly schemaName: string;
  readonly attempts: number;
  constructor(args: { schemaName: string; attempts: number }) {
    super(
      `Structured-output call for schema "${args.schemaName}" returned a degraded payload after ${args.attempts} attempt(s). ` +
        `The bare invoke and the tool_choice-pinned retry both produced empty / shallow output.`,
    );
    this.name = 'DegradedStructuredOutputError';
    this.schemaName = args.schemaName;
    this.attempts = args.attempts;
  }
}

export class EmptyAgentResponseError extends Error {
  readonly decisionId: string;
  readonly responseKeys: string[];
  readonly missingOrEmptyKeys: string[];
  constructor(args: { decisionId: string; responseKeys: string[]; missingOrEmptyKeys: string[] }) {
    super(
      `Agent returned empty / missing orchestrator output for decision ${args.decisionId}; ` +
        `got keys=[${args.responseKeys.join(',')}], missing or empty=[${args.missingOrEmptyKeys.join(',')}]. ` +
        `AgentCore likely accepted the invocation but did not run the agent.`,
    );
    this.name = 'EmptyAgentResponseError';
    this.decisionId = args.decisionId;
    this.responseKeys = args.responseKeys;
    this.missingOrEmptyKeys = args.missingOrEmptyKeys;
  }
}

// UnknownOperatingModeError: the operatingMode for a decision could not be
//   resolved from the expected payload location. Replaces the silent
//   `?? 'BALANCED'` fallback that was masking a propagation regression
//   (see docs/backlog/operating-mode-shape-empty-proposed-trades.md). Throw
//   loudly so SF surfaces a TaskFailure with a precise resolutionPath instead
//   of the agent silently producing BALANCED-shape outputs under every mode.
export class UnknownOperatingModeError extends Error {
  readonly decisionId: string;
  readonly resolutionPath: string;
  readonly availableKeys: string[];
  constructor(args: { decisionId: string; resolutionPath: string; availableKeys: string[] }) {
    super(
      `operatingMode missing for decision ${args.decisionId} at ${args.resolutionPath}. ` +
        `Available keys=[${args.availableKeys.join(',')}]. ` +
        `Refusing to silently default to BALANCED — fix the upstream propagation.`,
    );
    this.name = 'UnknownOperatingModeError';
    this.decisionId = args.decisionId;
    this.resolutionPath = args.resolutionPath;
    this.availableKeys = args.availableKeys;
  }
}
