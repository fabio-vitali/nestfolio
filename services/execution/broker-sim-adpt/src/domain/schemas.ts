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

export const SimOrderRequestedSchema = BusEventSchema.extend({
  type: z.literal('SIM_ORDER_REQUESTED'),
  subject: z.object({
    orderId: z.string(),
    tenantId: z.string(),
    userId: z.string(),
    symbol: z.string(),
    side: z.enum(['BUY', 'SELL']),
    quantity: z.number().positive(),
  }),
});
export type SimOrderRequestedEvent = z.infer<typeof SimOrderRequestedSchema>;

export const SimDepositInitiatedSchema = BusEventSchema.extend({
  type: z.literal('SIM_DEPOSIT_INITIATED'),
  subject: z.object({
    depositId: z.string(),
    tenantId: z.string(),
    userId: z.string(),
    amountCents: z.number().int().positive(),
    currency: z.string().length(3),
  }),
});
export type SimDepositInitiatedEvent = z.infer<typeof SimDepositInitiatedSchema>;

export const SimWithdrawalRequestedSchema = BusEventSchema.extend({
  type: z.literal('SIM_WITHDRAWAL_REQUESTED'),
  subject: z.object({
    withdrawalId: z.string(),
    tenantId: z.string(),
    userId: z.string(),
    amount: z.number().positive(),
  }),
});
export type SimWithdrawalRequestedEvent = z.infer<typeof SimWithdrawalRequestedSchema>;
