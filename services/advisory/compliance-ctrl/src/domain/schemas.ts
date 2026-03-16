import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const DecisionApprovedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_APPROVED'),
  subject: z.object({
    decisionId: z.string(),
    complianceLevel: z.enum(['L1', 'L2', 'L3']),
    approvedAt: z.string().datetime(),
  }),
});
export type DecisionApprovedEvent = z.infer<typeof DecisionApprovedSchema>;

export const DecisionBlockedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_BLOCKED'),
  subject: z.object({
    decisionId: z.string(),
    reason: z.string(),
    violatedRules: z.array(z.string()),
    blockedAt: z.string().datetime(),
  }),
});
export type DecisionBlockedEvent = z.infer<typeof DecisionBlockedSchema>;
