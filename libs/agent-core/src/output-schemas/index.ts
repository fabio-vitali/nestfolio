import { z } from 'zod';

import { GoalInterpretationSchema } from './user-goals.schema';
import { RiskAssessmentSchema } from './risk-assessment.schema';
import { MarketResearchSchema } from './market-research.schema';
import { PortfolioConstructionSchema } from './portfolio-construction.schema';
import { RebalancePlanSchema } from './rebalance-planner.schema';
import { ExplanationSchema } from './explainability.schema';
import { AgentType } from '../model-config';

export {
  GoalInterpretationSchema,
  type GoalInterpretation,
} from './user-goals.schema';
export {
  RiskAssessmentSchema,
  type RiskAssessment,
} from './risk-assessment.schema';
export {
  MarketResearchSchema,
  type MarketResearch,
} from './market-research.schema';
export {
  PortfolioConstructionSchema,
  type PortfolioConstruction,
} from './portfolio-construction.schema';
export {
  RebalancePlanSchema,
  type RebalancePlan,
} from './rebalance-planner.schema';
export {
  ExplanationSchema,
  type Explanation,
} from './explainability.schema';

const SCHEMA_MAP: Record<AgentType, z.ZodType> = {
  'user-goals': GoalInterpretationSchema,
  'risk-assessment': RiskAssessmentSchema,
  'market-research': MarketResearchSchema,
  'portfolio-construction': PortfolioConstructionSchema,
  'rebalance-planner': RebalancePlanSchema,
  'explainability': ExplanationSchema,
};

/**
 * Returns the Zod output schema for a given agent type.
 * @throws if the agent type is unknown
 */
export function getOutputSchema(agentType: AgentType): z.ZodType {
  const schema = SCHEMA_MAP[agentType];
  if (!schema) {
    throw new Error(`Unknown agent type: ${agentType as string}`);
  }
  return schema;
}
