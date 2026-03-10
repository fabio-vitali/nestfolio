import { z } from 'zod';

// --- Mutation input schemas ---

export const DecisionIdSchema = z.string().min(1).max(256);

export const RejectDecisionInputSchema = z.object({
  decisionId: z.string().min(1).max(256),
  reason: z.string().min(1).max(2000),
});

// --- Query argument schemas ---

export const PaginationLimitSchema = z.number().int().positive().max(100).default(20);

export const CursorSchema = z.string().min(1).max(1024).optional();
