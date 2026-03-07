import { z } from 'zod';
import { BusEventSchema } from '../shared/types';

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

export const PortfolioDriftDetectedSchema = BusEventSchema.extend({
  type: z.literal('PORTFOLIO_DRIFT_DETECTED'),
  subject: z.object({
    portfolioId: z.string(),
    driftPercent: z.number().min(0),
    threshold: z.number().min(0),
    driftDetails: z.array(
      z.object({
        symbol: z.string(),
        currentWeight: z.number(),
        targetWeight: z.number(),
        delta: z.number(),
      }),
    ),
  }),
});

export type PortfolioDriftDetectedEvent = z.infer<typeof PortfolioDriftDetectedSchema>;
