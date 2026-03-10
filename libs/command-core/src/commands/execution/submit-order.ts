import { z } from 'zod';
import { defineCommand } from '../../command';
import { type PortfolioState } from '../../state/portfolio-state';

export const SubmitOrderSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  limitPrice: z.number().positive().optional(),
  submittedAt: z.string().min(1),
});

export type SubmitOrderPayload = z.infer<typeof SubmitOrderSchema>;

export const SubmitOrder = defineCommand<SubmitOrderPayload, PortfolioState>({
  type: 'SubmitOrder',
  schema: SubmitOrderSchema,
  apply: (state, _payload) => {
    // Order submission does not change portfolio state — it is a lifecycle marker.
    // The actual position/cash change happens on fill.
    return state;
  },
});
