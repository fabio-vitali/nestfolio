import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const OrderFilledSchema = BusEventSchema.extend({
  type: z.literal('ORDER_FILLED'),
  subject: z.object({
    orderId: z.string(),
    brokerOrderId: z.string(),
    filledQuantity: z.number().positive(),
    averageFillPrice: z.number().positive(),
    filledAt: z.string().datetime(),
  }),
});
export type OrderFilledEvent = z.infer<typeof OrderFilledSchema>;

export const DepositDetectedSchema = BusEventSchema.extend({
  type: z.literal('DEPOSIT_DETECTED'),
  subject: z.object({
    depositId: z.string(),
    amountCents: z.number().int().positive(),
    currency: z.string().length(3),
    detectedAt: z.string().datetime(),
  }),
});
export type DepositDetectedEvent = z.infer<typeof DepositDetectedSchema>;
