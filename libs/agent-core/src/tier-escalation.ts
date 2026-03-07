import { AgentType, getModelConfig } from './model-config';

// Model tiers ordered by capability
const HAIKU_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET_ID = 'anthropic.claude-sonnet-4-6-20250514-v1:0';
const OPUS_ID = 'anthropic.claude-opus-4-6-20250501-v1:0';

const ESCALATION_PATH: string[] = [HAIKU_ID, SONNET_ID, OPUS_ID];

export interface EscalationStep {
  modelId: string;
  maxTokens: number;
  temperature: number;
  isEscalated: boolean;
  escalationLevel: number; // 0 = primary, 1 = first escalation, etc.
}

/**
 * Returns the escalation path for an agent, starting from its configured model
 * and escalating through higher tiers.
 */
export function getEscalationPath(agentType: AgentType): EscalationStep[] {
  const primary = getModelConfig(agentType);
  const startIndex = ESCALATION_PATH.indexOf(primary.modelId);

  if (startIndex === -1) {
    // Model not in standard escalation path, return just the primary
    return [{ ...primary, isEscalated: false, escalationLevel: 0 }];
  }

  const steps: EscalationStep[] = [];
  for (let i = startIndex; i < ESCALATION_PATH.length; i++) {
    steps.push({
      modelId: ESCALATION_PATH[i],
      maxTokens: getMaxTokensForModel(ESCALATION_PATH[i], primary.maxTokens),
      temperature: primary.temperature, // Keep same temperature
      isEscalated: i > startIndex,
      escalationLevel: i - startIndex,
    });
  }

  return steps;
}

function getMaxTokensForModel(modelId: string, defaultMaxTokens: number): number {
  // Higher-tier models get more tokens
  if (modelId === OPUS_ID) return Math.max(defaultMaxTokens, 4096);
  if (modelId === SONNET_ID) return Math.max(defaultMaxTokens, 4096);
  return defaultMaxTokens;
}

/**
 * Returns the next escalation step after the current model, or null if already at max.
 */
export function getNextEscalation(
  agentType: AgentType,
  currentModelId: string,
): EscalationStep | null {
  const path = getEscalationPath(agentType);
  const currentIndex = path.findIndex((s) => s.modelId === currentModelId);

  if (currentIndex === -1 || currentIndex >= path.length - 1) {
    return null;
  }

  return path[currentIndex + 1];
}

export { HAIKU_ID, SONNET_ID, OPUS_ID };
