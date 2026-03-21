import { z } from 'zod';
import { defineCommand } from '@nestfolio/event-processor/sourcing';
import { type AccountState } from './account-state';

export const CancelOrderSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  reason: z.string().optional(),
  cancelledAt: z.string().min(1),
});

export type CancelOrderPayload = z.infer<typeof CancelOrderSchema>;

export const CancelOrder = defineCommand<CancelOrderPayload, AccountState>({
  type: 'CancelOrder',
  schema: CancelOrderSchema,
  apply: (state, _payload) => {
    return state;
  },
});
