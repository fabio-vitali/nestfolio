import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const DecisionPacketCreatedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_PACKET_CREATED'),
  subject: z.object({
    decisionId: z.string(),
    trigger: z.string(),
    tenantId: z.string().uuid(),
  }),
});
export type DecisionPacketCreatedEvent = z.infer<typeof DecisionPacketCreatedSchema>;

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
