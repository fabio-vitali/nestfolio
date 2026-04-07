import type { z } from 'zod';
import type { AgentConfig, WaveDefinition } from '@nestfolio/agent-orchestrator';
import {
  GoalInterpretationSchema,
  RiskAssessmentSchema,
  MarketResearchSchema,
  PortfolioConstructionSchema,
  RebalancePlanSchema,
  ExplanationSchema,
} from './schemas';
import { loadPrompt } from './prompts/loader';

export type AgentType =
  | 'user-goals'
  | 'risk-assessment'
  | 'market-research'
  | 'portfolio-construction'
  | 'rebalance-planner'
  | 'explainability';

export const AGENT_TYPES: readonly AgentType[] = [
  'user-goals',
  'risk-assessment',
  'market-research',
  'portfolio-construction',
  'rebalance-planner',
  'explainability',
] as const;

export const AGENT_CONFIGS: Record<AgentType, AgentConfig<z.ZodType>> = {
  'user-goals': {
    modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    maxTokens: 2048,
    temperature: 0.0,
    schema: GoalInterpretationSchema,
    promptTemplate: loadPrompt('user-goals'),
  },
  'risk-assessment': {
    modelId: 'anthropic.claude-opus-4-6-20250501-v1:0',
    maxTokens: 4096,
    temperature: 0.1,
    schema: RiskAssessmentSchema,
    promptTemplate: loadPrompt('risk-assessment'),
  },
  'market-research': {
    modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
    maxTokens: 4096,
    temperature: 0.2,
    schema: MarketResearchSchema,
    promptTemplate: loadPrompt('market-research'),
  },
  'portfolio-construction': {
    modelId: 'anthropic.claude-opus-4-6-20250501-v1:0',
    maxTokens: 4096,
    temperature: 0.1,
    schema: PortfolioConstructionSchema,
    promptTemplate: loadPrompt('portfolio-construction'),
  },
  'rebalance-planner': {
    modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
    maxTokens: 4096,
    temperature: 0.1,
    schema: RebalancePlanSchema,
    promptTemplate: loadPrompt('rebalance-planner'),
  },
  explainability: {
    modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
    maxTokens: 8192,
    temperature: 0.3,
    schema: ExplanationSchema,
    promptTemplate: loadPrompt('explainability'),
  },
};

export const DECISION_LIFECYCLE_WAVES: WaveDefinition<AgentType> = [
  { agents: ['user-goals', 'risk-assessment', 'market-research'] },
  { agents: ['portfolio-construction', 'rebalance-planner'], dependsOn: ['user-goals', 'risk-assessment', 'market-research'] },
  { agents: ['explainability'], dependsOn: ['portfolio-construction', 'rebalance-planner'] },
];
