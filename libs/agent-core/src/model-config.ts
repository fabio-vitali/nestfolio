export type AgentType =
  | 'user-goals'
  | 'risk-assessment'
  | 'market-research'
  | 'portfolio-construction'
  | 'rebalance-planner'
  | 'explainability';

export interface ModelConfig {
  modelId: string;
  maxTokens: number;
  temperature: number;
}

const MODEL_MAP: Record<AgentType, ModelConfig> = {
  'user-goals': {
    modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    maxTokens: 2048,
    temperature: 0.0,
  },
  'risk-assessment': {
    modelId: 'anthropic.claude-opus-4-6-20250501-v1:0',
    maxTokens: 4096,
    temperature: 0.1,
  },
  'market-research': {
    modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
    maxTokens: 4096,
    temperature: 0.2,
  },
  'portfolio-construction': {
    modelId: 'anthropic.claude-opus-4-6-20250501-v1:0',
    maxTokens: 4096,
    temperature: 0.1,
  },
  'rebalance-planner': {
    modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
    maxTokens: 4096,
    temperature: 0.1,
  },
  'explainability': {
    modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
    maxTokens: 8192,
    temperature: 0.3,
  },
};

/**
 * Returns the Bedrock model configuration for a given agent type.
 * @throws if the agent type is unknown
 */
export function getModelConfig(agentType: AgentType): ModelConfig {
  const config = MODEL_MAP[agentType];
  if (!config) {
    throw new Error(`Unknown agent type: ${agentType as string}`);
  }
  return config;
}

/**
 * All supported agent types.
 */
export const AGENT_TYPES: readonly AgentType[] = [
  'user-goals',
  'risk-assessment',
  'market-research',
  'portfolio-construction',
  'rebalance-planner',
  'explainability',
] as const;
