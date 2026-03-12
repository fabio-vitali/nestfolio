import { z } from 'zod';
import { defineCommand } from '../../command';
import { type AccountState } from '../../state/account-state';

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
    // Cancellation does not change portfolio state — no fill occurred.
    return state;
  },
});
