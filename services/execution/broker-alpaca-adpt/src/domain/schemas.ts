import { z } from 'zod';

export const AlpacaOrderResultSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  __typename: z.literal('AlpacaOrderResult'),
  tenantId: z.string(),
  nestfolioOrderId: z.string(),
  alpacaOrderId: z.string(),
  status: z.enum(['PLACED', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'CANCEL_FAILED']),
  filledQuantity: z.number().optional(),
  averageFillPrice: z.number().optional(),
  rejectionReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaOrderResult = z.infer<typeof AlpacaOrderResultSchema>;

export const AlpacaTransferResultSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  __typename: z.literal('AlpacaTransferResult'),
  tenantId: z.string(),
  nestfolioTransferId: z.string(),
  alpacaTransferId: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  amount: z.number(),
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaTransferResult = z.infer<typeof AlpacaTransferResultSchema>;

export const AlpacaAccountSnapshotSchema = z.object({
  pk: z.string(),
  sk: z.string(),
  __typename: z.literal('AlpacaAccountSnapshot'),
  tenantId: z.string(),
  equity: z.number(),
  buyingPower: z.number(),
  positions: z.array(z.object({
    symbol: z.string(),
    qty: z.number(),
    marketValue: z.number(),
  })),
  timestamp: z.string(),
});
export type AlpacaAccountSnapshot = z.infer<typeof AlpacaAccountSnapshotSchema>;
