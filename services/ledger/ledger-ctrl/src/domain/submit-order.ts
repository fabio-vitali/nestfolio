import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

export const SubmitOrderSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  limitPrice: z.number().positive().optional(),
  submittedAt: z.string().min(1),
});

export type SubmitOrderPayload = z.infer<typeof SubmitOrderSchema>;

export const SubmitOrder = defineCommand<SubmitOrderPayload, AccountState>({
  type: 'SubmitOrder',
  schema: SubmitOrderSchema,
  apply: (state, _payload) => {
    return state;
  },
});
