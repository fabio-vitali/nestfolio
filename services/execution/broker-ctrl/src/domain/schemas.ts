import { z } from 'zod';

export const BrokerOrderSchema = z.object({
  pk: z.string(),
  sk: z.literal('BrokerOrder'),
  __typename: z.literal('BrokerOrder'),
  tenantId: z.string(),
  orderId: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  state: z.enum(['ROUTING', 'AWAITING_FILL', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'ESCALATED']),
  routedTo: z.enum(['sim', 'alpaca']),
  fillTaskToken: z.string().optional(),
  requestedQty: z.number(),
  filledQty: z.number(),
  remainingQty: z.number(),
  averageFillPrice: z.number().optional(),
  retryCount: z.number(),
  instrumentId: z.string(),
  routedAt: z.string(),
  filledAt: z.string().optional(),
  failureReason: z.string().optional(),
});
export type BrokerOrder = z.infer<typeof BrokerOrderSchema>;

export const NormalizedEventSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  __typename: z.literal('NormalizedEvent'),
  tenantId: z.string(),
  orderId: z.string().optional(),
  executionMode: z.enum(['simulation', 'live']),
  filledQty: z.number().optional(),
  averageFillPrice: z.number().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

export const ExecutionModeSchema = z.object({
  pk: z.string(),
  sk: z.literal('ExecutionMode'),
  __typename: z.literal('ExecutionMode'),
  tenantId: z.string(),
  mode: z.enum(['simulation', 'live']),
  updatedAt: z.string(),
});
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
