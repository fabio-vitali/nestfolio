import { z } from 'zod';

export const StreamTypeSchema = z.enum(['actual', 'simulated']).transform((v) => v.toLowerCase() as 'actual' | 'simulated').or(
  z.enum(['ACTUAL', 'SIMULATED']).transform((v) => v.toLowerCase() as 'actual' | 'simulated'),
);

export const TimestampSchema = z.string().min(1, 'timestamp is required');

export const OrderHistoryArgsSchema = z.object({
  streamType: StreamTypeSchema,
  orderId: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});
