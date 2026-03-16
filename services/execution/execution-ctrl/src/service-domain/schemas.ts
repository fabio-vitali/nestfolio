import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const OrderSubmittedSchema = BusEventSchema.extend({
  type: z.literal('ORDER_SUBMITTED'),
  subject: z.object({
    orderId: z.string(),
    decisionId: z.string(),
    symbol: z.string(),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['MARKET', 'LIMIT']),
    quantity: z.number().positive(),
    limitPrice: z.number().positive().nullable(),
    currency: z.string().length(3),
  }),
});
export type OrderSubmittedEvent = z.infer<typeof OrderSubmittedSchema>;
