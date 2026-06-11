import {
  ExplanationGeneratedSchema, NarrativeAgentCompletionSchema, NarrativeAgentFailureSchema,
} from '../domain/contracts';

export const subjectSchemas = {
  ReasoningOutput: ExplanationGeneratedSchema,
  AgentCompletion: NarrativeAgentCompletionSchema,
  AgentFailure: NarrativeAgentFailureSchema,
};

export const exemptTypenames: string[] = [];
