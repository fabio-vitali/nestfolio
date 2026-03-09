import { z } from 'zod';

// --- Mutation input schemas ---

export const DecisionIdSchema = z.string().min(1).max(256);

export const RejectDecisionInputSchema = z.object({
  decisionId: z.string().min(1).max(256),
  reason: z.string().min(1).max(2000),
});
