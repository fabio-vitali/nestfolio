import { z } from 'zod';
import { BusEventSchema } from '../shared/types';

export const DecisionPacketCreatedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_PACKET_CREATED'),
  subject: z.object({
    decisionId: z.string(),
    trigger: z.string(),
    tenantId: z.string().uuid(),
  }),
});

export type DecisionPacketCreatedEvent = z.infer<typeof DecisionPacketCreatedSchema>;

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

export const UserConfirmationRequestedSchema = BusEventSchema.extend({
  type: z.literal('USER_CONFIRMATION_REQUESTED'),
  subject: z.object({
    decisionId: z.string(),
    tenantId: z.string().uuid(),
    summary: z.string(),
    expiresAt: z.string().datetime(),
  }),
});

export type UserConfirmationRequestedEvent = z.infer<typeof UserConfirmationRequestedSchema>;
