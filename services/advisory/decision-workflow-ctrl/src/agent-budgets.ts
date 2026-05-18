/**
 * Per-agent UX budgets, in seconds. One source of truth consumed by:
 *
 * - `decision-workflow-ctrl`'s SF (`TimeoutSeconds` on each agent-invoke state)
 * - the agent services' stacks (PE, AN) (passed as `uxBudgetSeconds` into
 *   `agentProfile()`, which uses it to derive Lambda timeout, SQS concurrency
 *   and visibility timeout, and to enforce the three-knob invariant)
 *
 * Changing one of these values without redeploying the corresponding agent
 * service will violate the invariant on the next CDK synth and fail loud.
 *
 * Re-tuning policy: bump the per-agent value when CloudWatch p90 drifts more
 * than ~20% from the value baked into the matching service stack's
 * `agentLatencyP90Ms` input. See spec §6 "Re-tuning over time".
 */
export const AGENT_BUDGETS = {
  PORTFOLIO_ENGINE_UX_SEC: 120,
  ADVISORY_NARRATIVE_UX_SEC: 120,
} as const;

export type AgentBudgetKey = keyof typeof AGENT_BUDGETS;
