import { PortfolioAgentCompletionSchema, PortfolioAgentFailureSchema } from '../domain/contracts';

export const subjectSchemas = {
  AgentCompletion: PortfolioAgentCompletionSchema,
  AgentFailure: PortfolioAgentFailureSchema,
};

export const exemptTypenames: string[] = [];
